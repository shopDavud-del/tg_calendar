// Синхронизация с Google Calendar. Токен хранится зашифрованным.
import { db } from "./db.ts";
import { env } from "./env.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { limits } from "./plans.ts";
import { effectivePlan } from "./groups.ts";
import type { Ev } from "./reminders.ts";
import { localParts } from "./time.ts";

// calendar.events — видит основной календарь (нужна верификация Google).
// calendar.app.created — безопаснее: приложение создаёт СВОЙ отдельный календарь и пишет только в него.
export const SCOPE = Deno.env.get("GOOGLE_SCOPE") ?? "https://www.googleapis.com/auth/calendar.events";
const SECONDARY = SCOPE.includes("calendar.app.created");
export const redirectUri = () => `${env("SUPABASE_URL")}/functions/v1/google`;

export function authUrl(state: string) {
  const p = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"), redirect_uri: redirectUri(), response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
export async function exchangeCode(code: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), redirect_uri: redirectUri(), grant_type: "authorization_code" }),
  });
  return await r.json();
}
export async function saveToken(uid: number, refresh: string) {
  await db.from("google_tokens").upsert({ user_id: uid, refresh_enc: await encrypt(refresh), calendar_id: "primary", connected_at: new Date().toISOString() });
}

export let lastGoogleError = "";
async function access(uid: number) {
  lastGoogleError = "";
  const { data } = await db.from("google_tokens").select("*").eq("user_id", uid).maybeSingle();
  if (!data) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: await decrypt(data.refresh_enc), grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!j.access_token) {
    lastGoogleError = `${j.error ?? "token"}: ${j.error_description ?? ""}`.slice(0, 200);
    if (j.error === "invalid_grant") await db.from("google_tokens").delete().eq("user_id", uid); // пользователь отозвал доступ
    return null;
  }
  let cal = data.calendar_id as string;
  if (SECONDARY && cal === "primary") {
    const c = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
      method: "POST", headers: { authorization: `Bearer ${j.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ summary: "Календарь из Telegram" }),
    }).then((x) => x.json());
    if (c.id) { cal = c.id; await db.from("google_tokens").update({ calendar_id: cal }).eq("user_id", uid); }
  }
  return { token: j.access_token as string, cal: encodeURIComponent(cal) };
}

async function canSync(uid: number) {
  const { data: u } = await db.from("users").select("plan,plan_until").eq("id", uid).maybeSingle();
  return limits(await effectivePlan(u)).google;
}
const ymd = (d: Date, tz: string) => { const p = localParts(d, tz); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
const RR: Record<string, string> = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" };

function toGoogle(ev: Ev) {
  const s = new Date(ev.starts_at);
  const e = ev.ends_at ? new Date(ev.ends_at) : null;
  const body: Record<string, unknown> = {
    summary: ev.title, description: ev.notes ?? undefined,
    extendedProperties: { private: { tg: "1" } },
    reminders: { useDefault: false, overrides: (ev.remind ?? []).filter((m) => m > 0 && m <= 40320).slice(0, 5).map((m) => ({ method: "popup", minutes: m })) },
  };
  if (ev.all_day) {
    body.start = { date: ymd(s, ev.tz) };
    body.end = { date: ymd(new Date((e ?? s).getTime() + (e ? 0 : 86400000)), ev.tz) };
  } else {
    body.start = { dateTime: s.toISOString(), timeZone: ev.tz };
    body.end = { dateTime: (e ?? new Date(s.getTime() + 3600000)).toISOString(), timeZone: ev.tz };
  }
  if (ev.repeat) body.recurrence = [`RRULE:FREQ=${RR[ev.repeat]}`];
  return body;
}

/** Отправить/обновить событие в Google (только личные события пользователей с Pro). */
export async function pushGoogle(ev: Ev) {
  if (ev.owner_id < 0 || ev.source === "google") return;
  if (!(await canSync(ev.owner_id))) return;
  const a = await access(ev.owner_id);
  if (!a) return;
  const base = `https://www.googleapis.com/calendar/v3/calendars/${a.cal}/events`;
  const r = await fetch(ev.google_id ? `${base}/${ev.google_id}` : base, {
    method: ev.google_id ? "PATCH" : "POST",
    headers: { authorization: `Bearer ${a.token}`, "content-type": "application/json" },
    body: JSON.stringify(toGoogle(ev)),
  });
  const j = await r.json();
  if (j.id && j.id !== ev.google_id) await db.from("events").update({ google_id: j.id }).eq("id", ev.id);
}
export async function deleteGoogle(ev: Ev) {
  if (!ev.google_id || ev.owner_id < 0) return;
  const a = await access(ev.owner_id);
  if (!a) return;
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/${a.cal}/events/${ev.google_id}`, { method: "DELETE", headers: { authorization: `Bearer ${a.token}` } });
}

/** Полная синхронизация: вниз (Google → мы, 90 дней вперёд) и вверх (наши события без google_id). */
export async function syncAll(uid: number) {
  if (!(await canSync(uid))) return { pulled: 0, pushed: 0, error: "plan" };
  const a = await access(uid);
  if (!a) return { pulled: 0, pushed: 0, error: "not_connected", detail: lastGoogleError };
  const { data: u } = await db.from("users").select("tz").eq("id", uid).single();
  const tz = u?.tz ?? "UTC";

  // 1) вниз
  const min = new Date(Date.now() - 86400000), max = new Date(Date.now() + 90 * 86400000);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${a.cal}/events?` + new URLSearchParams({
    timeMin: min.toISOString(), timeMax: max.toISOString(), singleEvents: "true", maxResults: "250", orderBy: "startTime",
  });
  const list = await fetch(url, { headers: { authorization: `Bearer ${a.token}` } }).then((r) => r.json());
  if (list.error) return { pulled: 0, pushed: 0, error: "google", detail: `${list.error.code ?? ""} ${list.error.message ?? ""}`.trim().slice(0, 220) };
  const seen: string[] = [];
  const rows = [];
  for (const g of list.items ?? []) {
    if (g.status === "cancelled" || g.extendedProperties?.private?.tg === "1") continue;
    const allDay = !!g.start?.date;
    const s = allDay ? new Date(`${g.start.date}T00:00:00Z`) : new Date(g.start.dateTime);
    if (isNaN(+s)) continue;
    let st = s;
    if (allDay) { const [y, m, d] = g.start.date.split("-").map(Number); st = zoned(y, m, d, tz); }
    let en: Date | null = null;
    if (g.end) { if (g.end.date) { const [y, m, d] = g.end.date.split("-").map(Number); en = zoned(y, m, d, tz); } else en = new Date(g.end.dateTime); }
    if (allDay && en && en.getTime() - st.getTime() <= 86400000) en = null;
    seen.push(g.id);
    rows.push({ owner_id: uid, google_id: g.id, title: String(g.summary ?? "Без названия").slice(0, 200), notes: g.description?.slice(0, 1000) ?? null,
      starts_at: st.toISOString(), ends_at: en?.toISOString() ?? null, all_day: allDay, tz, remind: [], source: "google", created_by: uid });
  }
  if (rows.length) await db.from("events").upsert(rows, { onConflict: "owner_id,google_id" });
  // удалённые в Google — удаляем и у нас (только то, что пришло оттуда)
  const { data: old } = await db.from("events").select("id,google_id").eq("owner_id", uid).eq("source", "google")
    .gte("starts_at", min.toISOString()).lte("starts_at", max.toISOString());
  const gone = (old ?? []).filter((e) => !seen.includes(e.google_id)).map((e) => e.id);
  if (gone.length) await db.from("events").delete().in("id", gone);

  // 2) вверх
  const { data: mine } = await db.from("events").select("*").eq("owner_id", uid).is("google_id", null).neq("source", "google")
    .or(`repeat.not.is.null,starts_at.gte.${min.toISOString()}`).limit(200);
  for (const ev of mine ?? []) await pushGoogle(ev as Ev);
  return { pulled: rows.length, pushed: (mine ?? []).length };
}
import { zonedToUtc } from "./time.ts";
const zoned = (y: number, m: number, d: number, tz: string) => zonedToUtc(y, m, d, 0, 0, tz);
