// Настройки пользователя: значения по умолчанию и проверка того, что прислал клиент.
export const DEFAULT_SETTINGS = {
  onboarded: false,          // прошёл ли человек обучение при первом входе
  lang: "" as string,         // язык интерфейса; пусто = по языку Telegram
  theme: "midnight", radius: 22, week_start: 1, view: "month",
  tile_dim: 7,              // яркость серых плиток дней, 0…30
  mark_style: "scribble",   // scribble | stroke | dot
  sel_style: "fill",        // fill | ring
  multi_style: "bars",      // bars | frame | ribbon | ends | dots | none — как отмечать многодневные задачи
  done_style: "strike",     // strike | marker | fade — как показывать выполненные
  remind: [30],             // напоминания по умолчанию (минут до начала)
  allday_hour: 9,           // во сколько напоминать о событиях «на весь день»
  digest_morning: null as string | null,   // "08:00" — план на сегодня
  digest_evening: null as string | null,   // "20:00" — план на завтра
  digest_min: 1,            // присылать, только если событий не меньше N
};
export type Settings = typeof DEFAULT_SETTINGS;
export const withDefaults = (s: unknown): Settings => ({ ...DEFAULT_SETTINGS, ...((s as object) ?? {}) });

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const int = (v: unknown, a: number, b: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };

/** Применяет присланные поля к настройкам. Возвращает ошибку или новые настройки. */
export function applyPatch(cur: Settings, b: Record<string, unknown>, maxReminders: number): { s: Settings } | { error: string } {
  const s = { ...cur };
  if (typeof b.onboarded === "boolean") s.onboarded = b.onboarded;
  if (typeof b.lang === "string" && ["ru", "en", "uz", "de", "ja", "tr"].includes(b.lang)) s.lang = b.lang;
  if (b.radius !== undefined) s.radius = int(b.radius, 0, 50, 22);
  if (b.week_start === 0 || b.week_start === 1) s.week_start = b.week_start;
  if (typeof b.view === "string" && ["month", "week", "day"].includes(b.view)) s.view = b.view;
  if (b.tile_dim !== undefined) s.tile_dim = int(b.tile_dim, 0, 30, 7);
  if (typeof b.mark_style === "string" && ["scribble", "stroke", "dot"].includes(b.mark_style)) s.mark_style = b.mark_style;
  if (typeof b.sel_style === "string" && ["fill", "ring"].includes(b.sel_style)) s.sel_style = b.sel_style;
  if (typeof b.multi_style === "string" && ["bars", "frame", "ribbon", "ends", "dots", "none"].includes(b.multi_style)) s.multi_style = b.multi_style;
  if (typeof b.done_style === "string" && ["strike", "marker", "fade"].includes(b.done_style)) s.done_style = b.done_style;
  if (b.allday_hour !== undefined) s.allday_hour = int(b.allday_hour, 0, 23, 9);
  if (Array.isArray(b.remind)) {
    const r = [...new Set(b.remind.map((x) => int(x, 1, 43200, 0)).filter((x) => x > 0))].sort((a, c) => a - c);
    if (r.length > maxReminders) return { error: "plan" };
    s.remind = r;
  }
  for (const k of ["digest_morning", "digest_evening"] as const) {
    if (b[k] === null) s[k] = null;
    else if (typeof b[k] === "string" && HHMM.test(b[k] as string)) s[k] = b[k] as string;
  }
  if (b.digest_min !== undefined) s.digest_min = int(b.digest_min, 1, 20, 1);
  return { s };
}
/** Напоминания по умолчанию: для обычных событий — список из настроек, для «весь день» — в заданный час того же дня. */
export function remindDefaults(st: Settings, allDay: boolean): number[] {
  return allDay ? [-(st.allday_hour * 60)] : (st.remind.length ? st.remind : []);
}
