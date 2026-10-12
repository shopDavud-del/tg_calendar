// Telegram-бот: личные чаты, группы, оплата Stars, импорт .ics
import { db } from "../_shared/db.ts";
import { env } from "../_shared/env.ts";
import { answerCb, edit, esc, kb, send, tg } from "../_shared/tg.ts";
import { ensureUser, deleteAccount } from "../_shared/account.ts";
import { parseEvent, TRIGGER_WORDS } from "../_shared/parse.ts";
import { expand, fmtWhen, localParts, validTz, zonedToUtc } from "../_shared/time.ts";
import { limits, PERIOD_DAYS, PLANS, planOf, TRIAL_DAYS } from "../_shared/plans.ts";
import { planForOwner, removeEvent, saveEvent, type Input } from "../_shared/events.ts";
import { invoiceLink, reminderText, type Period } from "../_shared/payments.ts";
import { parseIcs } from "../_shared/icsparse.ts";
import { defaultRemind } from "../_shared/parse.ts";
import type { Ev } from "../_shared/reminders.ts";
import { displayName, extractMentions, findMember, isGroupAdmin, mention } from "../_shared/groups.ts";
import { createCodes, redeem } from "../_shared/promo.ts";

const BOT = () => env("BOT_USERNAME");
const ADMIN = () => Number(env("ADMIN_ID"));
const REPEAT_RU: Record<string, string> = { daily: "каждый день", weekly: "каждую неделю", monthly: "каждый месяц", yearly: "каждый год" };

Deno.serve(async (req) => {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== env("WEBHOOK_SECRET")) return new Response("forbidden", { status: 401 });
  try { await route(await req.json()); } catch (e) { console.error("bot error", e); }
  return new Response("ok");   // всегда 200, иначе Telegram будет слать повторы
});

// deno-lint-ignore no-explicit-any
type Any = any;

async function route(u: Any) {
  if (u.pre_checkout_query) return preCheckout(u.pre_checkout_query);
  if (u.callback_query) return callback(u.callback_query);
  if (u.my_chat_member) return myChatMember(u.my_chat_member);
  if (u.message) return message(u.message);
}

/* ------------------------------ тексты ------------------------------ */
const HELP = `<b>Как добавлять события</b>

Пишите по шаблону:
<code>слово  что  когда  [во сколько]  [напомнить за …]  [повтор]</code>

<b>Примеры</b>
• <code>добавь стоматолог 25 октября в 15:00</code>
• <code>назначь встречу с Аней завтра в 11:30 напомнить за 30 минут</code>
• <code>запомни день рождения мамы 3 марта каждый год</code>
• <code>поставь планёрку каждый понедельник в 10:00</code>
• <code>напомни позвонить маме через 2 часа</code>

<b>Правила</b>
1. Сначала слово-команда, потом название, потом дата и время.
2. Нет времени — событие на весь день (напомню в 9:00).
3. «Напомнить за …» — минуты, часы или дни. «Без напоминания» отключает уведомление.
4. Повтор: каждый день / неделю / месяц / год или «каждый понедельник».
5. Если я не уверен — покажу, как понял, и спрошу кнопками.

Все слова-команды: /words
Календарь: /app · Ближайшее: /list · Сегодня: /today
Тарифы: /plan · Код подписки: /code КОД · Часовой пояс: /tz Asia/Tashkent
Данные: /export · /delete`;

const WORDS = `<b>Слова-команды (30)</b>
${TRIGGER_WORDS.map((w) => esc(w)).join(", ")}.

Окончания не важны: «добавь», «добавить», «добавьте» — одно и то же.
Ещё работает <code>/add текст</code>.`;

const GROUP_HELP = `<b>Календарь группы</b>
Пишите по шаблону — я сохраню событие:
<code>добавь собрание завтра в 18:00</code>
<code>назначь тренировку в пятницу в 19:00 каждую неделю</code>

Если не уверен, спрошу «Да / Нет».
/list — ближайшие события · /app — открыть календарь
/ask on — спрашивать и про сообщения с датой без команды (по умолчанию выкл.)
/ask off — не спрашивать
/mode team — командный режим для салона (тариф Team) · /team — участники · /join — добавить себя в календарь · /notify on|off — дублировать напоминания в группу
Весь список слов-команд — /words в личном чате со мной.

<i>Чтобы я видел обычные сообщения, отключите Group Privacy в @BotFather: /mybots → ваш бот → Bot Settings → Group Privacy → Turn off. Либо сделайте меня администратором.</i>`;

/* ------------------------------ сообщения ------------------------------ */
const seen = new Set<string>();

