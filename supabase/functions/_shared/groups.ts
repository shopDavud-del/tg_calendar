import { db } from "./db.ts";
import { tg } from "./tg.ts";
import { planOf, RANK, type Plan } from "./plans.ts";

const cache = new Map<string, { v: boolean; t: number }>();
/** Администратор ли человек в группе: подключивший бота или админ чата в Telegram (кэш 5 минут). */
export async function isGroupAdmin(chatId: number, uid: number, sponsorId?: number | null) {
  if (sponsorId && sponsorId === uid) return true;
  const k = `${chatId}:${uid}`, c = cache.get(k);
  if (c && Date.now() - c.t < 300_000) return c.v;
  const j = await tg("getChatMember", { chat_id: chatId, user_id: uid });
  const v = !!j.ok && ["creator", "administrator"].includes(j.result?.status);
  cache.set(k, { v, t: Date.now() });
  return v;
}
export const mention = (id: number, name: string) => `<a href="tg://user?id=${id}">${name.replace(/[<>&]/g, "")}</a>`;
// deno-lint-ignore no-explicit-any
export const displayName = (u: any) => (u?.first_name ?? u?.username ?? "участник") + (u?.last_name ? ` ${u.last_name}` : "");

export interface Mention { username?: string; id?: number }
/** Вытаскивает @ники из сообщения (и убирает их из текста, чтобы не попали в название). */
// deno-lint-ignore no-explicit-any
export function extractMentions(text: string, entities: any[] | undefined, botUsername: string) {
  const found: Mention[] = [];
  const cuts: [number, number][] = [];
  for (const e of entities ?? []) {
    if (e.type === "mention") {
      const u = text.slice(e.offset + 1, e.offset + e.length);
      if (u.toLowerCase() === botUsername.toLowerCase()) { cuts.push([e.offset, e.length]); continue; }
      found.push({ username: u }); cuts.push([e.offset, e.length]);
    } else if (e.type === "text_mention" && e.user) { found.push({ id: e.user.id }); cuts.push([e.offset, e.length]); }
  }
  let out = text;
  for (const [o, l] of cuts.sort((a, b) => b[0] - a[0])) out = out.slice(0, o) + " " + out.slice(o + l);
  return { cleaned: out.replace(/\s+/g, " ").trim(), mentions: found };
}
export async function findMember(chatId: number, m: Mention) {
  if (m.id) { const { data } = await db.from("group_members").select("*").eq("chat_id", chatId).eq("user_id", m.id).maybeSingle(); return data ?? { user_id: m.id, name: null, username: null }; }
  const { data } = await db.from("group_members").select("*").eq("chat_id", chatId).ilike("username", m.username!).maybeSingle();
  return data;
}

const memCache = new Map<string, { v: boolean; t: number }>();
/** Состоит ли человек в группе сейчас (проверка в Telegram, кэш 10 минут). Вышедших убираем из списка. */
export async function isMember(chatId: number, uid: number) {
  const k = `${chatId}:${uid}`, c = memCache.get(k);
  if (c && Date.now() - c.t < 600_000) return c.v;
  const j = await tg("getChatMember", { chat_id: chatId, user_id: uid });
  const st = j.result?.status as string | undefined;
  const v = !!j.ok && ["creator", "administrator", "member", "restricted"].includes(st ?? "");
  if (j.ok && !v) await db.from("group_members").delete().eq("chat_id", chatId).eq("user_id", uid);
  if (j.ok) memCache.set(k, { v, t: Date.now() });
  return j.ok ? v : true;   // при сбое Telegram не отнимаем тариф
}
/** Тариф с учётом групп: участник группы с оплаченным Team получает Pro, пока состоит в группе. */
// deno-lint-ignore no-explicit-any
export async function effectivePlan(u: any): Promise<Plan> {
  const base = planOf(u);
  if (!u || RANK[base] >= RANK.pro) return base;
  const { data: ms } = await db.from("group_members").select("chat_id").eq("user_id", u.id).limit(50);
  if (!ms?.length) return base;
  const { data: gs } = await db.from("groups").select("chat_id,sponsor_id").in("chat_id", ms.map((m) => m.chat_id)).eq("active", true).eq("mode", "team");
  for (const g of gs ?? []) {
    if (!g.sponsor_id) continue;
    const { data: sp } = await db.from("users").select("plan,plan_until").eq("id", g.sponsor_id).maybeSingle();
    if (planOf(sp) === "team" && (await isMember(g.chat_id, u.id))) return "pro";
  }
  return base;
}
