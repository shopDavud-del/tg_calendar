// Работа с часовыми поясами и повторами без внешних библиотек.
export function localParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}
export function tzOffsetMin(d: Date, tz: string) {
  const p = localParts(d, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}
/** Местное время (в поясе tz) -> момент времени UTC. День может «переливаться» (31+1). */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = tzOffsetMin(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = tzOffsetMin(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}
export function validTz(tz: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

/** k-е повторение события (k=0 — само событие). */
export function occurrence(start: Date, rule: string | null, tz: string, k: number): Date {
  if (!rule || k === 0) return start;
  const p = localParts(start, tz);
  let y = p.y, m = p.m, d = p.d;
  if (rule === "daily") d += k;
  else if (rule === "weekly") d += 7 * k;
  else {
    const tot = rule === "monthly" ? y * 12 + (m - 1) + k : (y + k) * 12 + (m - 1);
    y = Math.floor(tot / 12); m = (tot % 12) + 1;
    d = Math.min(p.d, new Date(Date.UTC(y, m, 0)).getUTCDate());
  }
  return zonedToUtc(y, m, d, p.h, p.mi, tz);
}

type Ev = { starts_at: string; ends_at: string | null; repeat: string | null; tz: string };

/** Первое начало события строго позже момента `after`. */
export function nextStart(ev: Ev, after: number): Date | null {
  const s = new Date(ev.starts_at);
  if (!ev.repeat) return s.getTime() > after ? s : null;
  let k = Math.max(0, estimateK(ev.repeat, s, new Date(after)) - 1);
  for (let i = 0; i < 800; i++, k++) {
    const o = occurrence(s, ev.repeat, ev.tz, k);
    if (o.getTime() > after) return o;
  }
  return null;
}
function estimateK(rule: string, s: Date, t: Date) {
  const days = (t.getTime() - s.getTime()) / 86400000;
  if (rule === "daily") return Math.floor(days);
  if (rule === "weekly") return Math.floor(days / 7);
  if (rule === "monthly") return Math.floor(days / 31);
  return Math.floor(days / 366);
}
/** Все вхождения события в окне [from, to]. */
export function expand(ev: Ev, from: Date, to: Date) {
  const s = new Date(ev.starts_at);
  const dur = ev.ends_at ? new Date(ev.ends_at).getTime() - s.getTime() : 0;
  const out: { start: Date; end: Date | null }[] = [];
  if (!ev.repeat) {
    if (s <= to && new Date(s.getTime() + dur) >= from) out.push({ start: s, end: ev.ends_at ? new Date(ev.ends_at) : null });
    return out;
  }
  let k = Math.max(0, estimateK(ev.repeat, s, from) - 1);
  for (let i = 0; i < 1500; i++, k++) {
    const o = occurrence(s, ev.repeat, ev.tz, k);
    if (o > to) break;
    if (o.getTime() + dur >= from.getTime()) out.push({ start: o, end: dur ? new Date(o.getTime() + dur) : null });
  }
  return out;
}

export function fmtWhen(d: Date, tz: string, allDay: boolean) {
  const date = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, weekday: "short", day: "numeric", month: "long" }).format(d);
  if (allDay) return `${date}, весь день`;
  const t = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d);
  return `${date}, ${t}`;
}
