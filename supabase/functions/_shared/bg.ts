/** Фоновая задача: Edge-функция доводит её до конца после ответа (EdgeRuntime.waitUntil). Без этого ответ ждал бы Google. */
export function background(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  const safe = p.catch((e) => console.error("background", e));
  if (er?.waitUntil) er.waitUntil(safe);
}
