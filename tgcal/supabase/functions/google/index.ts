// Возврат из Google после согласия пользователя (OAuth callback)
import { env } from "../_shared/env.ts";
import { checkState } from "../_shared/auth.ts";
import { exchangeCode, saveToken, syncAll } from "../_shared/google.ts";
import { send } from "../_shared/tg.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Возвращаем человека в Telegram (внешний браузер не должен оставаться на странице календаря)
  const back = (s: string, why = "") => new Response(null, { status: 302, headers: { location: `https://t.me/${env("BOT_USERNAME")}?start=${encodeURIComponent("g_" + s + (why ? "_" + why.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) : ""))}` } });
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  const gerr = url.searchParams.get("error");
  if (gerr || !code || !state) return back("denied", gerr ?? "no_code");
  const uid = await checkState(state, env("TOKEN_KEY"));
  if (!uid) return back("error", "state");
  const tok = await exchangeCode(code);
  if (!tok.refresh_token) { console.error("google exchange failed", JSON.stringify(tok).slice(0, 300)); return back("error", tok.error ?? "no_refresh_token"); }
  await saveToken(uid, tok.refresh_token);
  try {
    const r = await syncAll(uid);
    await send(uid, `✅ Google Календарь подключён. Загружено событий: ${r.pulled ?? 0}.`);
  } catch (e) { console.error(e); }
  return back("ok");
});
