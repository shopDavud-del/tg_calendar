// API для мини-приложения. Каждый запрос подписан Telegram (initData) — подделать нельзя.
import { db } from "../_shared/db.ts";
import { env } from "../_shared/env.ts";
import { verifyInitData, signState } from "../_shared/auth.ts";
import { ensureUser, deleteAccount } from "../_shared/account.ts";
import { ALL_THEMES, limits, PLANS, planOf, type Plan } from "../_shared/plans.ts";
import { expand, localParts } from "../_shared/time.ts";
import { removeEvent, saveEvent } from "../_shared/events.ts";
import { invoiceLink } from "../_shared/payments.ts";
import { authUrl, syncAll } from "../_shared/google.ts";
import { applyPatch, withDefaults } from "../_shared/settings.ts";
import { effectivePlan, isGroupAdmin } from "../_shared/groups.ts";
import { createCodes, redeem } from "../_shared/promo.ts";
import type { Ev } from "../_shared/reminders.ts";

// Действия, которым не нужны ни группы, ни тариф: выполняются без лишних запросов
const CHEAP = new Set(["marks", "mark", "services", "service_save", "service_delete", "redeem", "invoice", "google_disconnect", "ics_rotate", "delete_me", "google_sync"]);
const redeemFails = new Map<number, { n: number; t: number }>();   // защита кодов от подбора

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });
// deno-lint-ignore no-explicit-any
type Any = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: Any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const tgUser = await verifyInitData(String(body.initData ?? ""), env("BOT_TOKEN"));
  if (!tgUser) return json({ error: "auth" }, 401);
  try { return json(await handle(body, tgUser.id)); }
  catch (e) { console.error(e); return json({ error: "server" }, 500); }
});

interface G { id: number; title: string; mode: string; isAdmin: boolean; sponsor: number | null; members?: { id: number; name: string; username: string | null }[] }

async function groupsOf(uid: number): Promise<G[]> {
  const { data: m } = await db.from("group_members").select("chat_id").eq("user_id", uid);
  const ids = (m ?? []).map((x) => x.chat_id);
  if (!ids.length) return [];
  const { data: g } = await db.from("groups").select("chat_id,title,active,mode,sponsor_id").in("chat_id", ids).eq("active", true);
  const out: G[] = [];
  for (const x of g ?? []) {
    const team = x.mode === "team";
    const isAdmin = team ? await isGroupAdmin(x.chat_id, uid, x.sponsor_id) : false;
    const gg: G = { id: x.chat_id, title: x.title ?? "Группа", mode: x.mode, isAdmin, sponsor: x.sponsor_id };
    if (team) {
      const { data: mem } = await db.from("group_members").select("user_id,name,username").eq("chat_id", x.chat_id).limit(200);
      const all = (mem ?? []).map((r) => ({ id: r.user_id as number, name: (r.name as string) || (r.username ? "@" + r.username : "Участник"), username: r.username as string | null }));
      gg.members = isAdmin ? all : all.filter((r) => r.id === uid);
    }
    out.push(gg);
  }
  return out;
}

