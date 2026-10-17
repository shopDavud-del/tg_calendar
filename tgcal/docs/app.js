"use strict";
/* ============================ УТИЛИТЫ ============================ */
const TG = window.Telegram && Telegram.WebApp;
const Q = new URLSearchParams(location.search);
const initData = (TG && TG.initData) || "";
const DEMO = !initData || Q.has("demo");            // без Telegram показываем демо-данные (так же работает themes.html)
const FRAMED = window.self !== window.top;
const CFG = window.CFG || {};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const K = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addD = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
let MONTHS = [], MONTHS_G = [], WD = [];
const THEMES = {
  midnight: ["Полночь", "#0f0f10", "#dfe5a0"], black: ["Чёрная", "#000000", "#c9c9d1"], indigo: ["Индиго", "#dde5f3", "#5a4fcf"],
  emerald: ["Изумруд", "#101a16", "#f2c53d"], bordeaux: ["Бордо", "#17171a", "#d1345b"], teal: ["Бирюза", "#0b1b21", "#4de3c2"],
  terracotta: ["Терракота", "#e8d3c6", "#d9593a"], sage: ["Шалфей", "#eef2e0", "#5f8226"], luxury: ["Люкс", "#e9ecf2", "#1f2a44"],
  "cherry-champagne": ["Вишня · шампань", "#141417", "#E6D3B3"], "cherry-honey": ["Вишня · медь", "#141417", "#D4925F"],
  "cherry-lavender": ["Вишня · лаванда", "#141417", "#B8B3FF"], "cherry-ice": ["Вишня · лёд", "#141417", "#A6DCF2"], cherry: ["Чистая вишня", "#141417", "#B3263C"],
};
const DEFAULTS = { lang: "", onboarded: false, theme: "midnight", radius: 22, week_start: 1, view: "month", tile_dim: 7, mark_style: "scribble", sel_style: "fill", multi_style: "bars", done_style: "strike",
  remind: [30], allday_hour: 9, digest_morning: null, digest_evening: null, digest_min: 1 };
const wdOrder = () => (S.user.settings.week_start === 0 ? [0,1,2,3,4,5,6] : [1,2,3,4,5,6,0]);

let toastT;
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 2800); }
function tap() { try { TG && TG.HapticFeedback && TG.HapticFeedback.selectionChanged(); } catch (e) {} }
async function copy(t, msg) {
  try { await navigator.clipboard.writeText(t); } catch (e) { const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); } catch (_) {} a.remove(); }
  toast(msg || "Скопировано");
}
function ask(msg) { return new Promise((res) => { if (TG && TG.showConfirm) TG.showConfirm(msg, res); else res(confirm(msg)); }); }
const fmtDate = (iso) => new Date(iso).toLocaleDateString(I18N.locale());
function setNames() {   // названия месяцев и дней недели на выбранном языке
  const loc = I18N.locale(), cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  MONTHS = Array.from({ length: 12 }, (_, i) => cap(new Intl.DateTimeFormat(loc, { month: "long" }).format(new Date(2026, i, 15))));
  MONTHS_G = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(loc, { day: "numeric", month: "long" }).formatToParts(new Date(2026, i, 15)).find((p) => p.type === "month").value);
  WD = Array.from({ length: 7 }, (_, d) => cap(new Intl.DateTimeFormat(loc, { weekday: "short" }).format(new Date(2026, 0, 4 + d)).replace(/\.$/, "")));
}
setNames();
function applyLang(l) { I18N.set(l); setNames(); }

/* ============================ СОСТОЯНИЕ ============================ */
const S = {
  user: { id: 0, plan: "free", settings: { ...DEFAULTS }, google: false, is_admin: false },
  limits: { maxReminders: 1, repeat: false, ics: false, google: false, team: false, themes: ["midnight", "black", "indigo"] },
  plans: null, groups: [], ctx: null, team: null, scope: { t: "me" }, themes: Object.keys(THEMES), ics: null, bot: "",
  events: [], by: {}, marks: {}, sel: sod(new Date()), view: "month", key: "", ready: false, busy: false,
  spage: null, sig: "", clients: null, cq: "", ref: null, tour: 0, acc: {}, cr: { n: 30, u: 1 }, svcMin: 60, services: null, sheetKey: null,
};

async function api(action, data = {}) {
  if (DEMO) return demoApi(action, data);
  const r = await fetch(CFG.API, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, initData, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...data }) });
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}

/* ---------- демо (открытие в браузере без Telegram и themes.html) ---------- */
const DEMO_EVS = (() => {
  const t = sod(new Date()), at = (d, h, m = 0) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + d, h, m).toISOString();
  const mk = (d, h, m, title, dur, extra = {}) => ({ id: "d" + Math.random().toString(16).slice(2), owner_id: 1, title, all_day: false, starts_at: at(d, h, m), occ_start: at(d, h, m), occ_end: dur ? at(d, h, m + dur) : null, ends_at: dur ? at(d, h, m + dur) : null, repeat: null, remind: [30], ...extra });
  return [mk(0, 9, 0, "Планёрка", 60, { repeat: "weekly" }), mk(0, 11, 0, "Стоматолог", 80), mk(0, 14, 0, "Созвон с Аней", 60), mk(0, 19, 0, "Йога", 90),
    mk(1, 10, 30, "Разработка", 90), mk(2, 18, 0, "Ужин с родителями", 120), mk(4, 0, 0, "День рождения мамы", 0, { all_day: true, repeat: "yearly", remind: [-540] }),
    mk(-2, 16, 0, "Встреча с клиентом", 60), mk(-5, 12, 0, "Йога", 60), mk(7, 12, 0, "Презентация", 60), mk(9, 15, 0, "Маникюр", 60),
    mk(3, 0, 0, "Отпуск", 0, { all_day: true, ends_at: at(7, 0), occ_end: at(7, 0) }), mk(5, 0, 0, "Ремонт", 0, { all_day: true, ends_at: at(11, 0), occ_end: at(11, 0) })];
})();
const DEMO_MARKS = (() => {   // как на примере: зелёные и красные отметки по прошедшим дням
  const t = new Date(), m = {}; const pat = { 1: "miss", 2: "miss", 3: "done", 4: "miss", 5: "miss", 6: "done", 7: "miss", 8: "done", 9: "miss", 10: "miss" };
  for (let d = 1; d < t.getDate(); d++) m[K(new Date(t.getFullYear(), t.getMonth(), d))] = pat[((d - 1) % 10) + 1] || "miss";
  return m;
})();
const DEMO_SVC = [{ id: "s1", name: "Маникюр", minutes: 90 }, { id: "s2", name: "Стрижка", minutes: 60 }];
const DEMO_PLANS = { free: { title: "Free", stars: { month: 0, year: 0 }, maxEvents: 40 }, plus: { title: "Plus", stars: { month: 100, year: 1000 } }, pro: { title: "Pro", stars: { month: 250, year: 2500 } }, team: { title: "Team", stars: { month: 500, year: 5000 } } };
async function demoApi(a, d) {
  if (a === "init") {
    const st = { ...DEFAULTS, ...(S.user.settings || {}) };
    for (const [q, k, f] of [["theme", "theme", String], ["view", "view", String], ["radius", "radius", Number], ["dim", "tile_dim", Number], ["mark", "mark_style", String], ["sel", "sel_style", String], ["multi", "multi_style", String]]) if (Q.has(q)) st[k] = f(Q.get(q));
    return { user: { id: 1, plan: "pro", plan_until: new Date(Date.now() + 6 * 864e5).toISOString(), tz: "UTC", settings: st, google: false, is_admin: Q.has("admin") },
      limits: { maxEvents: 1e6, maxReminders: 5, repeat: true, ics: true, google: true, team: true, maxGroups: 1e6, themes: Object.keys(THEMES) }, plans: DEMO_PLANS,
      groups: [], ctx: null, themes: Object.keys(THEMES), ics: "https://example.supabase.co/functions/v1/ics?t=demo", bot: "demo_bot" };
  }
  if (a === "events") return { marks: DEMO_MARKS, events: DEMO_EVS.filter((e) => new Date(e.occ_start) <= new Date(d.to) && new Date(e.occ_start) >= new Date(d.from)) };
  if (a === "marks") return { marks: DEMO_MARKS };
  if (a === "mark") { if (d.mark) DEMO_MARKS[d.day] = d.mark; else delete DEMO_MARKS[d.day]; return { ok: true }; }
  if (a === "save") { const s = d.starts_at; const row = { title: d.title, all_day: d.all_day, starts_at: s, occ_start: s, ends_at: d.ends_at, occ_end: d.ends_at, repeat: d.repeat, remind: d.remind, owner_id: 1 };
    if (d.id) Object.assign(DEMO_EVS.find((x) => x.id === d.id), row); else DEMO_EVS.push({ id: "d" + Math.random().toString(16).slice(2), ...row }); return { ok: true, notes: [] }; }
  if (a === "delete") { const i = DEMO_EVS.findIndex((x) => x.id === d.id); if (i >= 0) DEMO_EVS.splice(i, 1); return { ok: true }; }
  if (a === "settings") { Object.assign(S.user.settings, d); return { ok: true, settings: S.user.settings }; }
  if (a === "referral") return { link: "https://t.me/demo_bot?start=ref_1", invited: 2, disc_pct: 0 };
  if (a === "clients") return { clients: [{ id: "c1", name: "Анна", phone: "+998901234567", username: null, visits: 3 }, { id: "c2", name: "", phone: null, username: "maria_k", visits: 1 }] };
  if (a === "client_get") return { client: { id: d.id, name: "Анна", phone: "+998901234567", username: null, note: "любит чай" }, events: DEMO_EVS.slice(0, 3), draft: "Здравствуйте, Анна! Напоминаем о записи: Маникюр, завтра, 15:00. Ждём вас!" };
  if (a === "admin_google") return { configured: true, client_id_tail: "…demo", redirect: "https://REF.supabase.co/functions/v1/google", scope: "calendar.events", connected: 0 };
  if (a === "services") return { services: DEMO_SVC };
  if (a === "service_save") { DEMO_SVC.push({ id: "s" + Math.random().toString(16).slice(2), name: d.name, minutes: d.minutes }); return { ok: true }; }
  if (a === "service_delete") { const i = DEMO_SVC.findIndex((x) => x.id === d.id); if (i >= 0) DEMO_SVC.splice(i, 1); return { ok: true }; }
  if (a === "done" || a === "snooze") return { ok: true };
  if (a === "admin_stats") return { users: 12, paid: 3, groups: 2, events: 140, codes: 4, stars: 1500, last_tick: new Date().toISOString() };
  if (a === "admin_codes") return { codes: [{ code: "CAL-AB12-CD34", plan: "pro", days: 30, max_uses: 1, used_count: 0, note: "демо", revoked: false }] };
  return { error: "demo", message: "В демо-режиме это недоступно" };
}