async function message(m: Any) {
  if (m.from?.is_bot) return;
  if (m.successful_payment) return paid(m);
  const isGroup = m.chat.type === "group" || m.chat.type === "supergroup";
  if (m.chat.type === "channel") return;
  const text: string = (m.text ?? m.caption ?? "").trim();

  if (isGroup) return groupMessage(m, text);

  const user = await ensureUser(m.from.id);
  if (m.document && /\.ics$/i.test(m.document.file_name ?? "")) return importIcs(m, user);
  if (!text) return;

  if (text.startsWith("/")) {
    const [cmdRaw, ...rest] = text.split(/\s+/);
    const cmd = cmdRaw.split("@")[0].toLowerCase();
    const arg = rest.join(" ");
    if (cmd === "/add") return handleText(m, arg, user.id, false, user.tz);
    return privateCommand(m, cmd, arg, user);
  }
  return handleText(m, text, user.id, false, user.tz);
}

async function privateCommand(m: Any, cmd: string, arg: string, user: Any) {
  const chat = m.chat.id;
  switch (cmd) {
    case "/start": {
      if (arg.trim() === "plan") return plansScreen(chat, user.id);
      const fresh = Date.now() - new Date(user.created_at).getTime() < 120_000;
      const trial = fresh && TRIAL_DAYS > 0 && planOf(user) === "pro";
      await send(chat, `<b>Календарь в Telegram</b>\nПишите события обычными словами, я запомню и напомню вовремя.\n\n${trial ? `🎁 Вам открыт Pro на ${TRIAL_DAYS} дней.\n\n` : ""}Попробуйте прямо сейчас:\n<code>добавь стоматолог завтра в 15:00</code>`,
        kb([[{ text: "📅 Открыть календарь", web_app: env("APP_URL") }], [{ text: "Как пользоваться", data: "help" }]]));
      if (user.tz === "UTC") await send(chat, "Часовой пояс пока не задан. Откройте календарь — он определится сам. Или напишите, например: <code>/tz Asia/Tashkent</code>");
      return;
    }
    case "/help": return send(chat, HELP);
    case "/words": return send(chat, WORDS);
    case "/app": return send(chat, "Ваш календарь:", kb([[{ text: "📅 Открыть", web_app: env("APP_URL") }]]));
    case "/tz": {
      if (!arg || !validTz(arg.trim())) return send(chat, "Укажите пояс так: <code>/tz Asia/Tashkent</code>\nСписок: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones");
      await db.from("users").update({ tz: arg.trim() }).eq("id", user.id);
      return send(chat, `Часовой пояс: <b>${esc(arg.trim())}</b>`);
    }
    case "/today": case "/list": return listEvents(chat, user.id, user.tz, cmd === "/today");
    case "/plan": return plansScreen(chat, user.id);
    case "/code": case "/redeem": {
      if (!arg.trim()) return send(chat, "Отправьте код так: <code>/code CAL-XXXX-XXXX</code>");
      const r = await redeem(user.id, arg);
      return send(chat, r.ok ? `🎁 Код принят! Тариф <b>${PLANS[r.plan].title}</b> активен до ${new Date(r.until).toLocaleDateString("ru-RU", { timeZone: user.tz })}.` : `❌ ${esc(r.message)}`);
    }
    case "/terms": return send(chat, "<b>Условия</b>\nТарифы Plus и Pro оплачиваются в Telegram Stars. Месячная подписка продлевается каждые 30 дней; отменить можно в любой момент: Настройки Telegram → Мои звёзды → Подписки. Оплаченный период сохраняется до конца. Возврат — по запросу через /paysupport.\nМы храним только ваш Telegram ID, часовой пояс, настройки и события.");
    case "/paysupport": return send(chat, `По оплате и возвратам напишите администратору: <a href="tg://user?id=${ADMIN()}">связаться</a>. Укажите, что и когда оплачивали.`);
    case "/export": return exportData(chat, user.id);
    case "/delete":
      return send(chat, "⚠️ Удалить <b>все</b> ваши события и настройки, отключить Google? Это нельзя отменить.", kb([[{ text: "Да, удалить всё", data: "del:yes" }, { text: "Отмена", data: "del:no" }]]));
  }
  if (m.from.id === ADMIN()) return adminCommand(m, cmd, arg);
}