async function handle(b: Any, uid: number) {
  const user = await ensureUser(uid, typeof b.tz === "string" ? b.tz : undefined);
  const isAdmin = uid === Number(env("ADMIN_ID"));
  const settings = withDefaults(user.settings);
  // Тариф и группы считаем только там, где они нужны: остальные действия — один-два запроса к базе
  let plan: Plan = "free", lim = limits("free"), groups: G[] = [], allowed = new Set<number>([uid]), adminTeams: number[] = [];
  const act = String(b.action);
  if (!CHEAP.has(act) && !act.startsWith("admin_")) {
    plan = await effectivePlan(user);
    lim = limits(plan);
    groups = await groupsOf(uid);
    allowed = new Set<number>([uid, ...groups.filter((g) => g.mode !== "team").map((g) => g.id)]);
    adminTeams = groups.filter((g) => g.mode === "team" && g.isAdmin).map((g) => g.id);
  }
  const fetchEvents = async (from: Date, to: Date) => {
    const base = () => db.from("events").select("*").lte("starts_at", to.toISOString())
      .or(`repeat.not.is.null,ends_at.gte.${from.toISOString()},starts_at.gte.${from.toISOString()}`).limit(2000);
    const [a, t] = await Promise.all([
      base().in("owner_id", [...allowed]),
      adminTeams.length ? base().in("group_id", adminTeams) : Promise.resolve({ data: [] as Ev[] }),
    ]);
    const map = new Map<string, Ev>();
    for (const ev of [...(a.data ?? []), ...(t.data ?? [])] as Ev[]) map.set(ev.id, ev);
    const ids = [...map.keys()];
    const doneSet = new Set<string>();
    if (ids.length) {
      const { data: dn } = await db.from("event_done").select("event_id,day").in("event_id", ids.slice(0, 500));
      for (const r of dn ?? []) doneSet.add(`${r.event_id}|${r.day}`);
    }
    const dayKey = (d: Date, tz: string) => { const p = localParts(d, tz); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
    const out = [];
    for (const ev of map.values()) for (const o of expand(ev, from, to))
      out.push({ ...ev, occ_start: o.start.toISOString(), occ_end: o.end?.toISOString() ?? null, done: doneSet.has(`${ev.id}|${dayKey(o.start, ev.tz)}`) });
    return out;
  };
  const fetchMarks = async (from: Date, to: Date) => {
    const k = (d: Date) => d.toISOString().slice(0, 10);
    const { data } = await db.from("day_marks").select("day,mark").eq("user_id", uid).gte("day", k(from)).lte("day", k(to));
    return Object.fromEntries((data ?? []).map((r) => [r.day, r.mark]));
  };
  const parseRange = () => {
    const from = new Date(b.from), to = new Date(b.to);
    return isNaN(+from) || isNaN(+to) || to.getTime() - from.getTime() > 100 * 86400000 ? null : { from, to };
  };

  switch (b.action) {
    case "init": {
      const { data: tok } = await db.from("google_tokens").select("user_id").eq("user_id", uid).maybeSingle();
      let ctx: number | null = null;
      const sp = String(b.start_param ?? "");
      if (/^g\d+$/.test(sp)) { const id = -Number(sp.slice(1)); if (groups.some((g) => g.id === id)) ctx = id; }
      const rg = parseRange();
      const [events, marks] = rg ? await Promise.all([fetchEvents(rg.from, rg.to), fetchMarks(rg.from, rg.to)]) : [undefined, undefined];
      return {
        events, marks,
        user: { id: uid, plan, plan_until: user.plan_until, tz: user.tz, settings, google: !!tok, is_admin: isAdmin },
        limits: lim, plans: PLANS, groups: groups.map(({ sponsor: _s, ...g }) => g), ctx, themes: ALL_THEMES,
        ics: lim.ics ? `${env("SUPABASE_URL")}/functions/v1/ics?t=${user.ics_token}` : null,
        bot: env("BOT_USERNAME"),
      };
    }
    case "events": {
      const rg = parseRange();
      if (!rg) return { error: "range" };
      const [events, marks] = await Promise.all([fetchEvents(rg.from, rg.to), fetchMarks(rg.from, rg.to)]);
      return { events, marks };
    }
    case "save": {
      let ownerId = Number(b.owner_id ?? uid), groupId: number | null = null;
      if (b.id) {
        const { data: ex } = await db.from("events").select("id,owner_id,group_id").eq("id", b.id).maybeSingle();
        if (!ex) return { error: "not_found" };
        const ok = ex.owner_id === uid || allowed.has(ex.owner_id) || (ex.group_id && adminTeams.includes(ex.group_id));
        if (!ok) return { error: "forbidden" };
        ownerId = ex.owner_id; groupId = ex.group_id;
      } else if (b.group_id) {
        const g = groups.find((x) => x.id === Number(b.group_id) && x.mode === "team");
        if (!g) return { error: "forbidden" };
        const assignee = Number(b.assignee_id ?? uid);
        if (assignee !== uid && !g.isAdmin) return { error: "forbidden", message: "Записывать на других может только администратор" };
        const { data: mem } = await db.from("group_members").select("user_id").eq("chat_id", g.id).eq("user_id", assignee).maybeSingle();
        if (!mem) return { error: "forbidden", message: "Этот человек не состоит в группе" };
        await ensureUser(assignee);
        ownerId = assignee; groupId = g.id;
      } else if (!allowed.has(ownerId)) return { error: "forbidden" };
      const r = await saveEvent({
        id: b.id, owner_id: ownerId, group_id: groupId, title: String(b.title ?? ""), notes: b.notes ?? null, starts_at: String(b.starts_at),
        ends_at: b.ends_at ?? null, all_day: !!b.all_day, repeat: b.repeat ?? null,
        remind: Array.isArray(b.remind) ? b.remind.map(Number).filter((n: number) => Number.isFinite(n)) : null,
        created_by: uid, source: "app", tz: user.tz, force: !!b.force,
      });
      return r.ok ? { ok: true, notes: r.notes } : { error: r.reason, message: r.message, conflicts: r.conflicts };
    }
    case "delete": {
      const { data: ev } = await db.from("events").select("owner_id,group_id").eq("id", b.id).maybeSingle();
      if (!ev || !(allowed.has(ev.owner_id) || (ev.group_id && adminTeams.includes(ev.group_id)))) return { error: "not_found" };
      await removeEvent(b.id, ev.owner_id);
      return { ok: true };
    }
    case "settings": {
      if (typeof b.theme === "string") {
        if (!ALL_THEMES.includes(b.theme)) return { error: "theme" };
        if (!lim.themes.includes(b.theme)) return { error: "plan", message: "Эта тема доступна в Plus и выше" };
      }
      const r = applyPatch(settings, b, lim.maxReminders);
      if ("error" in r) return { error: "plan", message: `В вашем тарифе до ${lim.maxReminders} напоминаний` };
      if (typeof b.theme === "string") r.s.theme = b.theme;
      await db.from("users").update({ settings: r.s }).eq("id", uid);
      return { ok: true, settings: r.s };
    }
    case "done": {   // отметить вхождение выполненным / снять отметку
      const { data: ev } = await db.from("events").select("id,owner_id,group_id,tz").eq("id", b.id).maybeSingle();
      if (!ev || !(allowed.has(ev.owner_id) || (ev.group_id && adminTeams.includes(ev.group_id)))) return { error: "not_found" };
      const day = String(b.day);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "bad" };
      if (b.done) await db.from("event_done").upsert({ event_id: ev.id, day });
      else await db.from("event_done").delete().eq("event_id", ev.id).eq("day", day);
      return { ok: true };
    }
    case "snooze": {   // повторное напоминание через N минут
      const { data: ev } = await db.from("events").select("id,owner_id,group_id").eq("id", b.id).maybeSingle();
      if (!ev || !(allowed.has(ev.owner_id) || (ev.group_id && adminTeams.includes(ev.group_id)))) return { error: "not_found" };
      const mins = Math.max(1, Math.min(1440, Number(b.minutes) || 10));
      const occ = new Date(b.occ);
      if (isNaN(+occ)) return { error: "bad" };
      await db.from("reminders").insert({ event_id: ev.id, occurrence: occ.toISOString(), offset_min: 1_000_000 + (Math.floor(Date.now() / 60000) % 900_000), fire_at: new Date(Date.now() + mins * 60000).toISOString() });
      return { ok: true };
    }
    case "services": {
      const { data } = await db.from("services").select("id,name,minutes").eq("owner_id", uid).order("created_at");
      return { services: data ?? [] };
    }
    case "service_save": {
      const name = String(b.name ?? "").trim().slice(0, 60), minutes = Math.round(Number(b.minutes));
      if (!name || !(minutes >= 5 && minutes <= 720)) return { error: "bad", message: "Укажите название и время от 5 минут до 12 часов" };
      const { count } = await db.from("services").select("id", { count: "exact", head: true }).eq("owner_id", uid);
      if ((count ?? 0) >= 60) return { error: "limit", message: "Не больше 60 услуг" };
      await db.from("services").insert({ owner_id: uid, name, minutes });
      return { ok: true };
    }
    case "service_delete": { await db.from("services").delete().eq("id", b.id).eq("owner_id", uid); return { ok: true }; }
    case "marks": {
      const { data } = await db.from("day_marks").select("day,mark").eq("user_id", uid).gte("day", String(b.from).slice(0, 10)).lte("day", String(b.to).slice(0, 10));
      return { marks: Object.fromEntries((data ?? []).map((r) => [r.day, r.mark])) };
    }
    case "mark": {
      const day = String(b.day);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "bad" };
      if (!b.mark) await db.from("day_marks").delete().eq("user_id", uid).eq("day", day);
      else if (["done", "miss", "star"].includes(b.mark)) await db.from("day_marks").upsert({ user_id: uid, day, mark: b.mark });
      else return { error: "bad" };
      return { ok: true };
    }
    case "redeem": {
      const f = redeemFails.get(uid);
      if (f && f.n >= 8 && Date.now() - f.t < 600_000) return { error: "code", message: "Слишком много попыток. Попробуйте через 10 минут" };
      const r = await redeem(uid, String(b.code ?? ""));
      if (!r.ok) redeemFails.set(uid, { n: (f && Date.now() - f.t < 600_000 ? f.n : 0) + 1, t: Date.now() });
      return r.ok ? { ok: true, plan: r.plan, until: r.until } : { error: "code", message: r.message };
    }
    case "invoice": {
      if (!["plus", "pro", "team"].includes(b.plan) || !["month", "year"].includes(b.period)) return { error: "bad" };
      const url = await invoiceLink(uid, b.plan as Plan, b.period);
      return url ? { url } : { error: "invoice" };
    }
    case "google_url": {
      if (!lim.google) return { error: "plan", message: "Синхронизация с Google входит в тариф Pro" };
      if (!Deno.env.get("GOOGLE_CLIENT_ID") || !Deno.env.get("GOOGLE_CLIENT_SECRET")) return { error: "not_configured", message: "Google ещё не настроен владельцем бота (нет GOOGLE_CLIENT_ID)" };
      return { url: authUrl(await signState(uid, env("TOKEN_KEY"))) };
    }
    case "google_sync": return await syncAll(uid);
    case "google_disconnect": { await db.from("google_tokens").delete().eq("user_id", uid); return { ok: true }; }
    case "ics_rotate": {
      const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      await db.from("users").update({ ics_token: token }).eq("id", uid);
      return { ics: `${env("SUPABASE_URL")}/functions/v1/ics?t=${token}` };
    }
    case "delete_me": {
      if (b.confirm !== "DELETE") return { error: "confirm" };
      await deleteAccount(uid);
      return { ok: true };
    }
  }

  /* ------------------------- админ-панель (только ADMIN_ID) ------------------------- */
  if (String(b.action).startsWith("admin_")) {
    if (!isAdmin) return { error: "forbidden" };
    switch (b.action) {
      case "admin_stats": {
        const now = new Date().toISOString();
        const c = (q: Any) => q.then((r: Any) => r.count ?? 0);
        const [users, events, groupsN, paid, codes, tick] = await Promise.all([
          c(db.from("users").select("id", { count: "exact", head: true })),
          c(db.from("events").select("id", { count: "exact", head: true })),
          c(db.from("groups").select("chat_id", { count: "exact", head: true }).eq("active", true)),
          c(db.from("users").select("id", { count: "exact", head: true }).neq("plan", "free").gt("plan_until", now)),
          c(db.from("promo_codes").select("code", { count: "exact", head: true }).eq("revoked", false)),
          db.from("meta").select("value").eq("key", "last_tick").maybeSingle(),
        ]);
        const { data: pay } = await db.from("payments").select("stars").eq("refunded", false);
        const stars = (pay ?? []).reduce((s: number, p: Any) => s + p.stars, 0);
        return { users, events, groups: groupsN, paid, codes, stars, last_tick: tick.data?.value ?? null };
      }
      case "admin_codes": {
        const { data } = await db.from("promo_codes").select("*").order("created_at", { ascending: false }).limit(100);
        return { codes: data ?? [] };
      }
      case "admin_create": {
        if (!["plus", "pro", "team"].includes(b.plan)) return { error: "bad" };
        const codes = await createCodes({ plan: b.plan, days: Math.max(1, Math.min(3650, Number(b.days) || 30)), uses: Math.max(1, Number(b.uses) || 1),
          count: Number(b.count) || 1, note: b.note ? String(b.note) : undefined, expiresDays: b.expires_days ? Number(b.expires_days) : undefined });
        return { codes };
      }
      case "admin_revoke": { await db.from("promo_codes").update({ revoked: true }).eq("code", String(b.code)); return { ok: true }; }
      case "admin_grant": {
        const id = Number(b.user_id), days = Math.max(1, Number(b.days) || 30);
        if (!id || !["free", "plus", "pro", "team"].includes(b.plan)) return { error: "bad" };
        await ensureUser(id);
        await db.from("users").update({ plan: b.plan, plan_until: b.plan === "free" ? null : new Date(Date.now() + days * 86400000).toISOString() }).eq("id", id);
        return { ok: true };
      }
    }
  }
  return { error: "unknown_action" };
}
