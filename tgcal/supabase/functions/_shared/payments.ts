import { tg } from "./tg.ts";
import { PLANS, type Plan } from "./plans.ts";

export type Period = "month" | "year";
export const priceStars = (plan: Plan, period: Period, disc = 0) => Math.max(1, Math.round(PLANS[plan].stars[period] * (100 - disc) / 100));
export const paidPlans: Plan[] = ["plus", "pro"];

/** Ссылка на оплату в Stars. Месяц — настоящая подписка (автопродление раз в 30 дней), год — разовая оплата. */
export async function invoiceLink(uid: number, plan: Plan, period: Period, disc = 0): Promise<string | null> {
  if (plan === "free") return null;
  const stars = priceStars(plan, period, disc);
  const label = `${PLANS[plan].title} — ${period === "month" ? "30 дней" : "12 месяцев"}`;
  const body: Record<string, unknown> = {
    title: `Календарь ${PLANS[plan].title}`,
    description: period === "month" && !disc
      ? `Подписка ${PLANS[plan].title}: продлевается каждые 30 дней, отменить можно в любой момент в Telegram.`
      : `${PLANS[plan].title} на 12 месяцев (разовая оплата, без автопродления).`,
    payload: `${plan}:${period}:${uid}${disc ? ":d" + disc : ""}`,
    currency: "XTR",
    prices: [{ label, amount: stars }],
  };
  if (period === "month" && !disc) body.subscription_period = 2592000;   // со скидкой — разовая оплата без автопродления (цена подписки в Stars фиксируется навсегда)
  const j = await tg("createInvoiceLink", body);
  return j.ok ? (j.result as string) : null;
}

export function reminderText(r: number[]) {
  if (!r.length) return "без напоминания";
  return r.map((m) => {
    if (m < 0) return `в ${Math.round(-m / 60)}:00 в тот же день`;
    if (m % 10080 === 0) return `за ${m / 10080} нед.`;
    if (m % 1440 === 0) return `за ${m / 1440} дн.`;
    if (m % 60 === 0) return `за ${m / 60} ч`;
    return `за ${m} мин`;
  }).join(", ");
}
