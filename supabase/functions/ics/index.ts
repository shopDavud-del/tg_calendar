// Подписка на календарь для Apple / Google / Outlook: webcal://…/ics?t=СЕКРЕТНЫЙ_ТОКЕН
import { db } from "../_shared/db.ts";
import { limits, planOf } from "../_shared/plans.ts";
import { buildIcs, type IcsEv } from "../_shared/ics.ts";

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

  return new Response(buildIcs((evs ?? []) as IcsEv[]), {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'inline; filename="calendar.ics"', "cache-control": "no-cache" },
  });
});
