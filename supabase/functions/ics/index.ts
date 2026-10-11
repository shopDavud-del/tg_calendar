// Подписка на календарь для Apple / Google / Outlook: webcal://…/ics?t=СЕКРЕТНЫЙ_ТОКЕН
import { db } from "../_shared/db.ts";
import { limits, planOf } from "../_shared/plans.ts";
import { localParts } from "../_shared/time.ts";

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

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (token.length < 32) return new Response("Not found", { status: 404 });
  const { data: u } = await db.from("users").select("*").eq("ics_token", token).maybeSingle();
  if (!u) return new Response("Not found", { status: 404 });
  if (!limits(planOf(u)).ics) return new Response("Подписка доступна в тарифе Plus и выше", { status: 402 });

  const { data: m } = await db.from("group_members").select("chat_id").eq("user_id", u.id);
  const owners = [u.id, ...(m ?? []).map((x) => x.chat_id)];
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: evs } = await db.from("events").select("*").in("owner_id", owners).or(`repeat.not.is.null,starts_at.gte.${since}`).limit(3000);

  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TgCalendar//RU", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Календарь Telegram", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const e of evs ?? []) {
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
    for (const r of (e.remind as number[]).filter((x) => x > 0).slice(0, 3)) L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${r}M`, "END:VALARM");
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return new Response(L.map(fold).join("\r\n") + "\r\n", {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-cache" },
  });
});