/* ============================ ЗАГРУЗКА ============================ */
async function init(soft) {
  if (S.busy) return;
  S.busy = true;
  try {
    const [f0, t0] = range();
    const r = await api("init", { start_param: (TG && TG.initDataUnsafe && TG.initDataUnsafe.start_param) || Q.get("g") || "", from: f0.toISOString(), to: t0.toISOString() });
    if (r.error) throw new Error(r.error);
    Object.assign(S, { user: { ...r.user, settings: { ...DEFAULTS, ...r.user.settings } }, limits: r.limits, plans: r.plans, groups: r.groups || [], ctx: r.ctx, themes: r.themes, ics: r.ics, bot: r.bot });
    S.team = S.groups.find((g) => g.mode === "team" && g.isAdmin && (!S.ctx || g.id === S.ctx)) || null;
    if (!soft) { let v = null; try { v = localStorage.getItem("view"); } catch (e) {} S.view = ["month", "week", "day"].includes(v) ? v : (S.user.settings.view || "month"); S.scope = S.team && S.ctx === S.team.id ? { t: "all" } : { t: "me" }; }
    applyTheme();
    S.ready = true;
    applyLang(S.user.settings.lang || I18N.from(TG && TG.initDataUnsafe && TG.initDataUnsafe.user && TG.initDataUnsafe.user.language_code));
    if (!soft && !S.user.settings.onboarded && !DEMO) setTimeout(() => openTour(0), 500);
    if (r.events) { S.events = r.events; S.marks = r.marks || {}; S.key = keyOf(); index(); render(true); }
    else await load(true);
  } catch (e) {
    console.error(e);
    if (!S.ready) $("#main").innerHTML = `<div class="empty">Не удалось загрузить календарь.<br><br><button class="btn sm" data-act="retry">Повторить</button><div class="sub" style="margin-top:12px">Если повторяется, проверьте адрес API в config.js</div></div>`;
  } finally { S.busy = false; }
}
function range() {
  const m = new Date(S.sel.getFullYear(), S.sel.getMonth(), 1);
  return [addD(m, -8), addD(new Date(m.getFullYear(), m.getMonth() + 1, 1), 8)];
}
const keyOf = () => { const m = new Date(S.sel.getFullYear(), S.sel.getMonth(), 1); return `${m.getFullYear()}-${m.getMonth()}-${S.scope.t}`; };
async function load(force, quiet) {
  const key = keyOf();
  if (!force && key === S.key) return render(true);
  S.key = key;
  const [from, to] = range();
  try {
    const e = await api("events", { from: from.toISOString(), to: to.toISOString() });   // события и отметки одним запросом
    const sig = JSON.stringify([(e.events || []).map((x) => [x.id, x.occ_start, x.occ_end, x.title, x.done, x.all_day]), e.marks || {}]);
    if (quiet && sig === S.sig) return;   // ничего не изменилось — не перерисовываем (экран не мигает)
    S.sig = sig;
    S.events = e.events || []; S.marks = e.marks || {};
  } catch (err) { if (!quiet) toast("Нет связи с сервером"); S.events = S.events || []; }
  index(); render(true);
}
const vis = (e) => {
  if (!S.team) return true;
  const sc = S.scope;
  if (sc.t === "me") return e.owner_id === S.user.id || e.owner_id < 0;
  if (sc.t === "all") return true;
  return e.owner_id === sc.id && e.group_id === S.team.id;
};
function lastDay(e) { const s = new Date(e.occ_start), en = e.occ_end ? new Date(e.occ_end) : null; return !en || en <= s ? sod(s) : sod(new Date(en.getTime() - 1)); }
const isMulti = (e) => K(lastDay(e)) !== K(new Date(e.occ_start));
function index() {
  S.by = {};
  for (const e of S.events) {
    if (!vis(e)) continue;
    const last = lastDay(e);
    for (let d = sod(new Date(e.occ_start)); d <= last; d = addD(d, 1)) (S.by[K(d)] ||= []).push(e);
  }
  for (const k in S.by) S.by[k].sort((a, b) => (b.all_day - a.all_day) || (new Date(a.occ_start) - new Date(b.occ_start)));
}
function loadUiCache() {   // сохранённое оформление применяется сразу, до ответа сервера
  try { const u = JSON.parse(localStorage.getItem("ui") || "{}"); for (const k of ["theme", "radius", "tile_dim", "mark_style", "sel_style", "multi_style", "done_style", "week_start", "lang"]) if (u[k] != null) S.user.settings[k] = u[k]; if (u.lang) applyLang(u.lang); } catch (e) {}
}
function applyTheme() {
  const st = S.user.settings, r = document.documentElement;
  r.dataset.theme = THEMES[st.theme] ? st.theme : "midnight";
  r.style.setProperty("--rn", st.radius ?? 22);
  r.style.setProperty("--td", st.tile_dim ?? 7);
  r.dataset.done = st.done_style || "strike";
  try { localStorage.setItem("ui", JSON.stringify({ theme: st.theme, radius: st.radius, dim: st.tile_dim, done: st.done_style, mark_style: st.mark_style, sel_style: st.sel_style, multi_style: st.multi_style, week_start: st.week_start, tile_dim: st.tile_dim, lang: st.lang || I18N.lang })); } catch (e) {}
  try { const bg = getComputedStyle(r).getPropertyValue("--bg").trim(); TG && TG.setHeaderColor && TG.setHeaderColor(bg); TG && TG.setBackgroundColor && TG.setBackgroundColor(bg); } catch (e) {}
}

/* ============================ ОТРИСОВКА ============================ */
const PATH = {
  scr: "M14 70 L88 24 L18 56 L90 40 L22 80 L84 18",    // зигзаг-«зачёркивание»
  stk: "M16 70 L84 30",                                // толстый мазок
  ring: "M52 9 C80 8 94 30 91 54 C88 80 64 93 41 90 C17 87 7 64 11 40 C15 18 36 9 60 13",  // кольцо от руки
};
const svg = (cls, d) => `<svg class="mk ${cls}" viewBox="0 0 100 100" aria-hidden="true"><path d="${d}"/></svg>`;
function markHTML(k) {
  const m = S.marks[k]; if (!m) return "";
  const st = S.user.settings.mark_style;
  if (st === "dot") return `<span class="mkdot ${m}"></span>`;
  return svg(`${m} ${st === "stroke" ? "stk" : "scr"}`, st === "stroke" ? PATH.stk : PATH.scr);
}
const MCOL = ["#7DD3FC", "#F9A8D4", "#FCD34D", "#86EFAC", "#C4B5FD", "#FDBA74", "#5EEAD4", "#FCA5A5"];
function colorOf(uid) { const ms = (S.team && S.team.members) || [], i = ms.findIndex((m) => m.id === uid); return MCOL[(i >= 0 ? i : Math.abs(uid)) % MCOL.length]; }
const BARCOL = ["#4FA3F7", "#E86AA6", "#F2B400", "#3CB878", "#8E7CF0", "#F28C38"];
const hashId = (s) => [...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0);
const barCol = (e) => (e.group_id && e.owner_id > 0 ? colorOf(e.owner_id) : BARCOL[hashId(e.id) % BARCOL.length]);
/* Многодневные задачи рисуются отдельным слоем поверх плиток: сетка и промежутки между днями не меняются.
   Способ отметки выбирает пользователь (настройка multi_style). */
function segsFor(first, rows, evs) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    const rs = addD(first, 7 * r), re = addD(rs, 6), segs = [];
    for (const e of evs) {
      const s = sod(new Date(e.occ_start)), l = lastDay(e);
      if (l < rs || s > re) continue;
      const a = s > rs ? s : rs, b = l < re ? l : re;
      segs.push({ r, color: barCol(e), c0: Math.round((a - rs) / 864e5) + 1, c1: Math.round((b - rs) / 864e5) + 1, st: s >= rs, en: l <= re });
    }
    segs.sort((x, y) => x.c0 - y.c0 || (y.c1 - y.c0) - (x.c1 - x.c0));
    const lanes = [];
    for (const sg of segs) {
      let i = lanes.findIndex((end) => end < sg.c0);
      if (i < 0) { if (lanes.length >= 3) continue; i = lanes.length; lanes.push(0); }
      lanes[i] = sg.c1; sg.lane = i; out.push(sg);
    }
  }
  return out;
}
function drawSegs(segs, style) {
  const has = new Set(); let html = "";
  if (style === "none") return { html, has };
  for (const g of segs) {
    const row = `grid-row:${g.r + 1};`, off = 4 + g.lane * 6;
    if (style === "bars") {
      html += `<i class="bar" style="${row}grid-column:${g.c0}/${g.c1 + 1};margin-bottom:${off}px;margin-left:${g.st ? 5 : 0}px;margin-right:${g.en ? 5 : 0}px;background:${g.color};border-radius:${g.st ? 3 : 0}px ${g.en ? 3 : 0}px ${g.en ? 3 : 0}px ${g.st ? 3 : 0}px"></i>`;
      for (let c = g.c0; c <= g.c1; c++) has.add(`${g.r}:${c}`);
    } else if (style === "ribbon") {
      html += `<i class="bar rib" style="${row}grid-column:${g.c0}/${g.c1 + 1};background:${g.color};border-radius:${g.st ? 12 : 0}px ${g.en ? 12 : 0}px ${g.en ? 12 : 0}px ${g.st ? 12 : 0}px"></i>`;
    } else if (style === "frame") {
      for (let c = g.c0; c <= g.c1; c++) { html += `<i class="bar" style="${row}grid-column:${c}/${c + 1};margin:0 7px ${off}px;background:${g.color};border-radius:2px"></i>`; has.add(`${g.r}:${c}`); }
    } else if (style === "dots") {
      for (let c = g.c0; c <= g.c1; c++) { const first = c === g.c0 && g.st; html += `<i class="bar ${first ? "dtp" : "dsh"}" style="${row}grid-column:${c}/${c + 1};margin-bottom:${first ? off - 1 : off + 0.5}px;background:${g.color}"></i>`; has.add(`${g.r}:${c}`); }
    } else if (style === "ends") {
      const top = 3 + g.lane * 12;
      if (g.st) html += `<i class="bar mkx" style="${row}grid-column:${g.c0}/${g.c0 + 1};justify-self:start;margin:${top}px 0 0 6px;color:${g.color}">▸</i>`;
      if (g.en) html += `<i class="bar mkx" style="${row}grid-column:${g.c1}/${g.c1 + 1};justify-self:end;margin:${top}px 6px 0 0;color:${g.color}">◂</i>`;
    }
  }
  return { html, has };
}
function barsHTML(first, rows) {
  const multis = S.events.filter((e) => vis(e) && isMulti(e));
  return multis.length ? drawSegs(segsFor(first, rows, multis), S.user.settings.multi_style) : { html: "", has: new Set() };
}
const dotsHTML = (k) => {
  const list = (S.by[k] || []).filter((e) => !isMulti(e)); if (!list.length) return "";
  if (S.team && S.scope.t !== "me") { const ids = [...new Set(list.map((e) => e.owner_id))].slice(0, 3); return `<span class="dots">${ids.map((id) => `<i style="background:${colorOf(id)}"></i>`).join("")}</span>`; }
  return `<span class="dots">${"<i></i>".repeat(Math.min(list.length, 3))}</span>`;
};
const ringSel = () => S.user.settings.sel_style === "ring";

