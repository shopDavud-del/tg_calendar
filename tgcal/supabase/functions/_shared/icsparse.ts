// Простой разбор .ics-файла (то, что присылает Apple/Google при экспорте).
import { localParts, validTz, zonedToUtc } from "./time.ts";
export interface IcsEvent { title: string; starts_at: Date; ends_at: Date | null; all_day: boolean; repeat: string | null; notes: string | null; tz: string }

const unesc = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
export function parseIcs(text: string, userTz: string): IcsEvent[] {
  const lines = text.replace(/\r/g, "").replace(/\n[ \t]/g, "").split("\n");
  const out: IcsEvent[] = [];
  let cur: Record<string, { v: string; p: Record<string, string> }> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur?.DTSTART) { const e = build(cur, userTz); if (e) out.push(e); }
      cur = null; continue;
    }
    if (!cur) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    const p: Record<string, string> = {};
    for (const x of params) { const [k, v] = x.split("="); if (k) p[k.toUpperCase()] = v; }
    if (!cur[name.toUpperCase()]) cur[name.toUpperCase()] = { v: line.slice(i + 1), p };
  }
  return out;
}
function when(x: { v: string; p: Record<string, string> }, userTz: string) {
  const m = x.v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  const dateOnly = h === undefined;
  const tz = x.p.TZID && validTz(x.p.TZID) ? x.p.TZID : userTz;
  const date = z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)) : zonedToUtc(+y, +mo, +d, +(h ?? 0), +(mi ?? 0), dateOnly || !x.p.TZID ? userTz : tz);
  return { date, dateOnly, tz: dateOnly ? userTz : tz };
}
function build(c: Record<string, { v: string; p: Record<string, string> }>, userTz: string): IcsEvent | null {
  const s = when(c.DTSTART, userTz); if (!s) return null;
  let e = c.DTEND ? when(c.DTEND, userTz) : null;
  let end: Date | null = e?.date ?? null;
  if (s.dateOnly && end && end.getTime() - s.date.getTime() <= 86400000) end = null;
  if (end && end <= s.date) end = null;
  const fr = c.RRULE?.v.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/);
  return {
    title: unesc(c.SUMMARY?.v ?? "Без названия").slice(0, 200), starts_at: s.date, ends_at: end, all_day: s.dateOnly,
    repeat: fr ? fr[1].toLowerCase() : null, notes: c.DESCRIPTION ? unesc(c.DESCRIPTION.v).slice(0, 1000) : null, tz: s.tz,
  };
}
void localParts;
