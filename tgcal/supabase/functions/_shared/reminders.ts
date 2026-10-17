import { db } from "./db.ts";
import { nextStart } from "./time.ts";

export interface Ev {
  id: string; owner_id: number; title: string; notes?: string | null; starts_at: string; ends_at: string | null;
  all_day: boolean; tz: string; repeat: string | null; remind: number[]; created_by?: number | null;
  source?: string; google_id?: string | null; group_id?: number | null; client_id?: string | null;
}

/** Планирует уведомления для ближайшего вхождения события. Безопасно вызывать много раз. */
export async function schedule(ev: Ev) {
  if (!ev.remind?.length) return;
  const now = Date.now();
  const occ = nextStart(ev, now);
  if (!occ) return;
  const rows = ev.remind
    .map((m) => ({ event_id: ev.id, occurrence: occ.toISOString(), offset_min: m, fire_at: new Date(occ.getTime() - m * 60000) }))
    .filter((r) => r.fire_at.getTime() > now - 90_000)
    .map((r) => ({ ...r, fire_at: r.fire_at.toISOString() }));
  if (rows.length) await db.from("reminders").upsert(rows, { onConflict: "event_id,occurrence,offset_min", ignoreDuplicates: true });
}
export async function reschedule(ev: Ev) {
  await db.from("reminders").delete().eq("event_id", ev.id).eq("sent", false);
  await schedule(ev);
}
