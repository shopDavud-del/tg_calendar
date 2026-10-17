// Подписка на календарь для Apple / Google / Outlook: webcal://…/ics?t=СЕКРЕТНЫЙ_ТОКЕН
import { db } from "../_shared/db.ts";
import { limits } from "../_shared/plans.ts";
import { effectivePlan, isMember } from "../_shared/groups.ts";
import { buildIcs, type IcsEv } from "../_shared/ics.ts";

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (token.length < 32) return new Response("Not found", { status: 404 });
  const { data: u } = await db.from("users").select("*").eq("ics_token", token).maybeSingle();
  if (!u) return new Response("Not found", { status: 404 });
  if (!limits(await effectivePlan(u)).ics) return new Response("Подписка доступна в тарифе Plus и выше", { status: 402 });

  const { data: m } = await db.from("group_members").select("chat_id").eq("user_id", u.id);
  const live = await Promise.all((m ?? []).map((x) => isMember(x.chat_id, u.id)));   // только текущие участники групп
  const owners = [u.id, ...(m ?? []).filter((_, i) => live[i]).map((x) => x.chat_id)];
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: evs } = await db.from("events").select("*").in("owner_id", owners).or(`repeat.not.is.null,starts_at.gte.${since}`).limit(3000);

  return new Response(buildIcs((evs ?? []) as IcsEv[]), {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'inline; filename="calendar.ics"', "cache-control": "no-cache" },
  });
});
