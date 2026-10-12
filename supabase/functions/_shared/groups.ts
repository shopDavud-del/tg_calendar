import { db } from "./db.ts";
import { tg } from "./tg.ts";

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