async function adminCommand(m: Any, cmd: string, arg: string) {
  const chat = m.chat.id;
  const a = arg.split(/\s+/);
  if (cmd === "/newcode") {   // /newcode <plus|pro|team> <дней> [использований] [штук]
    const [plan, days, uses, count] = [a[0], Number(a[1]), Number(a[2] ?? 1), Number(a[3] ?? 1)];
    if (!["plus", "pro", "team"].includes(plan) || !days) return send(chat, "/newcode <plus|pro|team> <дней> [использований] [штук]\nнапример: <code>/newcode pro 30 1 5</code>");
    const codes = await createCodes({ plan: plan as "plus", days, uses, count });
    return send(chat, codes.length ? `Коды (${plan}, ${days} дн., по ${uses} исп.):\n<code>${codes.join("\n")}</code>` : "Не удалось создать коды (проверьте миграцию 002).");
  }
  if (cmd === "/stats") {
    const { data: tick } = await db.from("meta").select("value").eq("key", "last_tick").maybeSingle();
    const ago = tick ? Math.round((Date.now() - new Date(tick.value as string).getTime()) / 60000) : null;
    await send(chat, ago === null ? "⏱ Планировщик ещё ни разу не запускался: выполните supabase/cron.sql" : ago <= 3 ? `⏱ Планировщик работает (последний запуск ${ago} мин назад)` : `⚠️ Планировщик молчит ${ago} мин: проверьте cron.sql`);
    const [u, e, g, p] = await Promise.all([
      db.from("users").select("id", { count: "exact", head: true }),
      db.from("events").select("id", { count: "exact", head: true }),
      db.from("groups").select("chat_id", { count: "exact", head: true }).eq("active", true),
      db.from("users").select("id", { count: "exact", head: true }).neq("plan", "free").gt("plan_until", new Date().toISOString()),
    ]);
    return send(chat, `👥 Пользователей: ${u.count}\n💎 С платным/пробным тарифом: ${p.count}\n👥 Групп: ${g.count}\n📌 Событий: ${e.count}`);
  }
  if (cmd === "/grant") {   // /grant <user_id> <plus|pro|free> <дней>
    const [id, plan, days] = [Number(a[0]), a[1], Number(a[2] ?? 30)];
    if (!id || !["free", "plus", "pro"].includes(plan)) return send(chat, "/grant <user_id> <plus|pro|free> <дней>");
    await ensureUser(id);
    await db.from("users").update({ plan, plan_until: new Date(Date.now() + days * 86400000).toISOString() }).eq("id", id);
    return send(chat, `Готово: ${id} → ${plan} на ${days} дн.`);
  }
  if (cmd === "/refund") {  // /refund <user_id> <charge_id>
    const j = await tg("refundStarPayment", { user_id: Number(a[0]), telegram_payment_charge_id: a[1] });
    if (j.ok) {
      await db.from("payments").update({ refunded: true }).eq("charge_id", a[1]);
      await db.from("users").update({ plan: "free", plan_until: null }).eq("id", Number(a[0]));
    }
    return send(chat, j.ok ? "Возврат выполнен, тариф снят." : `Ошибка: ${esc(JSON.stringify(j))}`);
  }
}

/* ------------------------------ группы ------------------------------ */
async function groupMessage(m: Any, text: string) {
  const chat = m.chat;
  let { data: g } = await db.from("groups").select("*").eq("chat_id", chat.id).maybeSingle();
  if (!g) g = await joinGroup(chat, m.from.id, false);
  if (!g) return;

  const key = `${chat.id}:${m.from.id}`;
  if (!seen.has(key)) {
    seen.add(key);
    if (seen.size > 5000) seen.clear();
    await db.from("group_members").upsert({ chat_id: chat.id, user_id: m.from.id, username: m.from.username ?? null, name: displayName(m.from) }, { onConflict: "chat_id,user_id" });
  }
  if (!text) return;

  if (text.startsWith("/")) {
    const [cmdRaw, ...rest] = text.split(/\s+/);
    const [cmd0, target] = cmdRaw.split("@");
    if (target && target.toLowerCase() !== BOT().toLowerCase()) return;   // команда для другого бота
    const cmd = cmd0.toLowerCase(), arg = rest.join(" ");
    if (cmd === "/start" || cmd === "/help") return send(chat.id, GROUP_HELP);
    if (cmd === "/words") return send(chat.id, WORDS);
    if (cmd === "/app") return send(chat.id, "Календарь открывается в личном чате с ботом:", kb([[{ text: "📅 Открыть календарь", url: `https://t.me/${BOT()}?startapp=g${Math.abs(chat.id)}` }]]));
    if (cmd === "/activate") return activateGroup(m, g);
    if (cmd === "/join") return send(chat.id, `✅ ${mention(m.from.id, displayName(m.from))}, вы в календаре группы.`);
    if (cmd === "/mode") return setMode(m, g, arg);
    if (cmd === "/team") return listTeam(chat.id);
    if (cmd === "/notify") {
      const on = /^(on|вкл|да)/i.test(arg.trim());
      if (!(await isGroupAdmin(chat.id, m.from.id, g.sponsor_id))) return send(chat.id, "Только для администраторов группы.");
      await db.from("groups").update({ notify_group: on }).eq("chat_id", chat.id);
      return send(chat.id, on ? "Напоминания о записях буду дублировать в группу." : "Напоминания о записях буду присылать только в личные сообщения.");
    }
    if (!g.active) return send(chat.id, "Календарь этой группы выключен: превышен лимит групп в тарифе. Владелец может нажать /activate после обновления тарифа.");
    if (cmd === "/list" || cmd === "/today") { const { tz } = await planForOwner(chat.id); return listEvents(chat.id, chat.id, tz, cmd === "/today", g.mode === "team"); }
    if (cmd === "/ask") {
      const on = /^(on|вкл|да)/i.test(arg.trim());
      if (!arg.trim()) return send(chat.id, `Сейчас: ${g.ask_unclear ? "спрашиваю про сообщения с датой" : "реагирую только на слова-команды"}.\n/ask on или /ask off`);
      await db.from("groups").update({ ask_unclear: on }).eq("chat_id", chat.id);
      return send(chat.id, on ? "Буду спрашивать «добавить?» про сообщения, где вижу дату." : "Реагирую только на сообщения со словом-командой.");
    }
    if (cmd === "/add") return g.mode === "team" ? handleTeamText(m, arg, g) : handleText(m, arg, chat.id, true, (await planForOwner(chat.id)).tz, g);
    return;
  }
  if (!g.active) return;
  if (g.mode === "team") return handleTeamText(m, text, g);
  const { tz } = await planForOwner(chat.id);
  return handleText(m, text, chat.id, true, tz, g);
}

