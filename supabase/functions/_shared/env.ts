export const env = (k: string, d?: string) => {
  const v = Deno.env.get(k) ?? d;
  if (v === undefined) throw new Error(`Не задан секрет ${k}`);
  return v;
};
