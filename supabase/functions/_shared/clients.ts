// Карточки клиентов и заготовки сообщений. Бот НЕ может писать клиенту первым (Telegram запрещает),
// поэтому он готовит текст и ссылки, а отправляет человек (админ или мастер) в один клик.
import { db } from "./db.ts";
import { fmtWhen } from "./time.ts";
import { getLang, locale, type Lang } from "./i18n.ts";

/** Телефон: +998 90 123-45-67 → +998901234567. Возвращает номер и текст без него. */
export function extractPhone(text: string): { cleaned: string; phone: string | null } {
  const m = text.match(/(?<![\d])(\+?\d[\d\s().-]{7,17}\d)(?![\d])/);
  if (!m) return { cleaned: text, phone: null };
  const digits = m[1].replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return { cleaned: text, phone: null };
  return { cleaned: text.replace(m[1], " ").replace(/\s+/g, " ").trim(), phone: "+" + digits };
}

export async function upsertClient(scope: number, c: { phone?: string | null; username?: string | null; name?: string | null }) {
  if (!c.phone && !c.username) return null;
  const q = db.from("clients").select("*").eq("scope_id", scope);
  const { data } = await (c.phone ? q.eq("phone", c.phone) : q.ilike("username", c.username!)).maybeSingle();
  if (data) {
    const patch: Record<string, unknown> = {};
    if (c.phone && !data.phone) patch.phone = c.phone;
    if (c.username && !data.username) patch.username = c.username;
    if (c.name && !data.name) patch.name = c.name;
    if (Object.keys(patch).length) await db.from("clients").update(patch).eq("id", data.id);
    return { ...data, ...patch };
  }
  const { data: created } = await db.from("clients").insert({ scope_id: scope, phone: c.phone ?? null, username: c.username ?? null, name: c.name ?? null }).select().single();
  return created;
}

const DRAFT: Record<Lang, (n: string, t: string, w: string) => string> = {
  ru: (n, t, w) => `Здравствуйте${n ? ", " + n : ""}! Напоминаем о записи: ${t}, ${w}. Ждём вас!`,
  en: (n, t, w) => `Hello${n ? " " + n : ""}! A reminder about your appointment: ${t}, ${w}. See you soon!`,
  uz: (n, t, w) => `Assalomu alaykum${n ? ", " + n : ""}! Yozilganingizni eslatamiz: ${t}, ${w}. Sizni kutamiz!`,
  de: (n, t, w) => `Guten Tag${n ? " " + n : ""}! Wir erinnern Sie an Ihren Termin: ${t}, ${w}. Wir freuen uns auf Sie!`,
  ja: (n, t, w) => `こんにちは${n ? n + "様" : ""}！ご予約のお知らせです：${t}、${w}。お待ちしております。`,
  tr: (n, t, w) => `Merhaba${n ? " " + n : ""}! Randevunuzu hatırlatırız: ${t}, ${w}. Sizi bekliyoruz!`,
};
// deno-lint-ignore no-explicit-any
export function draftText(ev: any, client: any, tz: string) {
  const when = fmtWhen(new Date(ev.starts_at), tz, ev.all_day);
  return DRAFT[getLang()](client?.name ?? "", ev.title, when);
}
/** Кнопки-ссылки: открыть чат с клиентом с готовым текстом. Для номера текст подставляется не всегда. */
// deno-lint-ignore no-explicit-any
export function draftLinks(client: any, text: string) {
  const enc = encodeURIComponent(text), row: { text: string; url: string }[] = [];
  if (client?.username) row.push({ text: "✉️ Telegram @" + client.username, url: `https://t.me/${client.username}?text=${enc}` });
  if (client?.phone) {
    const d = client.phone.replace(/\D/g, "");
    row.push({ text: "✉️ Telegram " + client.phone, url: `https://t.me/+${d}` });
    row.push({ text: "WhatsApp", url: `https://wa.me/${d}?text=${enc}` });
  }
  return row;
}
// deno-lint-ignore no-explicit-any
export async function clientCardText(c: any, tz: string, esc: (s: string) => string) {
  const now = new Date().toISOString();
  const [past, next, last] = await Promise.all([
    db.from("events").select("id", { count: "exact", head: true }).eq("client_id", c.id).lt("starts_at", now),
    db.from("events").select("title,starts_at,all_day").eq("client_id", c.id).gte("starts_at", now).order("starts_at").limit(1).maybeSingle(),
    db.from("events").select("title,starts_at,all_day").eq("client_id", c.id).lt("starts_at", now).order("starts_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const f = (e: { starts_at: string; all_day: boolean; title: string }) => `${esc(fmtWhen(new Date(e.starts_at), tz, e.all_day))} — ${esc(e.title)}`;
  const contact = [c.phone, c.username ? "@" + c.username : ""].filter(Boolean).join(" · ");
  return `👤 <b>${esc(c.name || "Клиент")}</b>${contact ? `\n${esc(contact)}` : ""}\nВизитов: <b>${past.count ?? 0}</b>` +
    (last.data ? `\nПоследний визит: ${f(last.data)}` : "") + (next.data ? `\nБлижайшая запись: ${f(next.data)}` : "") +
    (c.note ? `\n📝 Заметка: ${esc(c.note)}` : "");
}
void locale;