async function joinGroup(chat: Any, fromId: number, announce: boolean) {
  const user = await ensureUser(fromId);
  const { count } = await db.from("groups").select("chat_id", { count: "exact", head: true }).eq("sponsor_id", fromId).eq("active", true).neq("chat_id", chat.id);
  const lim = limits(planOf(user));
  const active = (count ?? 0) < lim.maxGroups;
  const { data } = await db.from("groups").upsert({ chat_id: chat.id, title: chat.title ?? null, sponsor_id: fromId, active }, { onConflict: "chat_id" }).select().single();
  if (announce) {
    await send(chat.id, active ? `Привет! Я сохраняю события группы в общий календарь.\n\n${GROUP_HELP}` : `Календарь группы пока выключен: в вашем тарифе до ${lim.maxGroups} групп. Обновите тариф (/plan у меня в личке) и нажмите здесь /activate.`);
  }
  return data;
}
async function activateGroup(m: Any, g: Any) {
  if (m.from.id !== g.sponsor_id && m.from.id !== ADMIN()) return send(m.chat.id, "Включить группу может тот, кто её подключил.");
  const user = await ensureUser(g.sponsor_id);
  const { count } = await db.from("groups").select("chat_id", { count: "exact", head: true }).eq("sponsor_id", g.sponsor_id).eq("active", true).neq("chat_id", g.chat_id);
  if ((count ?? 0) >= limits(planOf(user)).maxGroups) return send(m.chat.id, "Лимит групп в вашем тарифе исчерпан. Тарифы — /plan в личном чате со мной.");
  await db.from("groups").update({ active: true }).eq("chat_id", g.chat_id);
  return send(m.chat.id, "✅ Календарь группы включён.");
}
async function myChatMember(c: Any) {
  const chat = c.chat;
  if (chat.type !== "group" && chat.type !== "supergroup") return;
  const st = c.new_chat_member?.status;
  if (st === "member" || st === "administrator") return void (await joinGroup(chat, c.from.id, true));
  if (st === "left" || st === "kicked") await db.from("groups").update({ active: false }).eq("chat_id", chat.id);
}

/* ------------------------------ разбор текста ------------------------------ */
async function handleText(m: Any, text: string, owner: number, isGroup: boolean, tz: string, group?: Any) {
  const chat = m.chat.id;
  const p = parseEvent(text, tz);
  const reply = (t: string, extra: Record<string, unknown> = {}) => send(chat, t, { reply_to_message_id: m.message_id, ...extra });
  const base = { owner_id: owner, created_by: m.from.id, tz, source: "bot" };

  if (p.trigger && p.title && p.starts_at) {
    return createFromParsed(chat, m.message_id, { ...base, title: p.title, starts_at: p.starts_at.toISOString(), ends_at: p.ends_at?.toISOString() ?? null, all_day: p.all_day, repeat: p.repeat, remind: p.noRemind ? [] : p.remind });
  }
  const todayStart = () => { const l = localParts(new Date(), tz); return zonedToUtc(l.y, l.m, l.d, 0, 0, tz); };

  if (p.trigger && p.title && !p.starts_at) {
    if (!isGroup) return reply("Не нашёл дату. Напишите, когда, например:\n<code>добавь " + esc(p.title.toLowerCase()) + " завтра в 15:00</code>");
    return askYesNo(chat, m, { ...base, title: p.title, starts_at: todayStart().toISOString(), all_day: true, repeat: p.repeat, remind: p.remind },
      `Не нашёл дату. Добавить «<b>${esc(p.title)}</b>» на сегодня (весь день)?`);
  }
  if (!p.trigger && p.title && p.starts_at && (!isGroup || group?.ask_unclear)) {
    const when = fmtWhen(p.starts_at, tz, p.all_day);
    return askYesNo(chat, m, { ...base, title: p.title, starts_at: p.starts_at.toISOString(), ends_at: p.ends_at?.toISOString() ?? null, all_day: p.all_day, repeat: p.repeat, remind: p.noRemind ? [] : p.remind },
      `Это событие? Добавить в календарь?\n📌 <b>${esc(p.title)}</b>\n🗓 ${esc(when)}`);
  }
  if (!isGroup) return reply("Не понял 🤔 Начните со слова-команды и укажите дату:\n<code>добавь встреча завтра в 11:00</code>\n\nПодробнее: /help");
}

