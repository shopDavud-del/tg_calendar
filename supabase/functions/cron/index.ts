// Запускается каждую минуту (pg_cron): уведомления, продление тарифов, проверка активности
import { db } from "../_shared/db.ts";
import { env } from "../_shared/env.ts";
import { esc, kb, send } from "../_shared/tg.ts";
import { schedule, type Ev } from "../_shared/reminders.ts";
import { fmtWhen } from "../_shared/time.ts";

const KEEPALIVE_DAYS = 5;

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== env("CRON_SECRET")) return new Response("forbidden", { status: 401 });
  const out: Record<string, unknown> = {};
  try { out.sent = await fireReminders(); } catch (e) { console.error("reminders", e); }
  try { await nextRepeats(); } catch (e) { console.error("repeats", e); }
  try { await housekeeping(); } catch (e) { console.error("house", e); }
  try { out.keepalive = await keepalive(); } catch (e) { console.error("keepalive", e); }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
});

async function fireReminders() {
  const { data: due } = await db.from("reminders").select("id,event_id,occurrence,offset_min,fire_at, events(*)")
    .eq("sent", false).lte("fire_at", new Date().toISOString()).order("fire_at").limit(200);
  let n = 0;
  for (const r of due ?? []) {
    // помечаем сразу, чтобы параллельный запуск не отправил дубль
    const { data: claimed } = await db.from("reminders").update({ sent: true }).eq("id", r.id).eq("sent", false).select("id");
    if (!claimed?.length) continue;
    // deno-lint-ignore no-explicit-any
    const ev = (r as any).events as Ev | null;
    if (!ev) continue;
    const occ = new Date(r.occurrence);
    const when = fmtWhen(occ, ev.tz, ev.all_day);
    const lead = r.offset_min < 0 || ev.all_day ? "Сегодня" : r.offset_min === 0 ? "Сейчас" : `Через ${human(r.offset_min)}`;
    await send(ev.owner_id, `🔔 <b>${lead}</b>\n📌 ${esc(ev.title)}\n🗓 ${esc(when)}${ev.notes ? `\n\n${esc(ev.notes)}` : ""}`);
    n++;
  }
  return n;
}
function human(m: number) {
  if (m % 1440 === 0) return `${m / 1440} дн.`;
  if (m % 60 === 0) return `${m / 60} ч`;
  return `${m} мин`;
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
