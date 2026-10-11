// Создание/изменение событий с проверкой лимитов тарифа — общее для бота и мини-приложения.
import { db } from "./db.ts";
import { limits, planOf, type Plan } from "./plans.ts";
import { reschedule, type Ev } from "./reminders.ts";
import { defaultRemind } from "./parse.ts";
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
  return { plan: planOf(u), user: u as User | null, tz: u?.tz ?? "UTC" };
}

export interface Input {
  id?: string; owner_id: number; title: string; notes?: string | null; starts_at: string; ends_at?: string | null;
  all_day: boolean; repeat?: string | null; remind?: number[] | null; created_by: number; source: string; tz: string;
}
export type Result = { ok: true; ev: Ev; notes: string[] } | { ok: false; reason: "limit" | "invalid"; message: string };

export async function saveEvent(inp: Input): Promise<Result> {
  const { plan } = await planForOwner(inp.owner_id);
  const lim = limits(plan);
  const notes: string[] = [];
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
  let remind = (inp.remind && inp.remind.length ? inp.remind : defaultRemind(inp.all_day));
  remind = [...new Set(remind)].slice(0, lim.maxReminders);
  if (inp.remind && inp.remind.length > lim.maxReminders) notes.push(`В вашем тарифе до ${lim.maxReminders} напоминаний на событие.`);

  const row = {
    owner_id: inp.owner_id, title, notes: inp.notes?.slice(0, 1000) ?? null, starts_at: inp.starts_at,
    ends_at: inp.ends_at ?? null, all_day: inp.all_day, tz: inp.tz, repeat, remind,
    created_by: inp.created_by, source: inp.source, updated_at: new Date().toISOString(),
  };
  const q = inp.id ? db.from("events").update(row).eq("id", inp.id).eq("owner_id", inp.owner_id) : db.from("events").insert(row);
  const { data, error } = await q.select().single();
  if (error || !data) { console.error(error); return { ok: false, reason: "invalid", message: "Не удалось сохранить" }; }
  const ev = data as Ev;
  await reschedule(ev);
  pushGoogle(ev).catch((e) => console.error("google push", e));   // не ждём — это дополнение
  return { ok: true, ev, notes };
}

export async function removeEvent(id: string, ownerId: number) {
  const { data } = await db.from("events").delete().eq("id", id).eq("owner_id", ownerId).select().maybeSingle();
  if (data) deleteGoogle(data as Ev).catch(() => {});
  return !!data;
}