async function askYesNo(chat: number, m: Any, payload: Record<string, unknown>, text: string) {
  const { data } = await db.from("pending").insert({ chat_id: chat, user_id: m.from.id, payload }).select("id").single();
  if (!data) return;
  await send(chat, text, { reply_to_message_id: m.message_id, ...kb([[{ text: "✅ Да", data: `y:${data.id}` }, { text: "✖️ Нет", data: `n:${data.id}` }]]) });
}

async function createFromParsed(chat: number, replyTo: number | null, inp: Omit<Input, "remind"> & { remind?: number[] | null }, editMsg?: number) {
  const r = await saveEvent({ ...inp, remind: inp.remind ?? null } as Input);
  const isPrivate = inp.owner_id > 0;
  if (!r.ok) {
    const txt = r.reason === "limit" ? `🔒 ${esc(r.message)}\nЧтобы снять ограничение, выберите тариф.` : `Не получилось: ${esc(r.message)}`;
    const extra = r.reason === "limit"
      ? kb([[isPrivate ? { text: "⭐ Тарифы", data: "plans" } : { text: "⭐ Тарифы", url: `https://t.me/${BOT()}?start=plan` }]]) : {};
    return editMsg ? edit(chat, editMsg, txt, extra) : send(chat, txt, { reply_to_message_id: replyTo ?? undefined, ...extra });
  }
  const ev = r.ev;
  const lines = [
    `✅ <b>Добавлено</b>`, `📌 ${esc(ev.title)}`,
    `🗓 ${esc(fmtWhen(new Date(ev.starts_at), ev.tz, ev.all_day))}${ev.ends_at && !ev.all_day ? ` – ${new Intl.DateTimeFormat("ru-RU", { timeZone: ev.tz, hour: "2-digit", minute: "2-digit" }).format(new Date(ev.ends_at))}` : ""}`,
  ];
  if (ev.repeat) lines.push(`🔁 ${REPEAT_RU[ev.repeat]}`);
  lines.push(`🔔 ${reminderText(ev.remind)}`);
  for (const n of r.notes) lines.push(`ℹ️ ${esc(n)}`);
  const rows = [[{ text: "↩️ Отменить", data: `undo:${ev.id}` }]];
  if (isPrivate) rows[0].push({ text: "📅 Календарь", web_app: env("APP_URL") } as never);
  const extra = kb(rows as never);
  return editMsg ? edit(chat, editMsg, lines.join("\n"), extra) : send(chat, lines.join("\n"), { reply_to_message_id: replyTo ?? undefined, ...extra });
}

/* ------------------------------ кнопки ------------------------------ */
async function callback(q: Any) {
  const data: string = q.data ?? "";
  const chat = q.message?.chat?.id, mid = q.message?.message_id;
  if (!chat) return answerCb(q.id);

  if (data.startsWith("y:") || data.startsWith("n:")) {
    const id = data.slice(2);
    const { data: p } = await db.from("pending").select("*").eq("id", id).maybeSingle();
    if (!p) { await answerCb(q.id, "Запрос устарел"); return edit(chat, mid, "Запрос устарел."); }
    if (p.user_id !== q.from.id) return answerCb(q.id, "Это не ваш запрос", true);
    await db.from("pending").delete().eq("id", id);
    await answerCb(q.id);
    if (data[0] === "n") return edit(chat, mid, "Хорошо, не добавляю.");
    return createFromParsed(chat, null, p.payload, mid);
  }
  if (data.startsWith("undo:")) {
    const id = data.slice(5);
    const { data: ev } = await db.from("events").select("owner_id,created_by").eq("id", id).maybeSingle();
    if (!ev) { await answerCb(q.id, "Уже удалено"); return edit(chat, mid, "Событие удалено."); }
    if (ev.created_by !== q.from.id && ev.owner_id !== q.from.id) return answerCb(q.id, "Отменить может тот, кто добавил", true);
    await removeEvent(id, ev.owner_id);
    await answerCb(q.id, "Отменено");
    return edit(chat, mid, "↩️ Событие отменено.");
  }
  if (data === "plans") { await answerCb(q.id); return plansScreen(chat, q.from.id); }
  if (data === "help") { await answerCb(q.id); return send(chat, HELP); }
  if (data === "del:no") { await answerCb(q.id); return edit(chat, mid, "Отменено, ничего не удалено."); }
  if (data === "del:yes") {
    await deleteAccount(q.from.id);
    await answerCb(q.id);
    return edit(chat, mid, "🗑 Все ваши данные удалены. Если захотите вернуться — просто напишите /start.");
  }
  if (data === "ka:ok") {
    await db.from("meta").upsert({ key: "last_ack", value: new Date().toISOString(), updated_at: new Date().toISOString() });
    await answerCb(q.id, "Спасибо!");
    return edit(chat, mid, "✅ Всё в порядке. Следующая проверка через 5 дней.");
  }
  return answerCb(q.id);
}