function tileHTML(c, curMonth, today, week, hasbar) {
  const k = K(c), sel = k === K(S.sel), isT = k === today, ring = ringSel();
  const cls = [week ? "wtile" : "tile", "num", hasbar ? "hasbar" : "", !week && c.getMonth() !== curMonth ? "out" : "", isT ? "today" : "", sel ? "sel" : "", ring ? "ring" : ""].join(" ");
  const rings = ring ? (sel ? svg("ringp ringsel", PATH.ring) : isT ? svg("ringp ringtod", PATH.ring) : "") : "";
  const inner = week ? `<small>${WD[c.getDay()]}</small><b>${c.getDate()}</b>` : `<span class="n">${c.getDate()}</span>`;
  return `<button class="${cls}" data-act="day" data-k="${k}">${markHTML(k)}${rings}${inner}${dotsHTML(k)}</button>`;
}
function weekStart(d) { const off = (d.getDay() - S.user.settings.week_start + 7) % 7; return addD(d, -off); }
function weekTitle(d) { const a = weekStart(d), b = addD(a, 6); return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MONTHS_G[a.getMonth()]}` : `${a.getDate()} ${MONTHS_G[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MONTHS_G[b.getMonth()].slice(0, 3)}`; }

function monthHTML() {
  const d = S.sel, first = new Date(d.getFullYear(), d.getMonth(), 1);
  const off = (first.getDay() - S.user.settings.week_start + 7) % 7;
  const start = addD(first, -off), today = K(new Date()), bars = barsHTML(start, 6);
  let h = `<div class="panel"><div class="grid7" style="margin-bottom:4px">${wdOrder().map((i) => `<div class="wd">${WD[i]}</div>`).join("")}</div><div class="gw"><div class="grid7">`;
  for (let i = 0; i < 42; i++) h += tileHTML(addD(start, i), d.getMonth(), today, false, bars.has.has(`${Math.floor(i / 7)}:${(i % 7) + 1}`));   // всегда 6 недель — высота не меняется
  return h + `</div>${bars.html ? `<div class="bars" style="grid-template-rows:repeat(6,1fr)">${bars.html}</div>` : ""}</div></div>` + agenda(d);
}
function weekHTML() {
  const a = weekStart(S.sel), today = K(new Date()), bars = barsHTML(a, 1);
  let h = `<div class="panel"><div class="gw"><div class="week">`;
  for (let i = 0; i < 7; i++) h += tileHTML(addD(a, i), 0, today, true, bars.has.has(`0:${i + 1}`));
  return h + `</div>${bars.html ? `<div class="bars" style="grid-template-rows:1fr">${bars.html}</div>` : ""}</div></div>`;
}
function evTime(e) {
  const s = new Date(e.occ_start), en = e.occ_end ? new Date(e.occ_end) : null;
  if (isMulti(e)) { const dm = (d) => `${d.getDate()} ${MONTHS_G[d.getMonth()].slice(0, 3)}`; return e.all_day ? `${dm(s)} – ${dm(lastDay(e))}` : `${dm(s)} ${hm(s)} – ${dm(en)} ${hm(en)}`; }
  if (e.all_day) return "Весь день";
  return en ? `${hm(s)} – ${hm(en)}` : hm(s);
}
const memberName = (id) => { const m = S.team && (S.team.members || []).find((x) => x.id === id); return m ? m.name : ""; };
const ICO_CLOCK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 3h6"/></svg>';
const ICO_CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
function evCard(e) {
  const g = S.groups.find((x) => x.id === e.owner_id || x.id === e.group_id);
  const who = e.group_id && S.team && e.owner_id !== S.user.id ? memberName(e.owner_id) : "";
  const team = e.group_id && e.owner_id > 0, done = !!e.done;
  const st = team || isMulti(e) ? `style="box-shadow:inset 6px 0 0 ${barCol(e)},0 6px 18px -10px rgba(0,0,0,.5)"` : "";
  return `<div class="ev ${e.all_day ? "allday" : ""} ${done ? "done" : ""}" ${st}><button class="evm" data-act="edit" data-id="${esc(e.id)}"><b translate="no">${esc(e.title)}</b><small class="num">${evTime(e)}${e.repeat ? " · ↻" : ""}</small>${g ? `<span class="tag" translate="no">👥 ${esc(g.title)}${who ? ` · ${esc(who)}` : ""}</span>` : ""}</button>
    <div class="evb"><button class="ib" data-act="snz" data-id="${esc(e.id)}" data-occ="${esc(e.occ_start)}" aria-label="Отложить напоминание">${ICO_CLOCK}</button><button class="ib ck ${done ? "on" : ""}" data-act="done" data-id="${esc(e.id)}" data-occ="${esc(e.occ_start)}" aria-label="Выполнено">${ICO_CHECK}</button></div></div>`;
}
function agenda(d) {
  const list = S.by[K(d)] || [];
  return `<div class="sect"><span>${d.getDate()} ${MONTHS_G[d.getMonth()]}</span><button data-act="markmenu" data-k="${K(d)}">${S.marks[K(d)] ? "Изменить отметку" : "Отметить день"}</button></div>
    <div class="agenda">${list.length ? list.map(evCard).join("") : `<div class="empty">В этот день пусто</div>`}<button class="addrow" data-act="add">+ Добавить событие</button></div>`;
}
function dayBlock(withHead) {
  const d = S.sel, k = K(d), list = S.by[k] || [], now = new Date(), isToday = k === K(now);
  const all = list.filter((e) => e.all_day), timed = list.filter((e) => !e.all_day);
  let h = withHead ? `<div class="sect"><span>${WD[d.getDay()]}, ${d.getDate()} ${MONTHS_G[d.getMonth()]}</span><button data-act="markmenu" data-k="${k}">${S.marks[k] ? "Изменить отметку" : "Отметить день"}</button></div>` : "";
  if (all.length) h += `<div class="agenda" style="margin-bottom:10px">${all.map(evCard).join("")}</div>`;
  h += `<div class="tl">`;
  const focusH = isToday ? Math.max(0, now.getHours() - 1) : Math.max(0, Math.min(7, timed.length ? new Date(timed[0].occ_start).getHours() - 1 : 7));
  for (let i = 0; i < 24; i++) {
    const here = timed.filter((e) => { const s = new Date(e.occ_start); return sod(s) < sod(d) ? i === 0 : s.getHours() === i; });
    h += `<div class="hr" ${i === focusH ? 'id="tl-focus"' : ""}><div class="hl num">${pad(i)}:00</div><div class="slot ${here.length ? "" : "empty"}" data-act="addAt" data-h="${i}">${here.map(evCard).join("")}`;
    if (isToday && now.getHours() === i) h += `<div class="now" style="top:${(now.getMinutes() / 60) * 100}%"></div>`;
    h += `</div></div>`;
  }
  return h + `</div>`;
}
function chipsHTML() {
  if (!S.team) return "";
  const sc = S.scope, ms = S.team.members || [];
  const c = (on, act, extra, t) => `<button class="chip ${on ? "on" : ""}" data-act="${act}" ${extra}>${esc(t)}</button>`;
  return c(sc.t === "me", "scope", 'data-t="me"', "Мои") + c(sc.t === "all", "scope", 'data-t="all"', "Все записи") +
    ms.filter((m) => m.id !== S.user.id).map((m) => c(sc.t === "u" && sc.id === m.id, "scope", `data-t="u" data-id="${m.id}"`, m.name).replace(">", `><span class="cd" style="background:${colorOf(m.id)}"></span>`)).join("");
}

function render(keep) {
  try {
    const v = S.view, d = S.sel, main = $("#main"), top = main.scrollTop;
    document.querySelectorAll("#seg button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    const grp = S.ctx ? S.groups.find((g) => g.id === S.ctx) : null;
    $("#ttl").textContent = v === "month" ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : v === "week" ? weekTitle(d) : `${WD[d.getDay()]}, ${d.getDate()} ${MONTHS_G[d.getMonth()]}`;
    const isToday = K(d) === K(new Date());
    $("#subl").outerHTML = (!isToday && v !== "week") || (!isToday && v === "week")
      ? `<button id="subl" class="subl" data-act="today">к сегодняшнему дню</button>`
      : `<span id="subl" class="subl">${grp ? "👥 " + esc(grp.title) : "выберите день"}</span>`;
    document.title = grp ? grp.title : "Календарь";
    const ch = $("#chips"); ch.innerHTML = chipsHTML(); ch.classList.toggle("on", !!S.team);
    main.innerHTML = v === "month" ? monthHTML() : v === "week" ? weekHTML() + dayBlock(true) : dayBlock(false);
    if (v === "month") main.scrollTop = keep ? top : 0;
    else { const f = $("#tl-focus"); main.scrollTop = keep && top ? top : (f ? Math.max(0, f.offsetTop - main.offsetTop - 8) : 0); }
  } catch (e) {
    console.error(e);
    $("#main").innerHTML = `<div class="empty">Не удалось отобразить календарь.<br><br><button class="btn sm" data-act="retry">Повторить</button></div>`;
  }
}

/* ============================ ЛИСТЫ ============================ */
function openSheet(html, key) {
  const box = $("#box"), isOpen = $("#sheet").classList.contains("open"), keep = isOpen && key && S.sheetKey === key, st = box.scrollTop;
  box.innerHTML = html; $("#sheet").classList.add("open"); S.sheetKey = key || null;
  box.scrollTop = keep ? st : 0;        // повторная отрисовка не прокручивает лист вверх
}
function closeSheet() { $("#sheet").classList.remove("open"); S.sheetKey = null; }

/* ---------- выбор времени (циферблат) и даты (барабаны) ---------- */
function modal(html) { const el = document.createElement("div"); el.className = "sheet open"; el.style.zIndex = 30; el.innerHTML = html; document.body.appendChild(el); return el; }
const fmtD = (s) => { const [y, m, d] = s.split("-").map(Number); return `${d} ${MONTHS_G[m - 1]} ${y}`; };

function pickTime(cur, o = {}) {
  return new Promise((resolve) => {
    let [h, m] = (cur || "09:00").split(":").map(Number); if (isNaN(h)) { h = 9; m = 0; }
    let mode = "h";
    const el = modal(`<div class="scrim" data-pk="cancel"></div><div class="box pk clk">
      <div class="clkhead"><button data-pk="mh" id="ch"></button><i>:</i><button data-pk="mm" id="cm"></button></div>
      ${o.title ? `<div class="pkt">${esc(o.title)}</div>` : ""}
      <div class="dial" id="dial"></div>
      <div class="pkbtns">${o.off ? `<button class="tbtn" data-pk="off">${esc(o.offLabel || "Очистить")}</button>` : ""}<span></span><button class="tbtn" data-pk="cancel">Отмена</button><button class="tbtn" data-pk="ok">Готово</button></div></div>`);
    const dial = el.querySelector("#dial");
    const pt = (deg, r) => { const a = deg * Math.PI / 180; return [50 + r * Math.sin(a), 50 - r * Math.cos(a)]; };
    function draw() {
      el.querySelector("#ch").textContent = pad(h); el.querySelector("#cm").textContent = o.hoursOnly ? "00" : pad(m);
      el.querySelector("#ch").classList.toggle("on", mode === "h"); el.querySelector("#cm").classList.toggle("on", mode === "m");
      let html = "", selDeg, selR;
      if (mode === "h") {
        for (let i = 0; i < 12; i++) { const [x, y] = pt(i * 30, 40), v = i === 0 ? 12 : i; html += `<button class="dn ${v === h ? "on" : ""}" style="left:${x}%;top:${y}%" data-pk="n" data-v="${v}">${v}</button>`; }
        for (let i = 0; i < 12; i++) { const [x, y] = pt(i * 30, 26), v = i === 0 ? 0 : 12 + i; html += `<button class="dn sm ${v === h ? "on" : ""}" style="left:${x}%;top:${y}%" data-pk="n" data-v="${v}">${pad(v)}</button>`; }
        const inner = h === 0 || h > 12; selDeg = (inner ? (h === 0 ? 0 : h - 12) : h % 12) * 30; selR = inner ? 26 : 40;
      } else {
        for (let i = 0; i < 12; i++) { const [x, y] = pt(i * 30, 40), v = i * 5; html += `<button class="dn ${v === m ? "on" : ""}" style="left:${x}%;top:${y}%" data-pk="n" data-v="${v}">${pad(v)}</button>`; }
        selDeg = m * 6; selR = 40;
      }
      const [sx, sy] = pt(selDeg, selR);
      dial.innerHTML = `<i class="hand" style="width:${selR}%;transform:rotate(${selDeg - 90}deg)"></i><b class="bub" style="left:${sx}%;top:${sy}%"></b>` + html;
    }
    const fromPointer = (e) => {   // перетаскивание по циферблату
      const r = dial.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      let ang = Math.atan2(dx, -dy) * 180 / Math.PI; if (ang < 0) ang += 360;
      if (mode === "h") { const idx = Math.round(ang / 30) % 12; h = Math.hypot(dx, dy) / (r.width / 2) < 0.66 ? (idx === 0 ? 0 : 12 + idx) : (idx === 0 ? 12 : idx); } else m = Math.round(ang / 6) % 60;
      draw();
    };
    let drag = false;
    dial.addEventListener("pointerdown", (e) => { drag = true; try { dial.setPointerCapture(e.pointerId); } catch (_) {} fromPointer(e); });
    dial.addEventListener("pointermove", (e) => { if (drag) fromPointer(e); });
    const up = () => { if (!drag) return; drag = false; tap(); if (mode === "h" && !o.hoursOnly) { mode = "m"; draw(); } };
    dial.addEventListener("pointerup", up); dial.addEventListener("pointercancel", up);
    const done = (v) => { el.remove(); resolve(v); };
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pk]"); if (!b) return; e.stopPropagation();
      const a = b.dataset.pk;
      if (a === "n") { const v = Number(b.dataset.v); if (mode === "h") { h = v; if (!o.hoursOnly) mode = "m"; } else m = v; tap(); draw(); }
      else if (a === "mh") { mode = "h"; draw(); } else if (a === "mm" && !o.hoursOnly) { mode = "m"; draw(); }
      else if (a === "ok") done(`${pad(h)}:${pad(o.hoursOnly ? 0 : m)}`);
      else if (a === "off") done(null); else if (a === "cancel") done(undefined);
    });
    draw();
  });
}

function pickDate(cur, o = {}) {
  return new Promise((resolve) => {
    let [y, mo, d] = (cur || K(new Date())).split("-").map(Number);
    const minA = o.min ? o.min.split("-").map(Number) : null, cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const MS = Array.from({ length: 12 }, (_, i) => cap(new Intl.DateTimeFormat(I18N.locale(), { month: "short" }).format(new Date(2026, i, 15)).replace(/\.$/, "")));
    const yStart = minA ? minA[0] : Math.min(y, new Date().getFullYear()) - 1, yEnd = Math.max(y, yStart + 9);
    const years = Array.from({ length: yEnd - yStart + 1 }, (_, i) => yStart + i);
    const dim = () => new Date(y, mo, 0).getDate();
    const items = (id, list, idx, cls) => `<div class="wheel ${cls}" id="${id}">${list.map((t, i) => `<div data-i="${i}" class="${i === idx ? "on" : ""}">${t}</div>`).join("")}</div>`;
    const el = modal(`<div class="scrim" data-pk="cancel"></div><div class="box pk">
      <div class="pkt" style="font-size:17px;color:var(--tx);font-weight:650;text-align:left;margin-bottom:0">${esc(o.title || "Дата")}</div>
      <div class="wheels"><div class="wband"></div><div id="wrap"></div></div>
      <div class="pkbtns"><button class="tbtn" data-pk="today">Сегодня</button><span></span><button class="tbtn" data-pk="cancel">Отмена</button><button class="tbtn" data-pk="ok">Готово</button></div></div>`);
    const wrap = el.querySelector("#wrap"); wrap.style.cssText = "display:flex;gap:6px;justify-content:center";
    const setTop = (w, i) => { w.scrollTop = i * 44; };
    function build(keepDays) {
      d = Math.min(d, dim());
      wrap.innerHTML = items("wd", Array.from({ length: dim() }, (_, i) => i + 1), d - 1, "w1") + items("wm", MS, mo - 1, "w2") + items("wy", years, years.indexOf(y), "w3");
      for (const [id, i] of [["wd", d - 1], ["wm", mo - 1], ["wy", years.indexOf(y)]]) setTop(wrap.querySelector("#" + id), i);
    }
    const mark = (w, i) => [...w.children].forEach((c, k) => c.classList.toggle("on", k === i));
    function pick(id, i, fromScroll) {
      if (id === "wd") d = i + 1; else if (id === "wm") mo = i + 1; else y = years[i];
      if (id !== "wd") { const old = dim(); if (d > old) d = old; build(); return; }
      mark(wrap.querySelector("#wd"), d - 1);
    }
    wrap.addEventListener("scroll", (e) => {
      const w = e.target; if (!w.classList || !w.classList.contains("wheel")) return;
      const i = Math.max(0, Math.min(w.children.length - 1, Math.round(w.scrollTop / 44)));
      if (w.id === "wd" ? i + 1 !== d : w.id === "wm" ? i + 1 !== mo : years[i] !== y) { tap(); pick(w.id, i, true); }
    }, true);
    const done = (v) => { el.remove(); resolve(v); };
    el.addEventListener("click", (e) => {
      const it = e.target.closest(".wheel > div");
      if (it) { const w = it.parentNode, i = Number(it.dataset.i); w.scrollTo ? w.scrollTo({ top: i * 44, behavior: "smooth" }) : setTop(w, i); pick(w.id, i); return; }
      const b = e.target.closest("[data-pk]"); if (!b) return; e.stopPropagation();
      const a = b.dataset.pk;
      if (a === "today") { const t = new Date(); y = t.getFullYear(); mo = t.getMonth() + 1; d = t.getDate(); build(); }
      else if (a === "ok") {
        if (minA && (y < minA[0] || (y === minA[0] && (mo < minA[1] || (mo === minA[1] && d < minA[2]))))) { y = minA[0]; mo = minA[1]; d = minA[2]; }
        done(`${y}-${pad(mo)}-${pad(d)}`);
      } else if (a === "cancel") done(undefined);
    });
    build();
  });
}
const acc = (k, title, body, sum) => `<div class="acc ${S.acc[k] ? "open" : ""}" data-k="${k}"><button class="acch" data-act="acc" data-k="${k}"><span class="acct"><b>${title}</b>${sum ? `<small>${sum}</small>` : ""}</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button><div class="accb">${body}</div></div>`;
const stepper = (id, v, step, min, max) => `<div class="stp"><button data-act="stp" data-id="${id}" data-d="${-step}" data-min="${min}" data-max="${max}" aria-label="Меньше">−</button><b id="${id}" class="num">${v}</b><button data-act="stp" data-id="${id}" data-d="${step}" data-min="${min}" data-max="${max}" aria-label="Больше">+</button></div>`;
const sel = (id, opts, val) => `<div class="sel"><select id="${id}" class="in">${opts.map(([v, t]) => `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;

const REM_TIMED = [[5], [15], [30], [60], [1440]];
const REM_ALL = [[-540], [360, "накануне в 18:00"]];
const remLabel = (m) => m < 0 ? (I18N.lang === "ru" ? `в ${Math.round(-m / 60)}:00` : `${Math.round(-m / 60)}:00`) : m % 10080 === 0 ? `${m / 10080} ${I18N.unit("нед.")}` : m % 1440 === 0 ? `${m / 1440} ${I18N.unit("дн.")}` : m % 60 === 0 ? `${m / 60} ${I18N.unit("ч")}` : `${m} ${I18N.unit("мин")}`;
let F = null;

/* ---------- форма события ---------- */
function targets() {   // куда можно записать событие
  const t = [{ v: "me", t: "Мой календарь" }];
  for (const g of S.groups) {
    if (g.mode !== "team") t.push({ v: `g:${g.id}`, t: "👥 " + g.title });
    else if (g.isAdmin) for (const m of g.members || []) t.push({ v: `t:${g.id}:${m.id}`, t: `👤 ${m.name} · ${g.title}` });
    else t.push({ v: `t:${g.id}:${S.user.id}`, t: `👥 ${g.title} (на меня)` });
  }
  return t;
}
function openForm(ev, hour) {
  const d = S.sel;
  if (ev) F = { id: ev.id, owner_id: ev.owner_id, group_id: ev.group_id, title: ev.title, notes: ev.notes || "", all_day: ev.all_day, s: new Date(ev.starts_at), e: ev.ends_at ? new Date(ev.ends_at) : null, repeat: ev.repeat || "", remind: [...(ev.remind || [])] };
  else {
    const now = new Date(), h = hour ?? (K(d) === K(now) ? Math.min(23, now.getHours() + 1) : 10), st = S.user.settings;
    F = { id: null, owner_id: S.user.id, title: "", notes: "", all_day: false, s: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0), e: null, repeat: "", remind: [...(st.remind || [])].slice(0, S.limits.maxReminders) };
  }
  F.t0 = hm(F.s); F.t1 = F.e ? hm(F.e) : "";
  F.d1 = K(F.s);
  F.d2 = F.e ? (F.all_day ? K(sod(new Date(F.e.getTime() - 1))) : K(F.e)) : K(F.s);
  const L = S.limits, tg = targets();
  const pre = !ev && S.scope.t === "u" && S.team ? `t:${S.team.id}:${S.scope.id}` : !ev && S.ctx && tg.some((x) => x.v === `g:${S.ctx}`) ? `g:${S.ctx}` : "me";
  openSheet(`
    <h2>${ev ? "Событие" : "Новое событие"}</h2>
    <div class="field"><label for="f-title">Название</label><input id="f-title" class="in" maxlength="200" placeholder="Например, маникюр" value="${esc(F.title)}"></div>
    ${tg.length > 1 && !ev ? `<div class="field"><label for="f-owner">Кому / куда</label>${sel("f-owner", tg.map((o) => [o.v, o.t]), pre)}</div>` : ""}
    <div class="sw" data-act="fAll"><span>Весь день</span><span class="tg ${F.all_day ? "on" : ""}" id="f-all"></span></div>
    <div class="field"><span class="lbl">Дата</span><button class="timebtn" id="f-date" data-act="pickD1">${fmtD(F.d1)}</button></div>
    <div class="field"><span class="lbl">Дата окончания <span class="sub">(если задача на несколько дней)</span></span><button class="timebtn" id="f-date2" data-act="pickD2">${fmtD(F.d2)}</button></div>
    <div class="row2" id="f-times" style="${F.all_day ? "display:none" : ""}">
      <div class="field"><span class="lbl">Начало</span><button class="timebtn num" id="f-start" data-act="pickStart">${F.t0}</button></div>
      <div class="field"><span class="lbl">Конец</span><button class="timebtn num" id="f-end" data-act="pickEnd">${F.t1 || "не указан"}</button></div>
    </div>
    <div class="field"><span class="lbl">Повтор</span><div class="chips" id="f-rep">
      ${[["", "Нет"], ["daily", "Каждый день"], ["weekly", "Неделю"], ["monthly", "Месяц"], ["yearly", "Год"]].map(([v, t]) => {
        const lock = v && !L.repeat; return `<button class="chip ${F.repeat === v ? "on" : ""} ${lock ? "lock" : ""}" data-act="fRep" data-v="${v}">${lock ? "🔒 " : ""}${t}</button>`; }).join("")}
    </div></div>
    <div class="field"><span class="lbl">Напомнить <span class="sub">(до ${L.maxReminders}; по умолчанию — в настройках)</span></span><div class="chips" id="f-rem"></div></div>
    <div class="field"><label for="f-notes">Заметка</label><textarea id="f-notes" class="in" rows="2" maxlength="1000">${esc(F.notes)}</textarea></div>
    <div class="btns"><button class="btn" data-act="fSave">Сохранить</button>${ev ? `<button class="btn danger" data-act="fDel">Удалить</button>` : ""}</div>
    <p class="sub" style="text-align:center;margin:12px 0 0">Если у мастера в «Услугах» есть такая процедура, конец записи подставится сам.${ev && ev.repeat ? " Изменения применятся ко всей серии." : ""}</p>`, "form");
  drawRem();
  if (!ev) setTimeout(() => { const t = $("#f-title"); t && t.focus({ preventScroll: true }); }, 300);
}
function drawRem() {
  const opts = (F.all_day ? REM_ALL : REM_TIMED).map(([m, t]) => [m, t || remLabel(m)]);
  const extra = F.remind.filter((m) => !opts.some((o) => o[0] === m)).map((m) => [m, remLabel(m)]);
  $("#f-rem").innerHTML = [...opts, ...extra].map(([m, t]) => `<button class="chip ${F.remind.includes(m) ? "on" : ""}" data-act="fRem" data-m="${m}">${t}</button>`).join("");
}
function formSave(force) {
  const title = $("#f-title").value.trim();
  if (!title) { toast("Введите название"); $("#f-title").focus(); return; }
  const [Y, M, D] = F.d1.split("-").map(Number);
  if (!Y) { toast("Укажите дату"); return; }
  const [Y2, M2, D2] = (F.d2 || F.d1).split("-").map(Number);
  const startDay = new Date(Y, M - 1, D), endDay = new Date(Y2, M2 - 1, D2), multi = endDay > startDay;
  let starts, ends = null;
  if (F.all_day) { starts = startDay; if (multi) ends = addD(endDay, 1); }   // для «весь день» конец хранится как начало следующего дня
  else {
    const [sh, sm] = F.t0.split(":").map(Number);
    starts = new Date(Y, M - 1, D, sh, sm);
    if (multi) { const [eh, em] = (F.t1 || "23:59").split(":").map(Number); ends = new Date(Y2, M2 - 1, D2, eh, em); }
    else if (F.t1) { const [eh, em] = F.t1.split(":").map(Number); const e = new Date(Y, M - 1, D, eh, em); if (e > starts) ends = e; }
  }
  const body = { id: F.id, owner_id: F.owner_id, title, notes: $("#f-notes").value.trim() || null, all_day: F.all_day, starts_at: starts.toISOString(), ends_at: ends && ends.toISOString(), repeat: F.repeat || null, remind: F.remind, force: !!force };
  const t = $("#f-owner") ? $("#f-owner").value : "me";
  if (!F.id) {
    if (t.startsWith("g:")) body.owner_id = Number(t.slice(2));
    else if (t.startsWith("t:")) { const [, g, u] = t.split(":"); body.group_id = Number(g); body.assignee_id = Number(u); }
  }
  const btn = document.querySelector('[data-act="fSave"]'); btn.disabled = true;
  api("save", body).then(async (r) => {
    btn.disabled = false;
    if (r.error === "conflict") {
      const tm = (iso) => hm(new Date(iso));
      const list = (r.conflicts || []).slice(0, 3).map((c) => `${c.title} (${tm(c.start)}–${tm(c.end)})`).join("; ");
      if (await ask(`Это время уже занято: ${list}. Записать всё равно?`)) formSave(true);
      return;
    }
    if (r.error) { toast(r.message || "Не удалось сохранить"); if (r.error === "limit" || r.error === "team") setTimeout(openTariffs, 900); return; }
    closeSheet(); S.sel = sod(starts); (r.notes || []).forEach((n) => toast(n)); tap();
    if (!F.id && !body.repeat && !body.group_id) {   // новое обычное событие показываем сразу, не дожидаясь второго запроса
      S.events.push({ id: r.id || "tmp" + Date.now(), owner_id: body.owner_id, group_id: null, title, notes: body.notes, all_day: F.all_day, starts_at: body.starts_at, ends_at: body.ends_at, occ_start: body.starts_at, occ_end: body.ends_at, repeat: null, remind: body.remind, done: false });
      index(); render(true); load(true, true);
    } else await load(true);
  }).catch(() => { btn.disabled = false; toast("Нет связи с сервером"); });
}

/* ---------- отложить напоминание ---------- */
function openSnooze(id, occ) {
  openSheet(`<h2>Отложить напоминание</h2><div class="btns" style="margin-top:0">${[[10, "Через 10 минут"], [30, "Через 30 минут"], [60, "Через час"], [180, "Через 3 часа"]].map(([m, t]) => `<button class="btn alt" data-act="snzdo" data-id="${esc(id)}" data-occ="${esc(occ)}" data-m="${m}">⏰ ${t}</button>`).join("")}</div>`, "snooze");
}
/* ---------- отметки дней ---------- */
function openMarkMenu(k) {
  const [y, m, d] = k.split("-").map(Number), cur = S.marks[k];
  openSheet(`<h2>${d} ${MONTHS_G[m - 1]}</h2><div class="btns" style="margin-top:0">
    <button class="btn ${cur === "done" ? "" : "alt"}" data-act="setmark" data-k="${k}" data-m="done">✓ Выполнено</button>
    <button class="btn ${cur === "miss" ? "" : "alt"}" data-act="setmark" data-k="${k}" data-m="miss">✕ Пропуск</button>
    <button class="btn ${cur === "star" ? "" : "alt"}" data-act="setmark" data-k="${k}" data-m="star">★ Особый день</button>
    ${cur ? `<button class="btn danger" data-act="setmark" data-k="${k}" data-m="">Снять отметку</button>` : ""}</div>
    <p class="sub" style="text-align:center;margin-top:14px">Совет: отметить день можно и долгим нажатием на него в месячном календаре. Стиль отметок меняется в настройках.</p>`);
}

/* ---------- справка ---------- */
const WORDS = "добавь, добавить, запомни, запомнить, назначь, назначить, запиши, записать, создай, создать, поставь, поставить, внеси, занеси, отметь, запланируй, запланировать, закинь, напомни, напомнить, зафиксируй, сохрани, забронируй, оформи, вставь, пометь, не забудь, организуй, планируй, закрепи";
function openHelp() {
  const ex = (t, s) => `<button class="ex" data-act="copy" data-t="${esc(t)}">${esc(t)}<small>${esc(s)}</small></button>`;
  openSheet(`<h2>Как добавлять события</h2>
    <p class="sub" style="margin-top:-6px">Напишите боту (или в группе с ботом) по шаблону. Нажмите на пример, чтобы скопировать.</p>
    <h3>Шаблон</h3>
    <pre class="codes">слово  что  когда  [во сколько]  [напомнить за …]  [повтор]</pre>
    <p class="sub">Слово-команда всегда в начале. Нет времени — событие на весь день. «Без напоминания» отключает уведомление.</p>
    <h3>Примеры (нажмите, чтобы скопировать)</h3>
    ${ex("добавь стоматолог 25 октября в 15:00", "дата и время")}
    ${ex("назначь встречу с Аней завтра в 11:30 напомнить за 30 минут", "своё напоминание")}
    ${ex("запомни день рождения мамы 3 марта каждый год", "на весь день, повтор")}
    ${ex("поставь планёрку каждый понедельник в 10:00", "повтор по дням недели")}
    ${ex("напомни позвонить маме через 2 часа", "через сколько")}
    ${ex("запиши йога в пятницу в 19:00 до 20:30", "с концом")}
    <h3>Салон / команда (тариф Team, в группе)</h3>
    ${ex("запиши Анна маникюр завтра в 15:00 @мастер", "запись на сотрудника по нику (только админ)")}
    ${ex("добавь окрашивание Мария в пятницу в 12:00", "без ника — запись получит тот, кто написал")}
    <p class="sub">Сотрудник должен хотя бы раз написать в группе /join, иначе бот не знает его ник. Личные уведомления приходят, если человек запускал бота (/start).</p>
    <h3>30 слов-команд</h3><p class="sub" style="line-height:1.6">${WORDS}.</p>
    <h3>Команды бота</h3>
    <p class="sub" style="line-height:1.7">/app календарь · /list ближайшее · /today сегодня · /plan тарифы · /code КОД — активировать подписку · /tz Asia/Tashkent — часовой пояс · /export выгрузка данных · /delete удалить всё<br>В группе: /list · /app · /ask on|off · /mode team|shared · /team · /join · /notify on|off</p>`);
}

/* ---------- настройки ---------- */
const PRESET_REM = [5, 10, 15, 30, 60, 120, 1440, 2880];
function openSettings() {
  const st = S.user.settings, L = S.limits, p = S.user.plan, until = S.user.plan_until ? fmtDate(S.user.plan_until) : "";
  const chip = (on, act, attrs, t) => `<button class="chip ${on ? "on" : ""}" data-act="${act}" ${attrs}>${t}</button>`;
  const remAll = [...new Set([...PRESET_REM, ...st.remind])].sort((a, b) => a - b);
  const timeRow = (k, title, sub, id) => `<div class="kv"><div>${title}<small>${sub}</small></div><button class="timebtn num sm" data-act="pickDigest" data-k="${k}" id="${id}">${st[k] || "Выкл"}</button></div>`;
  const themeBody = `<div class="themes">${S.themes.map((t) => { const ok = L.themes.includes(t), c = THEMES[t]; return `<div><button class="th ${st.theme === t ? "on" : ""}" style="background:${c[1]}" data-act="theme" data-t="${t}" aria-label="${esc(c[0])}"><b style="background:${c[2]}"></b><i style="background:${c[2]}"></i>${ok ? "" : `<span class="lk">🔒</span>`}</button><div class="th-name">${esc(c[0])}</div></div>`; }).join("")}</div>`;
  const shapeBody = `
    <div class="lbl">Скругление углов</div>
    <input type="range" id="rad" min="0" max="50" step="1" value="${st.radius}" aria-label="Скругление углов">
    <div class="lbl" style="margin-top:8px">Яркость плиток дней</div>
    <input type="range" id="dim" min="0" max="30" step="1" value="${st.tile_dim}" aria-label="Яркость плиток">
    <div class="prev"><div class="tile num">12</div><div class="tile num sel">13</div><div class="tile num today">14</div><div class="tile num">15</div></div>
    <div class="lbl" style="margin-top:16px">Выбранный день</div>
    <div class="chips">${[["fill", "Заливка"], ["ring", "Кольцо"]].map(([v, t]) => chip(st.sel_style === v, "sstyle", `data-v="${v}"`, t)).join("")}</div>
    <div class="lbl" style="margin-top:16px">Неделя начинается с</div>
    <div class="chips">${chip(st.week_start === 1, "ws", 'data-v="1"', "Понедельника")}${chip(st.week_start === 0, "ws", 'data-v="0"', "Воскресенья")}</div>`;
  const MULTI = [["bars", "Линия"], ["frame", "Рамка"], ["ribbon", "Лента"], ["ends", "Метки ▸ ◂"], ["dots", "Точка и тире"], ["none", "Без отметок"]];
  const demoSegs = [{ r: 0, c0: 2, c1: 4, st: true, en: true, lane: 0, color: BARCOL[0] }, { r: 0, c0: 3, c1: 6, st: true, en: true, lane: 1, color: BARCOL[1] }];
  const mp = drawSegs(demoSegs, st.multi_style);
  const multiPrev = `<div class="gw" style="margin-top:10px"><div class="grid7">${[12, 13, 14, 15, 16, 17, 18].map((n, i) => `<div class="tile num ${mp.has.has(`0:${i + 1}`) ? "hasbar" : ""}"><span class="n">${n}</span></div>`).join("")}</div>${mp.html ? `<div class="bars" style="grid-template-rows:1fr">${mp.html}</div>` : ""}</div>`;
  const marksBody = `
    <div class="lbl">Многодневные задачи</div>
    <div class="chips">${MULTI.map(([v, t]) => chip(st.multi_style === v, "mlt", `data-v="${v}"`, t)).join("")}</div>
    ${multiPrev}
    <div class="lbl" style="margin-top:16px">Отметки дней</div>
    <div class="chips">${[["scribble", "Зигзаг"], ["stroke", "Мазок"], ["dot", "Точка"]].map(([v, t]) => chip(st.mark_style === v, "mstyle", `data-v="${v}"`, t)).join("")}</div>
    <div class="lbl" style="margin-top:16px">Выполненные задачи</div>
    <div class="chips">${[["strike", "Зачёркнуть"], ["marker", "Маркер"], ["fade", "Бледнее"]].map(([v, t]) => chip(st.done_style === v, "dstyle", `data-v="${v}"`, t)).join("")}</div>`;
  const NM = { bars: "линия", frame: "рамка", ribbon: "лента", ends: "метки", dots: "точка и тире", none: "без отметок", scribble: "зигзаг", stroke: "мазок", dot: "точка", strike: "зачёркнуто", marker: "маркер", fade: "бледнее", fill: "заливка", ring: "кольцо" };
  const sums = {
    theme: THEMES[st.theme] ? THEMES[st.theme][0] : "", shape: `углы ${st.radius} · плитки ${st.tile_dim} · ${NM[st.sel_style]}`, marks: `${NM[st.mark_style]} · ${NM[st.done_style]} · задачи на дни: ${NM[st.multi_style]}`,
    rem: st.remind.length ? st.remind.map((m) => I18N.before(remLabel(m))).join(", ") : "выкл", dig: `утро ${st.digest_morning || "выкл"} · вечер ${st.digest_evening || "выкл"}`,
    svc: S.services ? (S.services.length ? S.services.length + " усл." : "нет") : "", conn: `Google: ${S.user.google ? "вкл" : "выкл"} · Apple: ${L.ics ? "ссылка" : "—"}`,
  };
  const rem = `
    <div class="chips" id="rem-chips">${remAll.map((m) => chip(st.remind.includes(m), "dRem", `data-m="${m}"`, I18N.before(remLabel(m)))).join("")}</div>
    <div class="lbl" style="margin-top:14px">Своё время: за сколько до события</div>
    <div class="crow2">${stepper("cr-n", S.cr.n, 5, 1, 999)}<div class="chips">${[[1, "мин"], [60, "час"], [1440, "дн"]].map(([u, t]) => chip(S.cr.u === u, "crU", `data-u="${u}"`, t)).join("")}</div><button class="btn alt sm" style="width:auto;padding:0 16px" data-act="dRemAdd">Добавить</button></div>
    <div class="kv" style="margin-top:12px"><div>«Весь день»: напомнить в<small>для событий без времени</small></div><button class="timebtn num sm" data-act="pickAllday" id="ah">${pad(st.allday_hour)}:00</button></div>
    <p class="sub">Максимум по вашему тарифу: ${L.maxReminders}.</p>`;
  const dig = `
    ${timeRow("digest_morning", "Утром: задачи на день", "бот пришлёт список в это время", "dm")}
    ${timeRow("digest_evening", "Вечером: план на завтра", "напоминание о завтрашних делах", "de")}
    <div class="lbl">Присылать, если событий не меньше</div>
    <div class="chips">${[1, 2, 3, 5, 8].map((n) => chip(st.digest_min === n, "dmin", `data-v="${n}"`, n)).join("")}</div>`;
  const svc = `
    <p class="sub" style="margin-top:0">Напишите свои услуги и сколько они длятся. Если в записи есть название услуги («маникюр»), бот и приложение сами поставят конец записи и не дадут занять это время дважды.</p>
    <div id="svc-list">${(S.services || []).map((x) => `<div class="crow"><div><b translate="no">${esc(x.name)}</b> <span class="sub">· ${x.minutes >= 60 ? `${Math.floor(x.minutes / 60)} ч${x.minutes % 60 ? " " + (x.minutes % 60) + " мин" : ""}` : x.minutes + " мин"}</span></div><button class="mini alt" data-act="svcDel" data-id="${esc(x.id)}">Удалить</button></div>`).join("") || `<div class="sub" style="margin-bottom:8px">Пока пусто</div>`}</div>
    <div class="field" style="margin-top:10px"><label for="sv-name">Название услуги</label><input id="sv-name" class="in" maxlength="60" placeholder="Например, маникюр"></div>
    <div class="lbl">Сколько длится</div>
    <div class="chips" id="sv-chips">${[15, 30, 45, 60, 90, 120, 180].map((m) => chip(S.svcMin === m, "svcMin", `data-m="${m}"`, remLabel(m).replace("мин", "мин"))).join("")}</div>
    <div class="crow2" style="margin-top:10px"><span class="sub">или точнее:</span>${stepper("sv-min", S.svcMin, 5, 5, 720)}<button class="btn sm" style="width:auto;padding:0 18px" data-act="svcAdd">Добавить</button></div>`;
  const q0 = (S.cq || "").toLowerCase();
  const cl = (S.clients || []).filter((c) => !q0 || [c.name, c.phone, c.username].filter(Boolean).join(" ").toLowerCase().includes(q0));
  const cliBody = `<input id="cq" class="in" placeholder="Найти клиента" value="${esc(S.cq || "")}" autocomplete="off">
    <div style="margin-top:10px">${cl.length ? cl.slice(0, 40).map((c) => `<button class="crow" style="width:100%;text-align:left" data-act="clientOpen" data-id="${esc(c.id)}"><div><b translate="no">${esc(c.name || c.phone || "@" + c.username)}</b><br><span class="sub" translate="no">${esc([c.phone, c.username ? "@" + c.username : ""].filter(Boolean).join(" · "))}</span></div><span class="sub">Визитов: ${c.visits}</span></button>`).join("") : `<div class="sub">${S.clients === null ? "Загрузка…" : "Клиенты появляются, когда в записи есть телефон или @ник клиента, например: «запиши Анна маникюр завтра в 15:00 +998901234567»."}</div>`}</div>`;
  const langBody = `<div class="chips">${I18N.LANGS.map((l) => chip(I18N.lang === l, "lang", `data-v="${l}"`, `<span translate="no">${I18N.NAMES[l]}</span>`)).join("")}</div>`;
  const tourBody = `<button class="btn alt" data-act="tourOpen">Пройти обучение заново</button>`;
  const dataBody = `<div class="kv"><div>Удалить мои данные<small>Все события, настройки и подключения</small></div><button class="mini alt" data-act="wipe">Удалить</button></div><p class="sub">Мы храним только ваш Telegram ID, часовой пояс, настройки и события.</p>`;
  const I = (p) => `<svg class="mic" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const items = [
    ["lang", "Язык", "Язык", langBody, `<span translate="no">${I18N.NAMES[I18N.lang]}</span>`, I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>')],
    ["theme", "Тема", "Тема", themeBody, sums.theme, I('<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/>')],
    ["shape", "Вид календаря", "Вид календаря", shapeBody, sums.shape, I('<rect x="4" y="4" width="16" height="16" rx="5"/>')],
    ["marks", "Отметки", "Отметки: дни, задачи, выполненное", marksBody, sums.marks, I('<path d="M6 4h12v17l-6-4-6 4z"/>')],
    ["rem", "Напоминания", "Напоминания по умолчанию", rem, sums.rem, I('<path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4"/>')],
    ["dig", "Утро и вечер", "Утро и вечер в чате", dig, sums.dig, I('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>')],
    ["svc", "Услуги и время", "Услуги и время", svc, sums.svc, I('<path d="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10"/>')],
    ["cli", "Клиенты", "Клиенты", cliBody, sums.cli, I('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>')],
    ["conn", "Подключения", "Подключения", integrations(), sums.conn, I('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>')],
    ["tour", "Обучение", "Обучение", tourBody, "", I('<path d="M3 5h8a3 3 0 0 1 3 3v12a3 3 0 0 0-3-3H3zM21 5h-4a3 3 0 0 0-3 3"/>')],
    ["data", "Данные", "Данные", dataBody, "", I('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>')],
  ];
  const page = items.find((x) => x[0] === S.spage);
  if (page) { openSheet(`<button class="back" data-act="sback"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>Назад</button><h2>${page[2]}</h2>${page[3]}`, "settings:" + page[0]); return; }
  openSheet(`
    <h2>Настройки</h2>
    <button class="plate" data-act="tariffs"><div><b>Подписки</b><small>Сейчас: ${esc((S.plans[p] || DEMO_PLANS[p]).title)}${p === "free" ? "" : " · до " + until}</small></div><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>
    <div class="mgrid">${items.map((x) => `<button class="mcard" data-act="spage" data-k="${x[0]}">${x[5]}<b>${x[1]}</b><small>${x[4] || "&nbsp;"}</small></button>`).join("")}</div>
    ${S.user.is_admin ? `<button class="plate" data-act="admin"><div><b>Админ-панель</b><small>Коды подписок, статистика, Google, выдача тарифа</small></div><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>` : ""}`, "settings:menu");
}
async function loadServices() { try { const r = await api("services"); S.services = r.services || []; if ($("#sheet").classList.contains("open") && (S.sheetKey || "").startsWith("settings")) openSettings(); } catch (e) {} }

function refBlock() {
  const r = S.ref, d = S.user.disc_pct || 0;
  return `<h3>Пригласите друга</h3><div class="plan"><div class="sub" style="margin-bottom:8px">Вам и другу — скидка 20% на оплату тарифа: другу сразу, вам после его первой оплаты. Скидка действует на разовую оплату (месяц или год), без автопродления.</div>
    ${r ? `<code class="url" translate="no">${esc(r.link)}</code><div class="row2" style="margin-top:10px"><button class="btn alt sm" data-act="refCopy">Скопировать ссылку</button><div class="sub" style="align-self:center">Приглашено: ${r.invited} · Ваша скидка: ${d}%</div></div>` : `<div class="sub">Загрузка…</div>`}</div>`;
}
async function loadRef() { try { S.ref = await api("referral"); if (S.sheetKey === "tariffs") openTariffs(); } catch (e) {} }
function openTariffs() {
  if (!S.ref) loadRef();
  const p = S.user.plan, until = S.user.plan_until ? fmtDate(S.user.plan_until) : "";
  openSheet(`<h2>Тарифы</h2>
    <div class="plate static"><div><b>Сейчас: ${esc((S.plans[p] || DEMO_PLANS[p]).title)}</b><small>${p === "free" ? "Бесплатный тариф" : "Действует до " + until}</small></div></div>
    ${refBlock()}
    <h3>Код подписки</h3>
    <div class="row2" style="grid-template-columns:1fr auto"><input id="promo" class="in" placeholder="CAL-XXXX-XXXX" autocapitalize="characters" autocomplete="off"><button class="btn sm" style="width:auto;padding:0 18px" data-act="redeem">Применить</button></div>
    <h3>Планы</h3>
    ${["free", "plus", "pro", "team"].map((k) => planCard(k, p, until)).join("")}
    <p class="sub" style="text-align:center">Месячная подписка продлевается сама, отменить можно в любой момент: Настройки Telegram → Мои звёзды → Подписки. Участники группы с тарифом Team получают Pro, пока состоят в группе. Условия возврата: /paysupport в боте.</p>`, "tariffs");
}
function planCard(k, cur, until) {
  const pr = (x) => Math.round(x * (100 - (S.user.disc_pct || 0)) / 100);
  const P = S.plans[k] || DEMO_PLANS[k], f = { free: ["До 40 активных событий", "1 напоминание", "1 группа", "3 темы"],
    plus: ["События без лимита", "Повторы событий", "До 3 напоминаний", "Все темы", "Подписка для Apple и Google (ICS)", "До 3 групп"],
    pro: ["Всё из Plus", "Синхронизация с Google Календарём", "До 5 напоминаний", "Группы без лимита"],
    team: ["Всё из Pro", "Режим салона: вкладка на каждого сотрудника", "Запись на сотрудника по @нику", "Админ видит записи всех", "Напоминания и в группу, и сотруднику лично", "Все участники группы получают Pro"] }[k];
  return `<div class="plan ${cur === k ? "cur" : ""}"><h4><span>${P.title}</span><span class="sub">${k === "free" ? "бесплатно" : `${P.stars.month} ⭐/мес`}</span></h4>
    <ul>${f.map((x) => `<li>${x}</li>`).join("")}</ul>
    ${k === "free" ? (cur === "free" ? `<div class="sub">Ваш тариф</div>` : "") : cur === k ? `<div class="sub" style="margin-bottom:8px">Активен до ${until}</div>` : ""}
    ${k !== "free" ? `<div class="prices"><button data-act="buy" data-p="${k}" data-d="month">${pr(P.stars.month)} ⭐ / ${S.user.disc_pct ? "30 дн." : "мес"}</button><button class="alt" data-act="buy" data-p="${k}" data-d="year">${pr(P.stars.year)} ⭐ / год</button></div>${S.user.disc_pct ? `<div class="sub" style="margin-top:6px">скидка ${S.user.disc_pct}%: разовая оплата, без автопродления</div>` : ""}` : ""}</div>`;
}
function integrations() {
  const L = S.limits;
  const ics = L.ics && S.ics
    ? `<div class="kv"><div>Apple Календарь / подписка<small>Добавьте ссылку как «Подписной календарь» (iPhone: Настройки → Календарь → Учётные записи → Добавить → Другое). События идут из бота в календарь, обратно — нет.</small></div></div>
       <div class="row2" style="margin-bottom:8px"><button class="btn alt sm" data-act="icsCopy">Скопировать ссылку</button><button class="btn alt sm" data-act="icsNew">Новая ссылка</button></div>`
    : `<div class="kv"><div>Apple Календарь / подписка<small>🔒 Тариф Plus и выше</small></div></div>`;
  const g = L.google
    ? (S.user.google
      ? `<div class="kv"><div>Google Календарь<small>Подключён</small></div><div style="display:flex;gap:6px"><button class="mini" data-act="gSync">Синхронизировать</button><button class="mini alt" data-act="gOff">Отключить</button></div></div>`
      : `<div class="kv"><div>Google Календарь<small>Только события, без почты и контактов</small></div><button class="mini" data-act="gOn">Подключить</button></div>`)
    : `<div class="kv"><div>Google Календарь<small>🔒 Тариф Pro и выше</small></div></div>`;
  return ics + g;
}

/* ---------- обучение при первом входе ---------- */
const TOUR = [
  ["Добро пожаловать", "Это ваш календарь. События можно добавлять кнопкой «+» или просто написать боту обычной фразой.", '<rect x="14" y="22" width="92" height="76" rx="14"/><path d="M14 44h92M38 14v18M82 14v18"/><circle cx="38" cy="66" r="5" fill="currentColor"/><circle cx="60" cy="66" r="5"/><circle cx="82" cy="66" r="5"/><circle cx="38" cy="84" r="5"/>'],
  ["Пишите боту словами", "Слово-команда, что, когда: «добавь стоматолог завтра в 15:00». Бот сам найдёт дату и время и напомнит заранее.", '<path d="M16 24h88a8 8 0 0 1 8 8v36a8 8 0 0 1-8 8H56l-22 18V76H16a8 8 0 0 1-8-8V32a8 8 0 0 1 8-8z"/><path d="M28 42h52M28 56h34"/>'],
  ["Месяц, неделя, день", "Переключайтесь вкладками сверху. Долгое нажатие на день — отметить его (выполнено, пропуск, особый).", '<rect x="12" y="26" width="96" height="22" rx="11"/><rect x="16" y="30" width="30" height="14" rx="7" fill="currentColor"/><path d="M24 70l12 12 24-26M70 78l22-18" /><circle cx="92" cy="60" r="7"/>'],
  ["Готово и отложить", "У каждой задачи две кнопки: галочка — выполнено, часы — отложить напоминание. Время напоминаний и сводки утром и вечером настраиваются в настройках.", '<circle cx="38" cy="60" r="24"/><path d="M26 60l9 9 16-18"/><circle cx="86" cy="62" r="22"/><path d="M86 48v14l9 6M78 34h16"/>'],
  ["Группы и салоны", "Добавьте бота в группу: записи клиентов попадут в календарь сотрудников. Тарифы, коды подписки и язык — в настройках.", '<circle cx="40" cy="44" r="14"/><circle cx="82" cy="48" r="11"/><path d="M12 98c0-18 12-30 28-30s28 12 28 30M70 78c14-6 32 2 34 20"/>'],
];
function openTour(i = 0) {
  S.tour = i; const s = TOUR[i], last = i === TOUR.length - 1;
  openSheet(`<div class="tour"><div class="tourimg"><svg width="120" height="120" viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${s[2]}</svg></div>
    <h2 style="text-align:center">${s[0]}</h2><p>${s[1]}</p>
    <div class="tdots">${TOUR.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
    ${i === 0 ? `<div class="chips" style="justify-content:center;margin:0 0 12px">${I18N.LANGS.map((l) => `<button class="chip ${I18N.lang === l ? "on" : ""}" data-act="lang" data-v="${l}"><span translate="no">${I18N.NAMES[l]}</span></button>`).join("")}</div>` : ""}
    <div class="btns" style="grid-template-columns:1fr 1.4fr;margin-top:6px">${i === 0 ? `<button class="btn alt" data-act="tourEnd">Пропустить</button>` : `<button class="btn alt" data-act="tourBack">Назад</button>`}<button class="btn" data-act="${last ? "tourEnd" : "tourNext"}">${last ? "Начать" : "Далее"}</button></div></div>`, "tour");
}
async function tourDone() { closeSheet(); if (!S.user.settings.onboarded) await saveSetting({ onboarded: true }); }

/* ---------- клиенты ---------- */
async function loadClients() { try { const r = await api("clients"); S.clients = r.clients || []; } catch (e) { S.clients = []; } if ((S.sheetKey || "").startsWith("settings")) openSettings(); }
async function openClient(id) {
  const r = await api("client_get", { id });
  if (r.error) return toast("Клиент не найден");
  const c = r.client, d = r.draft, esc2 = encodeURIComponent(d || "");
  const links = [c.username ? [`https://t.me/${c.username}?text=${esc2}`, "Telegram @" + c.username] : null, c.phone ? [`https://wa.me/${c.phone.replace(/\D/g, "")}?text=${esc2}`, "WhatsApp " + c.phone] : null].filter(Boolean);
  openSheet(`<h2 translate="no">${esc(c.name || c.phone || "@" + c.username)}</h2>
    <div class="sub" translate="no" style="margin:-8px 0 12px">${esc([c.phone, c.username ? "@" + c.username : ""].filter(Boolean).join(" · "))} · <span translate="yes">Визитов: ${(r.events || []).filter((e) => new Date(e.starts_at) < new Date()).length}</span></div>
    <div class="field"><label for="cl-name">Имя</label><input id="cl-name" class="in" maxlength="80" value="${esc(c.name || "")}"></div>
    <div class="field"><label for="cl-note">Заметка</label><textarea id="cl-note" class="in" rows="3" maxlength="1000">${esc(c.note || "")}</textarea></div>
    <button class="btn" data-act="clientSave" data-id="${esc(c.id)}">Сохранить</button>
    ${(r.events || []).length ? `<h3>История</h3>${r.events.map((e) => `<div class="crow"><span translate="no">${esc(e.title)}</span><span class="sub num">${new Date(e.starts_at).toLocaleDateString(I18N.locale())}</span></div>`).join("")}` : ""}
    ${d ? `<h3>Заготовка сообщения клиенту</h3><pre class="codes" translate="no">${esc(d)}</pre><div class="btns" style="margin-top:8px"><button class="btn alt sm" data-act="copy" data-t="${esc(d)}">Скопировать заготовку</button>${links.map((l) => `<button class="btn alt sm" data-act="openlink" data-u="${esc(l[0])}">Написать клиенту: ${esc(l[1])}</button>`).join("")}</div><p class="sub">Бот не может написать клиенту первым — вы отправляете сообщение сами одним нажатием.</p>` : ""}`, "client");
}

/* ---------- админ-панель ---------- */
const A = { plan: "pro", gplan: "plus" };
async function openAdmin() {
  openSheet(`<h2>Админ-панель</h2><div class="empty">Загрузка…</div>`, "admin-load");
  const [s, c, gd] = await Promise.all([api("admin_stats"), api("admin_codes"), api("admin_google")]);
  if (s.error) { openSheet(`<h2>Админ-панель</h2><div class="empty">Нет доступа</div>`, "admin"); return; }
  const tick = s.last_tick ? Math.round((Date.now() - new Date(s.last_tick).getTime()) / 60000) : null;
  const sched = tick === null ? "⚠️ планировщик не запускался (cron.sql)" : tick <= 3 ? `✅ планировщик работает (${tick} мин назад)` : `⚠️ планировщик молчит ${tick} мин`;
  const plans = (id, cur, all) => `<div class="chips" id="${id}">${(all ? ["plus", "pro", "team", "free"] : ["plus", "pro", "team"]).map((k) => `<button class="chip ${cur === k ? "on" : ""}" data-act="apl" data-g="${id}" data-v="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>`;
  openSheet(`<h2>Админ-панель</h2>
    <div class="stat"><div><b>${s.users}</b><span>пользователей</span></div><div><b>${s.paid}</b><span>с тарифом</span></div><div><b>${s.groups}</b><span>групп</span></div></div>
    <div class="stat"><div><b>${s.events}</b><span>событий</span></div><div><b>${s.stars}</b><span>⭐ получено</span></div><div><b>${s.codes}</b><span>кодов</span></div></div>
    <p class="sub">${sched}${s.db_mb != null ? `<br>База данных: ${s.db_mb} МБ из 500` : ""}</p>
    <h3>Google: проверка настройки</h3>
    <div class="plan"><div class="sub" style="line-height:1.6">${gd.configured ? "✅ GOOGLE_CLIENT_ID и SECRET заданы" : "⚠️ Не заданы GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (supabase secrets set)"}<br>Client ID: <span translate="no">${esc(gd.client_id_tail || "—")}</span><br>Доступ (scope): <span translate="no">${esc((gd.scope || "").replace("https://www.googleapis.com/auth/", ""))}</span><br>Подключено пользователей: ${gd.connected || 0}<br>Redirect URI в консоли Google должен быть:</div><code class="url" translate="no">${esc(gd.redirect || "")}</code><button class="btn alt sm" style="margin-top:8px" data-act="copy" data-t="${esc(gd.redirect || "")}">Скопировать</button><div class="sub" style="margin-top:8px">Также включите «Google Calendar API» в проекте Google Cloud и добавьте свою почту в Test users.</div></div>
    <h3>Создать коды подписки</h3>
    <div class="field"><span class="lbl">Тариф</span>${plans("ac-plan", A.plan)}</div>
    <div class="row3"><div class="field"><label>Дней</label><input id="ac-days" class="in num" type="number" inputmode="numeric" value="30"></div>
    <div class="field"><label>Раз на код</label><input id="ac-uses" class="in num" type="number" inputmode="numeric" value="1"></div>
    <div class="field"><label>Сколько кодов</label><input id="ac-count" class="in num" type="number" inputmode="numeric" value="1"></div></div>
    <div class="field"><label>Заметка (кому / зачем)</label><input id="ac-note" class="in" maxlength="100" placeholder="например, салон «Роза»"></div>
    <button class="btn" data-act="acCreate">Создать</button><div id="ac-out"></div>
    <h3>Выдать тариф по Telegram ID</h3>
    <div class="field"><span class="lbl">Тариф</span>${plans("ag-plan", A.gplan, true)}</div>
    <div class="row2"><input id="ag-id" class="in num" type="number" inputmode="numeric" placeholder="Telegram ID"><input id="ag-days" class="in num" type="number" inputmode="numeric" value="30"></div>
    <button class="btn alt" style="margin-top:8px" data-act="agGrant">Выдать</button>
    <h3>Последние коды</h3>
    ${(c.codes || []).map((x) => `<div class="crow ${x.revoked ? "off" : ""}"><div><code>${esc(x.code)}</code><br><span class="sub">${esc(x.plan)} · ${x.days} дн. · ${x.used_count}/${x.max_uses}${x.note ? " · " + esc(x.note) : ""}</span></div>${x.revoked ? "" : `<button class="mini alt" data-act="acRevoke" data-c="${esc(x.code)}">Отозвать</button>`}</div>`).join("") || `<div class="empty">Кодов пока нет</div>`}
    <p class="sub" style="margin-top:12px">Пользователь вводит код в Настройки → Тариф или командой /code КОД в боте. Отчёты об оплатах приходят вам в личные сообщения с #оплата_подписки.</p>`, "admin");
}

/* ============================ ДЕЙСТВИЯ ============================ */
async function saveSetting(patch, reopen) {
  Object.assign(S.user.settings, patch);
  applyTheme();
  if (reopen === "render") render(true);
  try {
    const r = await api("settings", patch);
    if (r.error) { toast(r.message || "Недоступно"); return false; }
    if (r.settings) S.user.settings = { ...DEFAULTS, ...r.settings };
    return true;
  } catch (e) { toast("Нет связи с сервером"); return false; }
}
async function reloadRem(patch) {
  const prev = S.user.settings.remind;
  const ok = await saveSetting(patch);
  if (!ok) S.user.settings.remind = prev;
  openSettings();
}

let lpTimer = null, lpFired = false;
document.addEventListener("pointerdown", (e) => {   // долгое нажатие на день = меню отметок
  const el = e.target.closest(".tile[data-k], .wtile[data-k]"); if (!el) return;
  lpFired = false; clearTimeout(lpTimer);
  lpTimer = setTimeout(() => { lpFired = true; try { TG && TG.HapticFeedback && TG.HapticFeedback.impactOccurred("medium"); } catch (_) {} openMarkMenu(el.dataset.k); }, 480);
});
["pointerup", "pointercancel", "pointermove", "scroll"].forEach((ev) => document.addEventListener(ev, () => clearTimeout(lpTimer), { passive: true, capture: true }));

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  if (lpFired) { lpFired = false; return; }
  const a = el.dataset.act, S0 = S.sel;
  if (a === "retry") { S.ready ? render() : init(); return; }
  switch (a) {
    case "prev": case "next": {
      const n = a === "next" ? 1 : -1;
      if (S.view === "month") { S.sel = new Date(S0.getFullYear(), S0.getMonth() + n, 1); const t = new Date(); if (S.sel.getMonth() === t.getMonth() && S.sel.getFullYear() === t.getFullYear()) S.sel = sod(t); }
      else S.sel = addD(S0, S.view === "week" ? 7 * n : n);
      tap(); return load();
    }
    case "today": S.sel = sod(new Date()); tap(); return load();
    case "view": S.view = el.dataset.v; tap(); try { localStorage.setItem("view", S.view); } catch (e) {} return render();   // вид хранится на устройстве: без запроса к серверу
    case "day": { const [y, m, d] = el.dataset.k.split("-").map(Number); S.sel = new Date(y, m - 1, d); tap(); return load(); }
    case "scope": S.scope = el.dataset.t === "u" ? { t: "u", id: Number(el.dataset.id) } : { t: el.dataset.t }; tap(); return load(true, true);
    case "add": return openForm(null);
    case "addAt": return openForm(null, Number(el.dataset.h));
    case "edit": { const ev = S.events.find((x) => x.id === el.dataset.id); if (ev) openForm(ev); return; }
    case "close": return closeSheet();
    case "help": return openHelp();
    case "copy": return copy(el.dataset.t, "Пример скопирован");
    case "settings": S.spage = null; return openSettings();
    case "spage": S.spage = el.dataset.k; openSettings(); if (S.spage === "svc" && S.services === null) loadServices(); if (S.spage === "cli" && S.clients === null) loadClients(); return;
    case "sback": S.spage = null; return openSettings();
    case "langsheet": return openSheet(`<h2>Выберите язык</h2><div class="chips">${I18N.LANGS.map((l) => `<button class="chip ${I18N.lang === l ? "on" : ""}" data-act="lang" data-v="${l}"><span translate="no">${I18N.NAMES[l]}</span></button>`).join("")}</div>`, "langs");
    case "tariffs": return openTariffs();
    case "lang": await saveSetting({ lang: el.dataset.v }); applyLang(el.dataset.v); render(true); if (S.sheetKey === "tour") return openTour(S.tour); if (S.sheetKey === "langs") return closeSheet(); return openSettings();
    case "tourOpen": return openTour(0);
    case "tourNext": return openTour(S.tour + 1);
    case "tourBack": return openTour(Math.max(0, S.tour - 1));
    case "tourEnd": return tourDone();
    case "refCopy": return copy(S.ref.link, "Ссылка скопирована");
    case "clientOpen": return openClient(el.dataset.id);
    case "clientSave": { const r = await api("client_save", { id: el.dataset.id, name: $("#cl-name").value, note: $("#cl-note").value }); toast(r.ok ? "Сохранено" : "Не получилось"); await loadClients(); return openSettings(); }
    case "openlink": {
      const u = el.dataset.u || ""; if (!/^https:\/\//i.test(u)) return;   // только https
      if (TG && TG.openLink) { const opt = el.dataset.ext ? { try_browser: TG.platform === "ios" ? "safari" : "chrome" } : undefined; return TG.openLink(u, opt); }
      return window.open(u, "_blank", "noopener");
    }
    case "acc": { const box = el.closest(".acc"); box.classList.toggle("open"); S.acc[el.dataset.k] = box.classList.contains("open"); if (el.dataset.k === "svc" && S.acc.svc && S.services === null) loadServices(); if (el.dataset.k === "cli" && S.acc.cli && S.clients === null) loadClients(); return; }
    case "stp": { const b = $("#" + el.dataset.id); const v = Math.max(Number(el.dataset.min), Math.min(Number(el.dataset.max), Number(b.textContent) + Number(el.dataset.d))); b.textContent = v; if (el.dataset.id === "cr-n") S.cr.n = v; if (el.dataset.id === "sv-min") { S.svcMin = v; document.querySelectorAll("#sv-chips .chip").forEach((c) => c.classList.toggle("on", Number(c.dataset.m) === v)); } tap(); return; }
    case "crU": S.cr.u = Number(el.dataset.u); el.parentNode.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === el)); return;
    case "pickD1": { const v = await pickDate(F.d1, { title: "Дата" }); if (v) { F.d1 = v; el.textContent = fmtD(v); if (F.d2 < v) { F.d2 = v; $("#f-date2").textContent = fmtD(v); } } return; }
    case "pickD2": { const v = await pickDate(F.d2, { min: F.d1, title: "Дата окончания" }); if (v) { F.d2 = v; el.textContent = fmtD(v); } return; }
    case "pickStart": { const v = await pickTime(F.t0, { title: "Начало" }); if (v) { F.t0 = v; el.textContent = v; } return; }
    case "pickEnd": { const v = await pickTime(F.t1 || F.t0, { title: "Конец", off: true, offLabel: "Без конца" }); if (v === null) { F.t1 = ""; el.textContent = "не указан"; } else if (v) { F.t1 = v; el.textContent = v; } return; }
    case "pickDigest": { const k = el.dataset.k; const v = await pickTime(S.user.settings[k] || (k === "digest_morning" ? "08:00" : "20:00"), { title: k === "digest_morning" ? "Утром: задачи на день" : "Вечером: план на завтра", off: true, offLabel: "Выключить" }); if (v === undefined) return; await saveSetting({ [k]: v }); el.textContent = v || "Выкл"; return; }
    case "pickAllday": { const v = await pickTime(pad(S.user.settings.allday_hour) + ":00", { hoursOnly: true, title: "Напоминать о событиях «на весь день» в" }); if (v) { await saveSetting({ allday_hour: Number(v.slice(0, 2)) }); el.textContent = v; } return; }
    case "dmin": await saveSetting({ digest_min: Number(el.dataset.v) }); return openSettings();
    case "mlt": await saveSetting({ multi_style: el.dataset.v }, "render"); return openSettings();
    case "dstyle": await saveSetting({ done_style: el.dataset.v }); return openSettings();
    case "svcMin": { const m = Number(el.dataset.m); S.svcMin = m; $("#sv-min").textContent = m; document.querySelectorAll("#sv-chips .chip").forEach((c) => c.classList.toggle("on", c === el)); return; }
    case "svcAdd": { const name = ($("#sv-name").value || "").trim(); if (!name) return toast("Введите название услуги"); const r = await api("service_save", { name, minutes: S.svcMin }); if (r.error) return toast(r.message || "Не удалось"); toast("Услуга добавлена"); return loadServices(); }
    case "svcDel": await api("service_delete", { id: el.dataset.id }); return loadServices();
    case "done": { const ev = S.events.find((x) => x.id === el.dataset.id && x.occ_start === el.dataset.occ); if (!ev) return; ev.done = !ev.done; tap(); render(true); api("done", { id: ev.id, day: K(new Date(ev.occ_start)), done: ev.done }).catch(() => toast("Не удалось сохранить")); return; }
    case "snz": return openSnooze(el.dataset.id, el.dataset.occ);
    case "snzdo": { closeSheet(); const r = await api("snooze", { id: el.dataset.id, occ: el.dataset.occ, minutes: Number(el.dataset.m) }); toast(r.ok ? "Напомню позже ⏰" : "Не получилось"); return; }
    case "apl": { A[el.dataset.g === "ac-plan" ? "plan" : "gplan"] = el.dataset.v; el.parentNode.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === el)); return; }
    case "markmenu": return openMarkMenu(el.dataset.k);
    case "setmark": {
      const k = el.dataset.k, m = el.dataset.m || null;
      if (m) S.marks[k] = m; else delete S.marks[k];
      closeSheet(); render(true); tap();
      api("mark", { day: k, mark: m }).catch(() => toast("Не удалось сохранить отметку"));
      return;
    }
    case "fAll": F.all_day = !F.all_day; $("#f-all").classList.toggle("on", F.all_day); $("#f-times").style.display = F.all_day ? "none" : "";
      F.remind = F.all_day ? [-(S.user.settings.allday_hour * 60)] : [...S.user.settings.remind].slice(0, S.limits.maxReminders); return drawRem();
    case "fRep": { const v = el.dataset.v; if (v && !S.limits.repeat) { toast("Повторы — в тарифе Plus"); return; } F.repeat = v; document.querySelectorAll("#f-rep .chip").forEach((c) => c.classList.toggle("on", c.dataset.v === v)); return; }
    case "fRem": { const m = Number(el.dataset.m), i = F.remind.indexOf(m); if (i >= 0) F.remind.splice(i, 1); else { if (F.remind.length >= S.limits.maxReminders) { toast(`В вашем тарифе до ${S.limits.maxReminders} напоминаний`); return; } F.remind.push(m); } return drawRem(); }
    case "fSave": return formSave(false);
    case "fDel": if (await ask("Удалить событие?")) { await api("delete", { id: F.id }); closeSheet(); await load(true); } return;

    case "theme": { const t = el.dataset.t; if (!S.limits.themes.includes(t)) { toast("Эта тема доступна в Plus и выше"); return; } if (await saveSetting({ theme: t })) openSettings(); return; }
    case "mstyle": await saveSetting({ mark_style: el.dataset.v }, "render"); return openSettings();
    case "sstyle": await saveSetting({ sel_style: el.dataset.v }, "render"); return openSettings();
    case "ws": await saveSetting({ week_start: Number(el.dataset.v) }, "render"); return openSettings();
    case "dRem": {
      const m = Number(el.dataset.m), cur = S.user.settings.remind, next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((x, y) => x - y);
      if (next.length > S.limits.maxReminders) { toast(`В вашем тарифе до ${S.limits.maxReminders} напоминаний. Выберите другой тариф для большего числа.`); return; }
      return reloadRem({ remind: next });
    }
    case "dRemAdd": {
      const m = Math.round(S.cr.n * S.cr.u);
      if (m < 1 || m > 43200) { toast("Не больше 30 дней"); return; }
      const cur = S.user.settings.remind;
      if (cur.includes(m)) return toast("Такое уже есть");
      if (cur.length + 1 > S.limits.maxReminders) { toast(`В вашем тарифе до ${S.limits.maxReminders} напоминаний`); return; }
      return reloadRem({ remind: [...cur, m].sort((x, y) => x - y) });
    }
    case "dOff": { const k = el.dataset.k; await saveSetting({ [k]: null }); return openSettings(); }
    case "buy": {
      const r = await api("invoice", { plan: el.dataset.p, period: el.dataset.d });
      if (!r.url) return toast(r.message || "Оплата недоступна");
      if (TG && TG.openInvoice) TG.openInvoice(r.url, (s) => { if (s === "paid") { toast("Спасибо! Тариф активируется ✨"); setTimeout(async () => { await init(true); openTariffs(); }, 1500); } });
      else window.open(r.url, "_blank");
      return;
    }
    case "redeem": {
      const code = ($("#promo").value || "").trim(); if (!code) return toast("Введите код");
      const r = await api("redeem", { code });
      if (r.error) return toast(r.message || "Код не подошёл");
      toast("Код принят 🎁"); await init(true); return openTariffs();
    }
    case "icsCopy": return copy(S.ics, "Ссылка скопирована");
    case "icsNew": if (await ask("Старая ссылка перестанет работать. Создать новую?")) { const r = await api("ics_rotate"); S.ics = r.ics; openSettings(); } return;
    case "gOn": {
      const r = await api("google_url"); if (!r.url) return toast(r.message || "Недоступно");
      return openSheet(`<h2>Подключение Google</h2><p class="sub" style="line-height:1.55">Google не разрешает вход во встроенном браузере Telegram. Откройте ссылку в обычном браузере (Chrome или Safari), подтвердите доступ, и вы вернётесь в Telegram.</p>
        <div class="btns"><button class="btn" data-act="openlink" data-u="${esc(r.url)}" data-ext="1">Открыть в браузере</button><button class="btn alt" data-act="copy" data-t="${esc(r.url)}">Скопировать ссылку</button></div>
        <p class="sub">Если кнопка открывает страницу внутри Telegram и Google пишет «ошибка 403: disallowed_useragent», скопируйте ссылку и вставьте её в Chrome или Safari.</p>`, "gopen");
    }
    case "gSync": { toast("Синхронизирую…"); const r = await api("google_sync"); toast(r.error ? "Google: " + (r.detail || "не получилось, подключите заново") : `Готово: получено ${r.pulled}, отправлено ${r.pushed}`); await load(true); return; }
    case "gOff": if (await ask("Отключить Google Календарь?")) { await api("google_disconnect"); S.user.google = false; openSettings(); } return;
    case "wipe": if (await ask("Удалить все ваши данные? Это нельзя отменить.")) { const r = await api("delete_me", { confirm: "DELETE" }); if (r.ok) { toast("Данные удалены"); setTimeout(() => TG && TG.close && TG.close(), 1200); } } return;

    case "admin": return openAdmin();
    case "acCreate": {
      const r = await api("admin_create", { plan: A.plan, days: $("#ac-days").value, uses: $("#ac-uses").value, count: $("#ac-count").value, note: $("#ac-note").value });
      if (!r.codes || !r.codes.length) return toast("Не удалось создать (выполнена ли миграция 002?)");
      $("#ac-out").innerHTML = `<pre class="codes">${r.codes.join("\n")}</pre><button class="btn alt sm" data-act="copy" data-t="${r.codes.join("\n")}">Скопировать все</button>`;
      return;
    }
    case "acRevoke": if (await ask("Отозвать код?")) { await api("admin_revoke", { code: el.dataset.c }); openAdmin(); } return;
    case "agGrant": { const r = await api("admin_grant", { user_id: $("#ag-id").value, plan: A.gplan, days: $("#ag-days").value }); return toast(r.ok ? "Тариф выдан" : "Проверьте ID и тариф"); }
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "cq") { S.cq = e.target.value; const pos = e.target.selectionStart; openSettings(); const n = $("#cq"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
  if (e.target.id === "rad") document.documentElement.style.setProperty("--rn", e.target.value);
  if (e.target.id === "dim") document.documentElement.style.setProperty("--td", e.target.value);
});
document.addEventListener("change", async (e) => {
  const id = e.target.id;
  if (id === "cq") { S.cq = e.target.value; return; }
  if (id === "rad") await saveSetting({ radius: Number(e.target.value) });
  else if (id === "dim") await saveSetting({ tile_dim: Number(e.target.value) });
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

// Новые события из бота появляются в приложении сами: при возврате, активации окна и раз в 30 секунд, пока оно открыто
let hiddenAt = 0;
function softRefresh() {
  if (DEMO || !S.ready || S.busy || document.hidden || $("#sheet").classList.contains("open")) return;
  load(true, true);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (!DEMO && S.ready && Date.now() - hiddenAt > 300000 && !$("#sheet").classList.contains("open")) init(true);   // долго не заходили: обновим и тариф
  else softRefresh();
});
window.addEventListener("focus", softRefresh);
try { TG && TG.onEvent && TG.onEvent("activated", softRefresh); } catch (e) {}
setInterval(softRefresh, 30000);
// Страховка от «пустого» календаря: если ширина области изменилась (окно Telegram раскрылось), перерисовываем
let lastW = 0;
if (window.ResizeObserver) new ResizeObserver(() => { const w = $("#main").clientWidth; if (Math.abs(w - lastW) > 2) { lastW = w; if (S.ready || true) render(true); } }).observe($("#main"));

/* ============================ СТАРТ ============================ */
if (TG) { try { TG.ready(); TG.expand(); TG.disableVerticalSwipes && TG.disableVerticalSwipes(); } catch (e) {} }
loadUiCache();
applyTheme();
render();                      // сразу рисуем пустой месяц — экран никогда не бывает пустым
init().then(() => {
  const g = Q.get("google");
  if (g === "ok") toast("Google Календарь подключён ✅");
  else if (g === "denied" || g === "error") {
    const why = Q.get("why") || "", map = { access_denied: "Доступ не выдан. Если приложение в режиме Testing, добавьте свою почту в Test users", redirect_uri_mismatch: "Несовпадение redirect URI в консоли Google", invalid_client: "Неверный Client ID/Secret", invalid_grant: "Код устарел, попробуйте ещё раз", state: "Сессия устарела, нажмите «Подключить» снова", no_refresh_token: "Google не выдал постоянный доступ, попробуйте ещё раз" };
    toast("Google: " + (map[why] || why || "не получилось"));
  }
  if (DEMO && !FRAMED) toast("Демо-режим: данные не сохраняются");
});
