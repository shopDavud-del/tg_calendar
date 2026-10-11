// Возврат из Google после согласия пользователя (OAuth callback)
import { env } from "../_shared/env.ts";
import { checkState } from "../_shared/auth.ts";
import { exchangeCode, saveToken, syncAll } from "../_shared/google.ts";
import { send } from "../_shared/tg.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const back = (s: string) => new Response(null, { status: 302, headers: { location: `${env("APP_URL")}/?google=${s}` } });
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return back("denied");
  const uid = await checkState(state, env("TOKEN_KEY"));
  if (!uid) return back("error");
  const tok = await exchangeCode(code);
  if (!tok.refresh_token) return back("error");
  await saveToken(uid, tok.refresh_token);
  try {
    const r = await syncAll(uid);
    await send(uid, `✅ Google Календарь подключён. Загружено событий: ${r.pulled ?? 0}.`);
  } catch (e) { console.error(e); }
  return back("ok");
});
