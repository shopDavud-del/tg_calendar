// Сборка iCalendar (.ics) для подписки из Apple / Google / Outlook
import { localParts } from "./time.ts";
const RR: Record<string, string> = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" };
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const dateOnly = (d: Date, tz: string) => { const p = localParts(d, tz); return `${p.y}${String(p.m).padStart(2, "0")}${String(p.d).padStart(2, "0")}`; };
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line: string) {
  const enc = new TextEncoder(); if (enc.encode(line).length <= 74) return line;
  const out: string[] = []; let cur = "", n = 0;
  for (const ch of line) { const l = enc.encode(ch).length; if (n + l > 73) { out.push(cur); cur = ""; n = 0; } cur += ch; n += l; }
  out.push(cur); return out.join("\r\n ");
}
export interface IcsEv { id: string; title: string; notes?: string | null; starts_at: string; ends_at: string | null; all_day: boolean; tz: string; repeat: string | null; remind: number[]; updated_at: string }

export function buildIcs(evs: IcsEv[], name = "Календарь Telegram") {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TgCalendar//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const e of evs) {
    const s = new Date(e.starts_at), en = e.ends_at ? new Date(e.ends_at) : null;
    L.push("BEGIN:VEVENT", `UID:${e.id}@tgcal`, `DTSTAMP:${stamp(new Date(e.updated_at))}`, `SUMMARY:${esc(e.title)}`);
    if (e.notes) L.push(`DESCRIPTION:${esc(e.notes)}`);
    if (e.all_day) {
      L.push(`DTSTART;VALUE=DATE:${dateOnly(s, e.tz)}`);
      L.push(`DTEND;VALUE=DATE:${dateOnly(new Date((en ?? s).getTime() + (en ? 0 : 86400000)), e.tz)}`);
    } else {
      L.push(`DTSTART:${stamp(s)}`, `DTEND:${stamp(en ?? new Date(s.getTime() + 3600000))}`);
    }
    if (e.repeat) L.push(`RRULE:FREQ=${RR[e.repeat]}`);
    for (const r of (e.remind ?? []).filter((x) => x > 0).slice(0, 3)) L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${r}M`, "END:VALARM");
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
