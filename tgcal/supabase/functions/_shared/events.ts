// Создание/изменение событий с проверкой лимитов тарифа — общее для бота и мини-приложения.
import { db } from "./db.ts";
import { limits, type Plan } from "./plans.ts";
import { effectivePlan } from "./groups.ts";
import { expand } from "./time.ts";
import { reschedule, type Ev } from "./reminders.ts";
import { remindDefaults, withDefaults } from "./settings.ts";
import { pushGoogle, deleteGoogle } from "./google.ts";
import type { User } from "./account.ts";

/** Чей тариф действует для календаря owner_id: человека или «спонсора» группы. */
export async function planForOwner(ownerId: number): Promise<{ plan: Plan; user: User | null; tz: string }> {
  let uid = ownerId;
  if (ownerId < 0) {
    const { data: g } = await db.from("groups").select("sponsor_id").eq("chat_id", ownerId).maybeSingle();
    if (!g?.sponsor_id) return { plan: "free", user: null, tz: "UTC" };
    uid = g.sponsor_id;
  }
  const { data: u } = await db.from("users").select("*").eq("id", uid).maybeSingle();
  return { plan: await effectivePlan(u), user: u as User | null, tz: u?.tz ?? "UTC" };
}

export interface Input {
  id?: string; owner_id: number; title: string; notes?: string | null; starts_at: string; ends_at?: string | null;
  all_day: boolean; repeat?: string | null; remind?: number[] | null; created_by: number; source: string; tz: string;
  group_id?: number | null;   // запись создана в группе-салоне (owner_id — кому назначена)
  force?: boolean;            // записать, даже если время занято
}
export interface Conflict { title: string; start: string; end: string }
export type Result = { ok: true; ev: Ev; notes: string[] } | { ok: false; reason: "limit" | "invalid" | "team" | "conflict"; message: string; conflicts?: Conflict[] };
const DEFAULT_MIN = 60;   // длительность записи без указанного конца — для проверки занятости

/** Какие записи мастера пересекаются с интервалом. */
async function findConflicts(ownerId: number, startIso: string, endIso: string | null, excludeId?: string): Promise<Conflict[]> {
  const s = new Date(startIso), e = endIso ? new Date(endIso) : new Date(s.getTime() + DEFAULT_MIN * 60000);
  const { data } = await db.from("events").select("*").eq("owner_id", ownerId).eq("all_day", false)
    .or(`repeat.not.is.null,starts_at.gte.${new Date(s.getTime() - 86400000).toISOString()}`).lte("starts_at", e.toISOString()).limit(300);
  const out: Conflict[] = [];
  for (const ev of (data ?? []) as Ev[]) {
    if (ev.id === excludeId) continue;
    const dur = ev.ends_at ? new Date(ev.ends_at).getTime() - new Date(ev.starts_at).getTime() : DEFAULT_MIN * 60000;
    for (const o of expand({ ...ev, ends_at: new Date(new Date(ev.starts_at).getTime() + dur).toISOString() }, new Date(s.getTime() - dur), e)) {
      const oe = new Date(o.start.getTime() + dur);
      if (o.start < e && oe > s) out.push({ title: ev.title, start: o.start.toISOString(), end: oe.toISOString() });
    }
  }
  return out;
}

/** Подбирает длительность по названию услуги мастера («маникюр» → 90 мин). */
async function serviceMinutes(ownerId: number, title: string) {
  if (ownerId <= 0) return null;
  const { data } = await db.from("services").select("name,minutes").eq("owner_id", ownerId);
  const t = title.toLowerCase();
  const hit = (data ?? []).filter((s) => t.includes((s.name as string).toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  return hit ? { name: hit.name as string, minutes: hit.minutes as number } : null;
}

export async function saveEvent(inp: Input): Promise<Result> {
  const { plan } = await planForOwner(inp.group_id ?? inp.owner_id);
  const lim = limits(plan);
  const notes: string[] = [];
  if (inp.group_id && !lim.team) return { ok: false, reason: "team", message: "Командный режим доступен в тарифе Team." };
  const title = (inp.title ?? "").trim().slice(0, 200);
  if (!title || isNaN(Date.parse(inp.starts_at))) return { ok: false, reason: "invalid", message: "Нужны название и дата" };

  if (!inp.id) {
    const { count } = await db.from("events").select("id", { count: "exact", head: true })
      .eq("owner_id", inp.owner_id).or(`repeat.not.is.null,starts_at.gte.${new Date().toISOString()}`);
    if ((count ?? 0) >= lim.maxEvents)
      return { ok: false, reason: "limit", message: `В бесплатном тарифе до ${lim.maxEvents} активных событий.` };
  }
  let repeat = inp.repeat ?? null;
  if (repeat && !lim.repeat) { repeat = null; notes.push("Повторы доступны в тарифе Plus — событие добавлено без повтора."); }
  let remind: number[];
  if (inp.remind == null) {   // null = взять из настроек владельца; [] = «без напоминания»
    const st = inp.owner_id > 0 ? (await db.from("users").select("settings").eq("id", inp.owner_id).maybeSingle()).data?.settings : null;
    remind = remindDefaults(withDefaults(st), inp.all_day);
  } else remind = inp.remind;
  remind = [...new Set(remind)].slice(0, lim.maxReminders);
  if (inp.remind && inp.remind.length > lim.maxReminders) notes.push(`В вашем тарифе до ${lim.maxReminders} напоминаний на событие.`);

  let endsAt = inp.ends_at ?? null;
  if (!endsAt && !inp.all_day) {
    const sv = await serviceMinutes(inp.owner_id, title);
    if (sv) { endsAt = new Date(new Date(inp.starts_at).getTime() + sv.minutes * 60000).toISOString(); notes.push(`Услуга «${sv.name}»: ${sv.minutes} мин.`); }
  }
  if (!inp.all_day && !inp.force) {
    const cf = await findConflicts(inp.owner_id, inp.starts_at, endsAt, inp.id);
    if (cf.length) return { ok: false, reason: "conflict", message: "Это время уже занято", conflicts: cf };
  }
  const row = {
    owner_id: inp.owner_id, title, notes: inp.notes?.slice(0, 1000) ?? null, starts_at: inp.starts_at,
    ends_at: endsAt, all_day: inp.all_day, tz: inp.tz, repeat, remind,
    created_by: inp.created_by, source: inp.source, group_id: inp.group_id ?? null, updated_at: new Date().toISOString(),
  };
  const q = inp.id ? db.from("events").update(row).eq("id", inp.id).eq("owner_id", inp.owner_id) : db.from("events").insert(row);
  const { data, error } = await q.select().single();
  if (error || !data) { console.error(error); return { ok: false, reason: "invalid", message: "Не удалось сохранить" }; }
  const ev = data as Ev;
  await reschedule(ev);
  try { await pushGoogle(ev); } catch (err) { console.error("google push", err); }   // ждём: Edge-функция обрывает фоновые задачи после ответа
  return { ok: true, ev, notes };
}

export async function removeEvent(id: string, ownerId: number) {
  const { data } = await db.from("events").delete().eq("id", id).eq("owner_id", ownerId).select().maybeSingle();
  if (data) { try { await deleteGoogle(data as Ev); } catch (err) { console.error("google delete", err); } }
  return !!data;
}
