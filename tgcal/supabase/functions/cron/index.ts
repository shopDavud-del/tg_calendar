// Запускается каждую минуту (pg_cron): уведомления, утренние/вечерние сводки, продление повторов, проверка активности
import { db } from "../_shared/db.ts";
import { env } from "../_shared/env.ts";
import { esc, kb, send } from "../_shared/tg.ts";
import { schedule, type Ev } from "../_shared/reminders.ts";
import { expand, fmtWhen, localParts, zonedToUtc } from "../_shared/time.ts";
import { withDefaults } from "../_shared/settings.ts";
import { mention } from "../_shared/groups.ts";

const KEEPALIVE_DAYS = 5;
let lastTickWrite = 0;

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== env("CRON_SECRET")) return new Response("forbidden", { status: 401 });
  const out: Record<string, unknown> = {};
  if (Date.now() - lastTickWrite > 120_000) {   // метка работы планировщика: раз в 2 минуты, а не каждую
    lastTickWrite = Date.now();
    await db.from("meta").upsert({ key: "last_tick", value: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
  try { out.sent = await fireReminders(); } catch (e) { console.error("reminders", e); }
  try { out.digests = await digests(); } catch (e) { console.error("digests", e); }
  try { await nextRepeats(); } catch (e) { console.error("repeats", e); }
  try { await housekeeping(); } catch (e) { console.error("house", e); }
  try { out.keepalive = await keepalive(); } catch (e) { console.error("keepalive", e); }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
});

const human = (m: number) => m % 1440 === 0 ? `${m / 1440} дн.` : m % 60 === 0 ? `${m / 60} ч` : `${m} мин`;
const hm = (d: Date, tz: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d);

async function fireReminders() {
  const { data: due } = await db.from("reminders").select("id,event_id,occurrence,offset_min,fire_at, events(*)")
    .eq("sent", false).lte("fire_at", new Date().toISOString()).order("fire_at").limit(200);
  let n = 0;
  for (const r of due ?? []) {
    const { data: claimed } = await db.from("reminders").update({ sent: true }).eq("id", r.id).eq("sent", false).select("id");
    if (!claimed?.length) continue;
    // deno-lint-ignore no-explicit-any
    const ev = (r as any).events as Ev | null;
    if (!ev) continue;
    const occ = new Date(r.occurrence);
    const when = fmtWhen(occ, ev.tz, ev.all_day);
    const lead = r.offset_min >= 1_000_000 ? "Напоминание" : r.offset_min < 0 || ev.all_day ? "Сегодня" : r.offset_min === 0 ? "Сейчас" : `Через ${human(r.offset_min)}`;
    const occMin = Math.floor(occ.getTime() / 60000);
    const buttons = kb([[{ text: "✓ Готово", data: `dn:${ev.id}:${occMin}` }, { text: "⏰ +10 мин", data: `sz:${ev.id}:${occMin}:10` }, { text: "⏰ +1 час", data: `sz:${ev.id}:${occMin}:60` }]]);
    const body = `📌 ${esc(ev.title)}\n🗓 ${esc(when)}${ev.notes ? `\n\n${esc(ev.notes)}` : ""}`;
    await send(ev.owner_id, `🔔 <b>${lead}</b>\n${body}`, buttons);   // личное сообщение (для группового календаря owner_id — это чат группы)
    if (ev.group_id && ev.owner_id > 0) await notifyGroup(ev, lead, occ, when);
    n++;
  }
  return n;
}

/** Салон: дублируем напоминание в группу, отмечая сотрудника и администратора. */
async function notifyGroup(ev: Ev, lead: string, occ: Date, when: string) {
  const { data: g } = await db.from("groups").select("notify_group,sponsor_id,active").eq("chat_id", ev.group_id!).maybeSingle();
  if (!g?.notify_group || !g.active) return;
  const ids = [ev.owner_id, g.sponsor_id].filter((x): x is number => !!x);
  const { data: mem } = await db.from("group_members").select("user_id,name,username").eq("chat_id", ev.group_id!).in("user_id", ids);
  const nm = (id: number) => { const m = (mem ?? []).find((x) => x.user_id === id); return (m?.name as string) || (m?.username ? "@" + m.username : "участник"); };
  void occ;
  const adm = g.sponsor_id && g.sponsor_id !== ev.owner_id ? `\n👤 Админ: ${mention(g.sponsor_id, nm(g.sponsor_id))}` : "";
  await send(ev.group_id!, `🔔 <b>${lead}</b> · запись у ${mention(ev.owner_id, nm(ev.owner_id))}\n📌 ${esc(ev.title)}\n🗓 ${esc(when)}${adm}`);
}

/** Утром — задачи на день, вечером — план на завтра (по часовому поясу и настройкам человека). */
async function digests() {
  const { data: users } = await db.from("users").select("id,tz,settings")
    .or("settings->>digest_morning.not.is.null,settings->>digest_evening.not.is.null").limit(2000);
  if (!users?.length) return 0;
  const now = new Date();
  let sent = 0;
  for (const u of users) {
    const st = withDefaults(u.settings);
    const lp = localParts(now, u.tz);
    const dayKey = `${lp.y}-${String(lp.m).padStart(2, "0")}-${String(lp.d).padStart(2, "0")}`;
    const nowMin = lp.h * 60 + lp.mi;
    for (const kind of ["morning", "evening"] as const) {
      const t = kind === "morning" ? st.digest_morning : st.digest_evening;
      if (!t) continue;
      const [h, m] = t.split(":").map(Number);
      const at = h * 60 + m;
      if (nowMin < at || nowMin > at + 59) continue;   // только в течение часа после выбранного времени
      const { error } = await db.from("digest_log").insert({ user_id: u.id, kind, day: dayKey });
      if (error) continue;                              // уже отправляли сегодня
      const dayOff = kind === "morning" ? 0 : 1;
      const from = zonedToUtc(lp.y, lp.m, lp.d + dayOff, 0, 0, u.tz), to = zonedToUtc(lp.y, lp.m, lp.d + dayOff + 1, 0, 0, u.tz);
      const { data: evs } = await db.from("events").select("*").eq("owner_id", u.id).limit(500);
      const items = ((evs ?? []) as Ev[]).flatMap((ev) => expand(ev, from, new Date(to.getTime() - 1)).map((o) => ({ ev, start: o.start })))
        .sort((a, b) => (+b.ev.all_day - +a.ev.all_day) || (+a.start - +b.start));
      if (items.length < st.digest_min) continue;
      const lines = items.slice(0, 20).map((i) => `• ${i.ev.all_day ? "весь день" : hm(i.start, u.tz)} — ${esc(i.ev.title)}`);
      const head = kind === "morning" ? `☀️ <b>План на сегодня</b> · ${items.length}` : `🌙 <b>Завтра</b> · ${fmtWhen(from, u.tz, true).replace(", весь день", "")} · ${items.length}`;
      await send(u.id, `${head}\n${lines.join("\n")}${items.length > 20 ? `\n…и ещё ${items.length - 20}` : ""}`, kb([[{ text: "📅 Открыть календарь", web_app: env("APP_URL") }]]));
      sent++;
    }
  }
  return sent;
}

/** Для повторяющихся событий — запланировать следующее вхождение, когда у текущего не осталось напоминаний. */
async function nextRepeats() {
  const { data: evs } = await db.from("events").select("*").not("repeat", "is", null).neq("remind", "{}").limit(1000);
  if (!evs?.length) return;
  const { data: pend } = await db.from("reminders").select("event_id").eq("sent", false).in("event_id", evs.map((e) => e.id));
  const have = new Set((pend ?? []).map((p) => p.event_id));
  for (const ev of evs) if (!have.has(ev.id)) await schedule(ev as Ev);
}

async function housekeeping() {
  const now = new Date().toISOString();
  await db.from("users").update({ plan: "free", plan_until: null }).neq("plan", "free").lt("plan_until", now);
  await db.from("pending").delete().lt("created_at", new Date(Date.now() - 2 * 86400000).toISOString());
  await db.from("reminders").delete().eq("sent", true).lt("fire_at", new Date(Date.now() - 7 * 86400000).toISOString());
  await db.from("digest_log").delete().lt("day", new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10));
}

/** Раз в 5 дней пишем администратору и обновляем запись в базе — чтобы бесплатный проект Supabase не «уснул». */
async function keepalive() {
  const { data } = await db.from("meta").select("value").eq("key", "last_keepalive").maybeSingle();
  const last = data ? new Date(data.value as string).getTime() : 0;
  if (Date.now() - last < KEEPALIVE_DAYS * 86400000) return false;
  const [u, e] = await Promise.all([
    db.from("users").select("id", { count: "exact", head: true }),
    db.from("events").select("id", { count: "exact", head: true }),
  ]);
  await db.from("meta").upsert({ key: "last_keepalive", value: new Date().toISOString(), updated_at: new Date().toISOString() });
  await send(Number(env("ADMIN_ID")), `🫀 <b>Проверка активности</b>\nБот и база работают.\n👥 Пользователей: ${u.count} · 📌 Событий: ${e.count}\n\nВсё в порядке?`,
    kb([[{ text: "✅ Да, всё ок", data: "ka:ok" }]]));
  return true;
}
