import { db } from "./db.ts";
import { decrypt } from "./crypto.ts";
import { TRIAL_DAYS } from "./plans.ts";
import { validTz } from "./time.ts";

export interface User {
  id: number; created_at: string; tz: string; plan: string; plan_until: string | null; ics_token: string; settings: Record<string, unknown>;
}
/** Находит пользователя или создаёт нового (с пробным периодом). */
export async function ensureUser(id: number, tz?: string): Promise<User> {
  const { data } = await db.from("users").select("*").eq("id", id).maybeSingle();
  if (data) {
    if (tz && tz !== data.tz && validTz(tz)) { await db.from("users").update({ tz }).eq("id", id); data.tz = tz; }
    return data as User;
  }
  const row: Record<string, unknown> = { id, tz: tz && validTz(tz) ? tz : "UTC" };
  if (TRIAL_DAYS > 0) { row.plan = "pro"; row.plan_until = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString(); }
  const { data: created } = await db.from("users").upsert(row, { onConflict: "id", ignoreDuplicates: true }).select().single();
  if (created) return created as User;
  return (await db.from("users").select("*").eq("id", id).single()).data as User;
}

/** Полное удаление данных человека. Платежи остаются (нужны для возвратов и учёта) — без привязки к календарю. */
export async function deleteAccount(uid: number) {
  const { data: tok } = await db.from("google_tokens").select("refresh_enc").eq("user_id", uid).maybeSingle();
  if (tok) {
    try { await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `token=${encodeURIComponent(await decrypt(tok.refresh_enc))}` }); } catch { /* ignore */ }
  }
  await db.from("events").delete().eq("owner_id", uid);
  await db.from("day_marks").delete().eq("user_id", uid);
  await db.from("digest_log").delete().eq("user_id", uid);
  await db.from("promo_redemptions").delete().eq("user_id", uid);
  await db.from("group_members").delete().eq("user_id", uid);
  await db.from("pending").delete().eq("user_id", uid);
  await db.from("google_tokens").delete().eq("user_id", uid);
  await db.from("groups").update({ sponsor_id: null }).eq("sponsor_id", uid);
  await db.from("users").delete().eq("id", uid);
}
