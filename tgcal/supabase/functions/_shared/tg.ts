import { env } from "./env.ts";
import { tr, trKb } from "./i18n.ts";
const API = () => `https://api.telegram.org/bot${env("BOT_TOKEN")}`;

export async function tg(method: string, body: Record<string, unknown> = {}) {
  const r = await fetch(`${API()}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!j.ok) console.error("TG error", method, JSON.stringify(j).slice(0, 300));
  return j;
}
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const trExtra = (extra: Record<string, unknown>) => (extra.reply_markup ? { ...extra, reply_markup: trKb(extra.reply_markup) } : extra);
export const send = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id, text: tr(text), parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...trExtra(extra) });
export const edit = (chat_id: number, message_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("editMessageText", { chat_id, message_id, text: tr(text), parse_mode: "HTML", ...trExtra(extra) });
export const answerCb = (id: string, text?: string, alert = false) =>
  tg("answerCallbackQuery", { callback_query_id: id, text, show_alert: alert });
export const kb = (rows: { text: string; data?: string; url?: string; web_app?: string }[][]) => ({
  reply_markup: {
    inline_keyboard: rows.map((r) => r.map((b) => ({
      text: b.text,
      ...(b.data ? { callback_data: b.data } : {}),
      ...(b.url ? { url: b.url } : {}),
      ...(b.web_app ? { web_app: { url: b.web_app } } : {}),
    }))),
  },
});
export const appUrl = () => env("APP_URL");
