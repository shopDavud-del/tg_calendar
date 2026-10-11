// API для мини-приложения. Каждый запрос подписан Telegram (initData) — подделать нельзя.
import { db } from "../_shared/db.ts";
import { env } from "../_shared/env.ts";
import { verifyInitData, signState } from "../_shared/auth.ts";
import { ensureUser, deleteAccount } from "../_shared/account.ts";
import { ALL_THEMES, limits, PLANS, planOf } from "../_shared/plans.ts";
import { expand } from "../_shared/time.ts";
import { removeEvent, saveEvent } from "../_shared/events.ts";
import { invoiceLink } from "../_shared/payments.ts";
import { authUrl, syncAll } from "../_shared/google.ts";
import type { Ev } from "../_shared/reminders.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Any = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: Any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const tgUser = await verifyInitData(String(body.initData ?? ""), env("BOT_TOKEN"));
  if (!tgUser) return json({ error: "auth" }, 401);
  try {
    return json(await handle(body, tgUser.id));
  } catch (e) {
    console.error(e);
    return json({ error: "server" }, 500);
  }
});

async function groupsOf(uid: number) {
  const { data: m } = await db.from("group_members").select("chat_id").eq("user_id", uid);
  const ids = (m ?? []).map((x) => x.chat_id);
  if (!ids.length) return [];
  const { data: g } = await db.from("groups").select("chat_id,title,active").in("chat_id", ids).eq("active", true);
  return (g ?? []).map((x) => ({ id: x.chat_id as number, title: (x.title as string) ?? "Группа" }));
}

async function handle(b: Any, uid: number) {
  const user = await ensureUser(uid, typeof b.tz === "string" ? b.tz : undefined);
  const plan = planOf(user);
  const lim = limits(plan);
  const groups = await groupsOf(uid);
  const allowed = new Set<number>([uid, ...groups.map((g) => g.id)]);

  switch (b.action) {
    case "init": {
      const { data: tok } = await db.from("google_tokens").select("user_id").eq("user_id", uid).maybeSingle();
      return {
        user: { id: uid, plan, plan_until: user.plan_until, tz: user.tz, settings: user.settings, google: !!tok },
        limits: lim, plans: PLANS, groups, themes: ALL_THEMES,
        ics: lim.ics ? `${env("SUPABASE_URL")}/functions/v1/ics?t=${user.ics_token}` : null,
        bot: env("BOT_USERNAME"),
      };
    }
    case "events": {
      const from = new Date(b.from), to = new Date(b.to);
      if (isNaN(+from) || isNaN(+to) || to.getTime() - from.getTime() > 100 * 86400000) return { error: "range" };
      const { data } = await db.from("events").select("*").in("owner_id", [...allowed])
        .lte("starts_at", to.toISOString()).or(`repeat.not.is.null,ends_at.gte.${from.toISOString()},starts_at.gte.${from.toISOString()}`).limit(2000);
      const out = [];
      for (const ev of (data ?? []) as Ev[]) {
        for (const o of expand(ev, from, to)) out.push({ ...ev, occ_start: o.start.toISOString(), occ_end: o.end?.toISOString() ?? null });
      }
      return { events: out };
    }
    case "save": {
      const ownerId = Number(b.owner_id ?? uid);
      if (!allowed.has(ownerId)) return { error: "forbidden" };
      if (b.id) {   // редактировать можно только существующее событие этого календаря
        const { data: ex } = await db.from("events").select("id").eq("id", b.id).eq("owner_id", ownerId).maybeSingle();
        if (!ex) return { error: "not_found" };
      }
      const r = await saveEvent({
        id: b.id, owner_id: ownerId, title: String(b.title ?? ""), notes: b.notes ?? null, starts_at: String(b.starts_at),
        ends_at: b.ends_at ?? null, all_day: !!b.all_day, repeat: b.repeat ?? null,
        remind: Array.isArray(b.remind) ? b.remind.map(Number).filter((n: number) => Number.isFinite(n)) : null,
        created_by: uid, source: "app", tz: user.tz,
      });
      return r.ok ? { ok: true, notes: r.notes } : { error: r.reason, message: r.message };
    }
    case "delete": {
      const { data: ev } = await db.from("events").select("owner_id").eq("id", b.id).maybeSingle();
      if (!ev || !allowed.has(ev.owner_id)) return { error: "not_found" };
      await removeEvent(b.id, ev.owner_id);
      return { ok: true };
    }
    case "settings": {
      const s = { ...(user.settings as Record<string, unknown>) };
      if (typeof b.theme === "string") {
        if (!ALL_THEMES.includes(b.theme)) return { error: "theme" };
        if (!lim.themes.includes(b.theme)) return { error: "plan", message: "Эта тема доступна в Plus и Pro" };
        s.theme = b.theme;
      }
      if (b.radius !== undefined) s.radius = Math.max(0, Math.min(50, Math.round(Number(b.radius) || 0)));
      if (b.week_start === 0 || b.week_start === 1) s.week_start = b.week_start;
      if (["month", "week", "day"].includes(b.view)) s.view = b.view;
      await db.from("users").update({ settings: s }).eq("id", uid);
      return { ok: true, settings: s };
    }
    case "invoice": {
      if (!["plus", "pro"].includes(b.plan) || !["month", "year"].includes(b.period)) return { error: "bad" };
      const url = await invoiceLink(uid, b.plan, b.period);
      return url ? { url } : { error: "invoice" };
    }
    case "google_url": {
      if (!lim.google) return { error: "plan", message: "Синхронизация с Google входит в тариф Pro" };
      const state = await signState(uid, env("TOKEN_KEY"));
      return { url: authUrl(state) };
    }
    case "google_sync": return await syncAll(uid);
    case "google_disconnect": {
      await db.from("google_tokens").delete().eq("user_id", uid);
      return { ok: true };
    }
    case "ics_rotate": {   // новая секретная ссылка, старая перестаёт работать
      const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      await db.from("users").update({ ics_token: token }).eq("id", uid);
      return { ics: `${env("SUPABASE_URL")}/functions/v1/ics?t=${token}` };
    }
    case "delete_me": {
      if (b.confirm !== "DELETE") return { error: "confirm" };
      await deleteAccount(uid);
      return { ok: true };
    }
  }
  return { error: "unknown_action" };
}