/* ------------------------------ списки ------------------------------ */
async function listEvents(chat: number, owner: number, tz: string, todayOnly: boolean, byGroup = false) {
  const base = db.from("events").select("*");
  const { data } = await (byGroup ? base.eq("group_id", owner) : base.eq("owner_id", owner)).limit(500);
  const names = new Map<number, string>();
  if (byGroup) { const { data: mem } = await db.from("group_members").select("user_id,name,username").eq("chat_id", owner); for (const x of mem ?? []) names.set(x.user_id, x.name || (x.username ? "@" + x.username : "")); }
  const now = new Date();
  const l = localParts(now, tz);
  const from = todayOnly ? zonedToUtc(l.y, l.m, l.d, 0, 0, tz) : now;
  const to = todayOnly ? zonedToUtc(l.y, l.m, l.d + 1, 0, 0, tz) : new Date(now.getTime() + 60 * 86400000);
  const items = ((data ?? []) as Ev[]).flatMap((ev) => expand(ev, from, to).map((o) => ({ ev, start: o.start })))
    .sort((a, b) => +a.start - +b.start).slice(0, 12);
  if (!items.length) return send(chat, todayOnly ? "Сегодня событий нет 🌿" : "Ближайших событий нет. Добавьте: <code>добавь встреча завтра в 11:00</code>");
  const fmt = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fmtD = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "numeric", month: "short" });
  const rows = items.map((i) => `• ${i.ev.all_day ? fmtD.format(i.start) : fmt.format(i.start)} — ${esc(i.ev.title)}${byGroup && names.get(i.ev.owner_id) ? ` (${esc(names.get(i.ev.owner_id)!)})` : ""}`);
  return send(chat, `<b>${todayOnly ? "Сегодня" : "Ближайшие события"}</b>\n${rows.join("\n")}`);
}

/* ------------------------------ тарифы и оплата ------------------------------ */
async function plansScreen(chat: number, uid: number) {
  const user = await ensureUser(uid);
  const cur = planOf(user);
  const until = user.plan_until ? new Date(user.plan_until).toLocaleDateString("ru-RU", { timeZone: user.tz }) : "";
  const lf = limits("free");
  const text = `<b>Тарифы</b>\nСейчас: <b>${PLANS[cur].title}</b>${cur !== "free" ? ` (до ${until})` : ""}\n\n` +
    `<b>Free</b> — бесплатно\nдо ${lf.maxEvents} активных событий, 1 напоминание, 1 группа, 2 темы\n\n` +
    `<b>Plus</b> — ${PLANS.plus.stars.month}⭐/мес или ${PLANS.plus.stars.year}⭐/год\nбез лимита событий, повторы, до 3 напоминаний, все 8 тем, подписка для Apple/Google (ICS), 3 группы\n\n` +
    `<b>Pro</b> — ${PLANS.pro.stars.month}⭐/мес или ${PLANS.pro.stars.year}⭐/год\nвсё из Plus + синхронизация с Google Календарём, до 5 напоминаний, группы без лимита\n\n` +
    `<b>Team</b> — ${PLANS.team.stars.month}⭐/мес или ${PLANS.team.stars.year}⭐/год\nвсё из Pro + командный режим для салонов: у каждого сотрудника своя вкладка, запись «на сотрудника» по @нику, админ видит всех, напоминания в группу\n\n` +
    `Месячная подписка продлевается сама, отмена в любой момент: Настройки Telegram → Мои звёзды → Подписки.`;
  const [tm, ty] = await Promise.all([invoiceLink(uid, "team", "month"), invoiceLink(uid, "team", "year")]);
  const [pm, py, rm, ry] = await Promise.all([
    invoiceLink(uid, "plus", "month"), invoiceLink(uid, "plus", "year"), invoiceLink(uid, "pro", "month"), invoiceLink(uid, "pro", "year"),
  ]);
  const rows: { text: string; url: string }[][] = [];
  if (pm && py) rows.push([{ text: `Plus · ${PLANS.plus.stars.month}⭐/мес`, url: pm }, { text: `Plus · ${PLANS.plus.stars.year}⭐/год`, url: py }]);
  if (rm && ry) rows.push([{ text: `Pro · ${PLANS.pro.stars.month}⭐/мес`, url: rm }, { text: `Pro · ${PLANS.pro.stars.year}⭐/год`, url: ry }]);
  if (tm && ty) rows.push([{ text: `Team · ${PLANS.team.stars.month}⭐/мес`, url: tm }, { text: `Team · ${PLANS.team.stars.year}⭐/год`, url: ty }]);
  return send(chat, text, rows.length ? kb(rows) : {});
}

