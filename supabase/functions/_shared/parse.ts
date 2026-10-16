// Разбор фразы вида «добавь стоматолог 25 октября в 15:00 напомнить за 30 минут»
import * as chrono from "npm:chrono-node@2.7.7";
import { localParts, tzOffsetMin, zonedToUtc } from "./time.ts";

/** 30 слов-команд (в инструкции для пользователей). Распознаются по основе слова. */
export const TRIGGER_WORDS = [
  "добавь", "добавить", "запомни", "запомнить", "назначь", "назначить", "запиши", "записать",
  "создай", "создать", "поставь", "поставить", "внеси", "занеси", "отметь", "запланируй",
  "запланировать", "закинь", "напомни", "напомнить", "зафиксируй", "сохрани", "забронируй",
  "оформи", "вставь", "пометь", "не забудь", "организуй", "планируй", "закрепи",
];
const STEMS = ["добав", "запомн", "назнач", "запиш", "запис", "созда", "постав", "внес", "занес", "отмет",
  "запланир", "закин", "напомн", "зафиксир", "сохран", "забронир", "оформ", "встав", "помет",
  "не забудь", "организ", "планир", "закреп"];
const EN_WORDS = ["add", "remind", "schedule", "book", "create", "save", "set", "note", "plan", "appointment", "remember"];
const TRIGGER_RE = new RegExp(`^\\s*(?:/add(?:@\\w+)?\\s*|(?:${STEMS.join("|")})[а-яё]*[\\s,:–-]*|(?:${EN_WORDS.join("|")})\\b[\\s,:–-]*)`, "i");

const REPEAT_RULES: [RegExp, string][] = [
  [/(?:каждый\s+день|ежедневно|каждые\s+сутки)/i, "daily"],
  [/(?:каждую\s+неделю|еженедельно|каждый\s+(?:понедельник|вторник|четверг|пятницу|субботу|воскресенье)|каждую\s+(?:среду|пятницу|субботу))/i, "weekly"],
  [/(?:каждый\s+месяц|ежемесячно)/i, "monthly"],
  [/(?:каждый\s+год|ежегодно)/i, "yearly"],
];
const WEEKDAY_FIX: [RegExp, string][] = [
  [/каждый\s+(понедельник|вторник|четверг)/i, "в $1"],
  [/каждую\s+(среду|пятницу|субботу)/i, "в $1"],
  [/каждое\s+воскресенье|каждый\s+воскресенье/i, "в воскресенье"],
  [/каждую\s+пятницу/i, "в пятницу"],
];
const UNIT_MIN: [RegExp, number][] = [
  [/^(мин|м)/i, 1], [/^(час|ч)/i, 60], [/^(дн|ден|сут)/i, 1440], [/^недел/i, 10080],
];
const REMIND_RE = /(?:(?:и\s+)?напомни(?:ть)?\s+)?за\s+(?:(\d+)\s*(мин[а-яё]*|час[а-яё]*|ч(?![а-яё])|дн[а-яё]*|день|сут[а-яё]*|недел[а-яё]*)|(полчаса|час|день|сутки|неделю)(?![а-яё]))/i;
// «через 2 часа», «через полчаса» — считаем сами (chrono неверно сочетает это с часовыми поясами)
const IN_RE = /через\s+(?:(\d+)\s*(мин[а-яё]*|час[а-яё]*|ч(?![а-яё])|дн[а-яё]*|день|сут[а-яё]*|недел[а-яё]*)|(полчаса|час|день|неделю)(?![а-яё]))/i;

/** Быстрая проверка без разбора: начинается ли сообщение со слова-команды (чтобы не нагружать базу на обычной болтовне в группе). */
export const looksLikeTrigger = (t: string) => TRIGGER_RE.test(t.replace(/@\w+bot\b/gi, "").trim());

export interface Parsed {
  trigger: boolean;
  title: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  all_day: boolean;
  repeat: string | null;
  remind: number[] | null;   // null = по умолчанию
  noRemind: boolean;
  reminder: boolean;         // команда «напомни…»: уведомить в сам момент, а не за 30 минут
}

