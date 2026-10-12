// =====================================================================
//  ТАРИФЫ — меняйте цифры здесь, остальное подстроится само.
//  Цены в Telegram Stars (⭐). Подписка в Telegram — только на 30 дней,
//  «год» продаётся как разовая оплата со скидкой.
// =====================================================================
export type Plan = "free" | "plus" | "pro" | "team";
export const RANK: Record<Plan, number> = { free: 0, plus: 1, pro: 2, team: 3 };
const INF = 1_000_000;

export const FREE_THEMES = ["midnight", "indigo", "black"];
export const ALL_THEMES = ["midnight", "black", "indigo", "emerald", "bordeaux", "teal", "terracotta", "sage", "luxury",
  "cherry-champagne", "cherry-honey", "cherry-lavender", "cherry-ice", "cherry"];

export const PLANS = {
  free: {
    title: "Free", stars: { month: 0, year: 0 },
    maxEvents: 40, maxReminders: 1, repeat: false, ics: false, google: false, team: false, maxGroups: 1,
    themes: FREE_THEMES,
  },
  plus: {
    title: "Plus", stars: { month: 100, year: 1000 },
    maxEvents: INF, maxReminders: 3, repeat: true, ics: true, google: false, team: false, maxGroups: 3,
    themes: "all",
  },
  pro: {
    title: "Pro", stars: { month: 250, year: 2500 },
    maxEvents: INF, maxReminders: 5, repeat: true, ics: true, google: true, team: false, maxGroups: INF,
    themes: "all",
  },
  // Командный тариф для салонов: группа превращается в календарь с вкладкой на каждого сотрудника
  team: {
    title: "Team", stars: { month: 500, year: 5000 },
    maxEvents: INF, maxReminders: 5, repeat: true, ics: true, google: true, team: true, maxGroups: INF,
    themes: "all",
  },
} as const;

export const TRIAL_DAYS = 7;         // пробный Pro для новых пользователей (0 — отключить)
export const PERIOD_DAYS = { month: 30, year: 365 } as const;

export function planOf(u: { plan: string; plan_until: string | null } | null): Plan {
  if (!u) return "free";
  if (u.plan !== "free" && u.plan_until && new Date(u.plan_until).getTime() > Date.now()) return u.plan as Plan;
  return "free";
}
export function limits(p: Plan) {
  const l = PLANS[p];
  return { ...l, themes: l.themes === "all" ? ALL_THEMES : [...l.themes] };
}