async function preCheckout(q: Any) {
  const [plan, period, uid] = String(q.invoice_payload ?? "").split(":");
  const ok = (plan === "plus" || plan === "pro" || plan === "team") && (period === "month" || period === "year") && Number(uid) === q.from.id
    && q.total_amount === PLANS[plan].stars[period as Period] && q.currency === "XTR";
  await tg("answerPreCheckoutQuery", { pre_checkout_query_id: q.id, ok, ...(ok ? {} : { error_message: "Не удалось проверить заказ. Попробуйте открыть /plan заново." }) });
}

async function paid(m: Any) {
  const sp = m.successful_payment;
  const [plan, period, uidS] = String(sp.invoice_payload).split(":") as [string, Period, string];
  const uid = Number(uidS);
  if (uid !== m.from.id) return;
  const { error } = await db.from("payments").insert({
    charge_id: sp.telegram_payment_charge_id, user_id: uid, plan, period, stars: sp.total_amount, is_recurring: !!sp.is_recurring,
  });
  if (error) return;   // уже обработан (повторная доставка)
  const user = await ensureUser(uid);
  const now = Date.now();
  let until: number;
  if (sp.subscription_expiration_date) until = sp.subscription_expiration_date * 1000;
  else {
    const same = user.plan === plan && user.plan_until && new Date(user.plan_until).getTime() > now;
    until = (same ? new Date(user.plan_until!).getTime() : now) + PERIOD_DAYS[period] * 86400000;
  }
  await db.from("users").update({ plan, plan_until: new Date(until).toISOString() }).eq("id", uid);
  const d = new Date(until).toLocaleDateString("ru-RU", { timeZone: user.tz });
  await send(m.chat.id, sp.is_recurring && !sp.is_first_recurring
    ? `🔄 Подписка <b>${PLANS[plan as "plus"].title}</b> продлена до ${d}. Спасибо!`
    : `🎉 Готово! Тариф <b>${PLANS[plan as "plus"].title}</b> активен до ${d}.`, kb([[{ text: "📅 Открыть календарь", web_app: env("APP_URL") }]]));
  await send(ADMIN(), `💰 +${sp.total_amount}⭐ · ${plan}/${period} · user ${uid}\n<code>${esc(sp.telegram_payment_charge_id)}</code>`);
}

/* ------------------------------ экспорт / импорт ------------------------------ */
async function exportData(chat: number, uid: number) {
  const [u, ev] = await Promise.all([
    db.from("users").select("id,tz,plan,plan_until,settings,created_at").eq("id", uid).single(),
    db.from("events").select("title,notes,starts_at,ends_at,all_day,repeat,remind,tz,source,created_at").eq("owner_id", uid),
  ]);
  const json = JSON.stringify({ user: u.data, events: ev.data }, null, 2);
  const fd = new FormData();
  fd.append("chat_id", String(chat));
  fd.append("caption", "Ваши данные");
  fd.append("document", new Blob([json], { type: "application/json" }), "calendar-export.json");
  await fetch(`https://api.telegram.org/bot${env("BOT_TOKEN")}/sendDocument`, { method: "POST", body: fd });
}

async function importIcs(m: Any, user: Any) {
  const chat = m.chat.id;
  if (m.document.file_size > 1_000_000) return send(chat, "Файл слишком большой (до 1 МБ).");
  const f = await tg("getFile", { file_id: m.document.file_id });
  if (!f.ok) return send(chat, "Не удалось скачать файл.");
  const txt = await (await fetch(`https://api.telegram.org/file/bot${env("BOT_TOKEN")}/${f.result.file_path}`)).text();
  const list = parseIcs(txt, user.tz).slice(0, 300);
  if (!list.length) return send(chat, "В файле не нашлось событий.");
  let ok = 0, stopped = "";
  for (const e of list) {
    const r = await saveEvent({
      owner_id: user.id, title: e.title, notes: e.notes, starts_at: e.starts_at.toISOString(), ends_at: e.ends_at?.toISOString() ?? null,
      all_day: e.all_day, repeat: e.repeat, remind: null, created_by: user.id, source: "ics", tz: e.tz,
    });
    if (r.ok) ok++; else if (r.reason === "limit") { stopped = r.message; break; }
  }
  return send(chat, `📥 Импортировано событий: <b>${ok}</b> из ${list.length}.${stopped ? `\n🔒 ${esc(stopped)} Остальные не добавлены.` : ""}`,
    stopped ? kb([[{ text: "⭐ Тарифы", data: "plans" }]]) : {});
}