export function parseEvent(raw: string, tz: string, now = new Date()): Parsed {
  let t = raw.replace(/@\w+bot\b/gi, "").trim();
  const trig = t.match(TRIGGER_RE);
  const trigger = !!trig && trig[0].trim().length > 0;
  const reminder = trigger && /^\s*(?:напомн|не\s*забудь|remind)/i.test(trig![0]);
  if (trigger) t = t.slice(trig![0].length);

  // повтор
  let repeat: string | null = null;
  for (const [re, rule] of REPEAT_RULES) {
    if (re.test(t)) { repeat = rule; break; }
  }
  if (repeat) {
    let replaced = false;
    for (const [re, to] of WEEKDAY_FIX) if (re.test(t)) { t = t.replace(re, to); replaced = true; break; }
    if (!replaced) for (const [re] of REPEAT_RULES) t = t.replace(re, " ");
  }

  // напоминание
  let remind: number[] | null = null;
  let noRemind = false;
  if (/без\s+напоминани[а-яё]*/i.test(t)) { noRemind = true; t = t.replace(/без\s+напоминани[а-яё]*/i, " "); }
  const rm = t.match(REMIND_RE);
  if (rm) {
    let mins = 0;
    if (rm[1]) { for (const [re, k] of UNIT_MIN) if (re.test(rm[2])) { mins = +rm[1] * k; break; } }
    else { const w = rm[3].toLowerCase(); mins = w === "полчаса" ? 30 : w === "час" ? 60 : w === "неделю" ? 10080 : 1440; }
    if (mins > 0) remind = [mins];
    t = t.replace(REMIND_RE, " ");
  }

  // «через N …»
  let starts: Date | null = null, ends: Date | null = null, allDay = false;
  const inm = t.match(IN_RE);
  if (inm) {
    let mins = 0;
    if (inm[1]) { for (const [re, k] of UNIT_MIN) if (re.test(inm[2])) { mins = +inm[1] * k; break; } }
    else { const w = inm[3].toLowerCase(); mins = w === "полчаса" ? 30 : w === "час" ? 60 : w === "неделю" ? 10080 : 1440; }
    if (mins > 0) {
      starts = new Date(Math.ceil((now.getTime() + mins * 60000) / 60000) * 60000);
      t = t.replace(IN_RE, " ");
    }
  }

  // дата и время
  if (!starts) {
    const off = tzOffsetMin(now, tz);
    const bad = (r: { text: string }) => /^(день|дня|дни|дней|ночь|утро|вечер)$/i.test(r.text.trim());
    const opts = { forwardDate: true };
    const ru = chrono.ru.parse(t, { instant: now, timezone: off }, opts).filter((r) => !bad(r));
    const en = chrono.en.parse(t, { instant: now, timezone: off }, opts);
    const best = (a: { text: string }[]) => a.reduce((m, r) => Math.max(m, r.text.length), 0);
    const results = best(en) > best(ru) ? en : ru;   // берём разбор, который «съел» больше текста (русский или английский)
    results.sort((a, b) => b.text.length - a.text.length);
    const r = results[0];
    if (r) {
      const g = (c: any, k: any) => c.get(k)!;
      const hasTime = r.start.isCertain("hour");
      const y = g(r.start, "year"), m = g(r.start, "month"), d = g(r.start, "day");
      if (hasTime) {
        starts = zonedToUtc(y, m, d, g(r.start, "hour"), g(r.start, "minute") ?? 0, tz);
        if (r.end && r.end.isCertain("hour")) {
          ends = zonedToUtc(g(r.end, "year"), g(r.end, "month"), g(r.end, "day"), g(r.end, "hour"), g(r.end, "minute") ?? 0, tz);
          if (ends <= starts) ends = null;
        }
      } else { starts = zonedToUtc(y, m, d, 0, 0, tz); allDay = true; }
      t = t.slice(0, r.index) + " " + t.slice(r.index + r.text.length);
    }
  }

  let title = t.replace(/\s+/g, " ").replace(/^[\s,.:;–—-]+|[\s,.:;–—-]+$/g, "");
  for (let i = 0; i < 3; i++) title = title.replace(/^(?:мне|нам|ему|ей|им|себе|me|us|to|that|на|в|во|о|про|что)\s+/i, "");   // «напомни мне про…» → «…»
  title = title.replace(/\s+(?:в|на|во|к|с|до|on|at|in|for|to)$/i, "").trim();
  if (title) title = title[0].toUpperCase() + title.slice(1);
  return { trigger, title: title || null, starts_at: starts, ends_at: ends, all_day: allDay, repeat, remind, noRemind, reminder };
}
/** Напоминания события: из фразы («за час»), «без напоминания», для «напомни…» — в сам момент, иначе по умолчанию (null). */
export function remindOf(p: Parsed): number[] | null { return p.noRemind ? [] : (p.remind ?? (p.reminder && !p.all_day ? [0] : null)); }

export function defaultRemind(allDay: boolean) { return allDay ? [-540] : [30]; }
