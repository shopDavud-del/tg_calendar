import { db } from "./db.ts";
import { ensureUser } from "./account.ts";
import { PLANS, planOf, RANK, type Plan } from "./plans.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function genCode(prefix = "CAL") {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const s = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4)}`;
}
export async function createCodes(o: { plan: Plan; days: number; uses: number; count: number; note?: string; expiresDays?: number }) {
  const rows = Array.from({ length: Math.min(Math.max(o.count, 1), 100) }, () => ({
    code: genCode(), plan: o.plan, days: o.days, max_uses: o.uses, note: o.note?.slice(0, 100) ?? null,
    expires_at: o.expiresDays ? new Date(Date.now() + o.expiresDays * 86400000).toISOString() : null,
  }));
  const { error } = await db.from("promo_codes").insert(rows);
  return error ? [] : rows.map((r) => r.code);
}

export type Redeem = { ok: true; plan: Plan; until: string } | { ok: false; message: string };
export async function redeem(uid: number, raw: string): Promise<Redeem> {
  const code = raw.trim().toUpperCase().replace(/\s+/g, "");
  const { data: c } = await db.from("promo_codes").select("*").eq("code", code).maybeSingle();
  if (!c || c.revoked) return { ok: false, message: "Код не найден или отключён" };
  if (c.expires_at && new Date(c.expires_at) < new Date()) return { ok: false, message: "Срок действия кода истёк" };
  if (c.used_count >= c.max_uses) return { ok: false, message: "Код уже использован" };
  const user = await ensureUser(uid);
  const cur = planOf(user);
  if (RANK[cur] > RANK[c.plan as Plan]) return { ok: false, message: `У вас уже действует более высокий тариф (${PLANS[cur].title})` };
  const { error } = await db.from("promo_redemptions").insert({ code, user_id: uid });
  if (error) return { ok: false, message: "Вы уже вводили этот код" };
  // занимаем «место» в коде; если кто-то успел раньше — откатываем
  const { data: upd } = await db.from("promo_codes").update({ used_count: c.used_count + 1 }).eq("code", code).eq("used_count", c.used_count).select("code");
  if (!upd?.length) { await db.from("promo_redemptions").delete().eq("code", code).eq("user_id", uid); return { ok: false, message: "Код только что закончился, попробуйте ещё раз" }; }
  const base = cur === c.plan && user.plan_until ? new Date(user.plan_until).getTime() : Date.now();
  const until = new Date(Math.max(base, Date.now()) + c.days * 86400000).toISOString();
  await db.from("users").update({ plan: c.plan, plan_until: until }).eq("id", uid);
  return { ok: true, plan: c.plan as Plan, until };
}