/* ------------------------------ командный режим (салон) ------------------------------ */
async function setMode(m: Any, g: Any, arg: string) {
  const chat = m.chat.id;
  if (!(await isGroupAdmin(chat, m.from.id, g.sponsor_id))) return send(chat, "Менять режим могут администраторы группы.");
  const want = arg.trim().toLowerCase();
  if (want !== "team" && want !== "shared") return send(chat, `Сейчас: <b>${g.mode === "team" ? "команда (у каждого сотрудника свой календарь)" : "общий календарь"}</b>.\n/mode team или /mode shared`);
  if (want === "team") {
    const { plan } = await planForOwner(chat);
    if (!limits(plan).team) return send(chat, "Командный режим входит в тариф <b>Team</b>. Тарифы: /plan в личном чате со мной (тариф действует по владельцу группы).", kb([[{ text: "⭐ Тарифы", url: `https://t.me/${BOT()}?start=plan` }]]));
  }
  await db.from("groups").update({ mode: want }).eq("chat_id", chat);
  return send(chat, want === "team"
    ? "✅ Командный режим включён.\nСотрудники: пусть каждый напишет в группе /join.\nЗапись: <code>запиши Анна маникюр завтра в 15:00 @мастер</code>\nБез @ника запись получит тот, кто написал."
    : "✅ Общий календарь группы.");
}
async function listTeam(chat: number) {
  const { data } = await db.from("group_members").select("user_id,name,username").eq("chat_id", chat).limit(100);
  const rows = (data ?? []).map((x) => `• ${mention(x.user_id, x.name || "участник")}${x.username ? ` (@${x.username})` : ""}`);
  return send(chat, rows.length ? `<b>Сотрудники в календаре</b>\n${rows.join("\n")}\n\nЕсли человека нет в списке — пусть напишет /join.` : "Пока никого. Пусть каждый напишет /join.");
}

async function handleTeamText(m: Any, text: string, g: Any) {
  const chat = m.chat.id;
  const { tz } = await planForOwner(chat);
  const { cleaned, mentions } = extractMentions(text, m.entities ?? m.caption_entities, BOT());
  const p = parseEvent(cleaned, tz);
  const reply = (t: string, extra: Record<string, unknown> = {}) => send(chat, t, { reply_to_message_id: m.message_id, ...extra });
  if (!p.trigger || !p.title) return;
  if (!p.starts_at) return reply("Не нашёл дату. Пример: <code>запиши Анна маникюр завтра в 15:00 @мастер</code>");

  let assignee = m.from.id as number, aName = displayName(m.from);
  if (mentions.length) {
    const mem = await findMember(chat, mentions[0]);
    if (!mem) return reply(`Не знаю @${esc(mentions[0].username ?? "")} в этой группе. Пусть напишет здесь /join.`);
    assignee = mem.user_id; aName = mem.name || (mem.username ? "@" + mem.username : "сотрудник");
  }
  if (assignee !== m.from.id && !(await isGroupAdmin(chat, m.from.id, g.sponsor_id)))
    return reply("Записывать на других сотрудников могут только администраторы группы.");
  await db.from("group_members").upsert({ chat_id: chat, user_id: assignee, ...(assignee === m.from.id ? { username: m.from.username ?? null, name: aName } : {}) }, { onConflict: "chat_id,user_id" });
  await ensureUser(assignee);

  const r = await saveEvent({ owner_id: assignee, group_id: chat, created_by: m.from.id, tz, source: "bot", title: p.title,
    starts_at: p.starts_at.toISOString(), ends_at: p.ends_at?.toISOString() ?? null, all_day: p.all_day, repeat: p.repeat, remind: p.noRemind ? [] : p.remind });
  if (!r.ok) return reply(`🔒 ${esc(r.message)}`);
  const ev = r.ev;
  const when = fmtWhen(new Date(ev.starts_at), tz, ev.all_day);
  let note = "";
  if (assignee !== m.from.id) {
    const dm = await send(assignee, `📌 <b>Вам назначена запись</b>\n${esc(ev.title)}\n🗓 ${esc(when)}\n🔔 ${reminderText(ev.remind)}\n\nНазначил(а): ${esc(displayName(m.from))}\nГруппа: ${esc(m.chat.title ?? "")}`);
    if (!dm.ok) note = `\nℹ️ ${esc(aName)} ещё не запускал(а) бота: личные уведомления не придут. Пусть откроет @${BOT()} и нажмёт /start.`;
  }
  for (const n of r.notes) note += `\nℹ️ ${esc(n)}`;
  return reply(`✅ <b>Запись для ${mention(assignee, aName)}</b>\n📌 ${esc(ev.title)}\n🗓 ${esc(when)}${ev.repeat ? `\n🔁 ${REPEAT_RU[ev.repeat]}` : ""}\n🔔 ${reminderText(ev.remind)}${note}`,
    kb([[{ text: "↩️ Отменить", data: `undo:${ev.id}` }]]));
}
