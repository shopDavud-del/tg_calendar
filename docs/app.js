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
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const MONTHS_G = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const WD = ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"];
const THEMES = {
  midnight: ["Полночь", "#0f0f10", "#dfe5a0"], black: ["Чёрная", "#000000", "#c9c9d1"], indigo: ["Индиго", "#dde5f3", "#5a4fcf"],
  emerald: ["Изумруд", "#101a16", "#f2c53d"], bordeaux: ["Бордо", "#17171a", "#d1345b"], teal: ["Бирюза", "#0b1b21", "#4de3c2"],
  terracotta: ["Терракота", "#e8d3c6", "#d9593a"], sage: ["Шалфей", "#eef2e0", "#5f8226"], luxury: ["Люкс", "#e9ecf2", "#1f2a44"],
  "cherry-champagne": ["Вишня · шампань", "#141417", "#E6D3B3"], "cherry-honey": ["Вишня · медь", "#141417", "#D4925F"],
  "cherry-lavender": ["Вишня · лаванда", "#141417", "#B8B3FF"], "cherry-ice": ["Вишня · лёд", "#141417", "#A6DCF2"], cherry: ["Чистая вишня", "#141417", "#B3263C"],
};
const DEFAULTS = { theme: "midnight", radius: 22, week_start: 1, view: "month", tile_dim: 7, mark_style: "scribble", sel_style: "fill",
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
const fmtDate = (iso) => new Date(iso).toLocaleDateString("ru-RU");

/* ============================ СОСТОЯНИЕ ============================ */
const S = {
  user: { id: 0, plan: "free", settings: { ...DEFAULTS }, google: false, is_admin: false },
  limits: { maxReminders: 1, repeat: false, ics: false, google: false, team: false, themes: ["midnight", "black", "indigo"] },
  plans: null, groups: [], ctx: null, team: null, scope: { t: "me" }, themes: Object.keys(THEMES), ics: null, bot: "",
  events: [], by: {}, marks: {}, sel: sod(new Date()), view: "month", key: "", ready: false, busy: false,
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
    mk(-2, 16, 0, "Встреча с клиентом", 60), mk(-5, 12, 0, "Йога", 60), mk(7, 12, 0, "Презентация", 60), mk(9, 15, 0, "Маникюр", 60)];
})();
const DEMO_MARKS = (() => {   // как на примере: зелёные и красные отметки по прошедшим дням
  const t = new Date(), m = {}; const pat = { 1: "miss", 2: "miss", 3: "done", 4: "miss", 5: "miss", 6: "done", 7: "miss", 8: "done", 9: "miss", 10: "miss" };
  for (let d = 1; d < t.getDate(); d++) m[K(new Date(t.getFullYear(), t.getMonth(), d))] = pat[((d - 1) % 10) + 1] || "miss";
  return m;
})();
const DEMO_PLANS = { free: { title: "Free", stars: { month: 0, year: 0 }, maxEvents: 40 }, plus: { title: "Plus", stars: { month: 100, year: 1000 } }, pro: { title: "Pro", stars: { month: 250, year: 2500 } }, team: { title: "Team", stars: { month: 500, year: 5000 } } };
async function demoApi(a, d) {
  if (a === "init") {
    const st = { ...DEFAULTS, ...(S.user.settings || {}) };
    for (const [q, k, f] of [["theme", "theme", String], ["view", "view", String], ["radius", "radius", Number], ["dim", "tile_dim", Number], ["mark", "mark_style", String], ["sel", "sel_style", String]]) if (Q.has(q)) st[k] = f(Q.get(q));
    return { user: { id: 1, plan: "pro", plan_until: new Date(Date.now() + 6 * 864e5).toISOString(), tz: "UTC", settings: st, google: false, is_admin: Q.has("admin") },
      limits: { maxEvents: 1e6, maxReminders: 5, repeat: true, ics: true, google: true, team: true, maxGroups: 1e6, themes: Object.keys(THEMES) }, plans: DEMO_PLANS,
      groups: [], ctx: null, themes: Object.keys(THEMES), ics: "https://example.supabase.co/functions/v1/ics?t=demo", bot: "demo_bot" };
  }
  if (a === "events") return { events: DEMO_EVS.filter((e) => new Date(e.occ_start) <= new Date(d.to) && new Date(e.occ_start) >= new Date(d.from)) };
  if (a === "marks") return { marks: DEMO_MARKS };
  if (a === "mark") { if (d.mark) DEMO_MARKS[d.day] = d.mark; else delete DEMO_MARKS[d.day]; return { ok: true }; }
  if (a === "save") { const s = d.starts_at; const row = { title: d.title, all_day: d.all_day, starts_at: s, occ_start: s, ends_at: d.ends_at, occ_end: d.ends_at, repeat: d.repeat, remind: d.remind, owner_id: 1 };
    if (d.id) Object.assign(DEMO_EVS.find((x) => x.id === d.id), row); else DEMO_EVS.push({ id: "d" + Math.random().toString(16).slice(2), ...row }); return { ok: true, notes: [] }; }
  if (a === "delete") { const i = DEMO_EVS.findIndex((x) => x.id === d.id); if (i >= 0) DEMO_EVS.splice(i, 1); return { ok: true }; }
  if (a === "settings") { Object.assign(S.user.settings, d); return { ok: true, settings: S.user.settings }; }
  if (a === "admin_stats") return { users: 12, paid: 3, groups: 2, events: 140, codes: 4, stars: 1500, last_tick: new Date().toISOString() };
  if (a === "admin_codes") return { codes: [{ code: "CAL-AB12-CD34", plan: "pro", days: 30, max_uses: 1, used_count: 0, note: "демо", revoked: false }] };
  return { error: "demo", message: "В демо-режиме это недоступно" };
}

/* ============================ ЗАГРУЗКА ============================ */
async function init(soft) {
  if (S.busy) return;
  S.busy = true;
  try {
    const r = await api("init", { start_param: (TG && TG.initDataUnsafe && TG.initDataUnsafe.start_param) || Q.get("g") || "" });
    if (r.error) throw new Error(r.error);
    Object.assign(S, { user: { ...r.user, settings: { ...DEFAULTS, ...r.user.settings } }, limits: r.limits, plans: r.plans, groups: r.groups || [], ctx: r.ctx, themes: r.themes, ics: r.ics, bot: r.bot });
    S.team = S.groups.find((g) => g.mode === "team" && g.isAdmin && (!S.ctx || g.id === S.ctx)) || null;
    if (!soft) { S.view = S.user.settings.view || "month"; S.scope = S.team && S.ctx === S.team.id ? { t: "all" } : { t: "me" }; }
    applyTheme();
    S.ready = true;
    await load(true);
  } catch (e) {
    console.error(e);
    if (!S.ready) $("#main").innerHTML = `<div class="empty">Не удалось загрузить календарь.<br><br><button class="btn sm" data-act="retry">Повторить</button><div class="sub" style="margin-top:12px">Если повторяется, проверьте адрес API в config.js</div></div>`;
  } finally { S.busy = false; }
}
function range() {
  const m = new Date(S.sel.getFullYear(), S.sel.getMonth(), 1);
  return [addD(m, -8), addD(new Date(m.getFullYear(), m.getMonth() + 1, 1), 8)];
}
async function load(force, quiet) {
  const m = new Date(S.sel.getFullYear(), S.sel.getMonth(), 1);
  const key = `${m.getFullYear()}-${m.getMonth()}-${S.scope.t}`;
  if (!force && key === S.key) return render(true);
  S.key = key;
  const [from, to] = range();
  try {
    const [e, mk] = await Promise.all([api("events", { from: from.toISOString(), to: to.toISOString() }), api("marks", { from: K(from), to: K(to) })]);
    S.events = e.events || []; S.marks = mk.marks || {};
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
function index() {
  S.by = {};
  for (const e of S.events) {
    if (!vis(e)) continue;
    const s = new Date(e.occ_start), en = e.occ_end ? new Date(e.occ_end) : null;
    let last = sod(s);
    if (en && e.all_day && en > s) last = sod(new Date(en.getTime() - 1));
    for (let d = sod(s); d <= last; d = addD(d, 1)) (S.by[K(d)] ||= []).push(e);
  }
  for (const k in S.by) S.by[k].sort((a, b) => (b.all_day - a.all_day) || (new Date(a.occ_start) - new Date(b.occ_start)));
}
function applyTheme() {
  const st = S.user.settings, r = document.documentElement;
  r.dataset.theme = THEMES[st.theme] ? st.theme : "midnight";
  r.style.setProperty("--rn", st.radius ?? 22);
  r.style.setProperty("--td", st.tile_dim ?? 7);
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
const dotsHTML = (k) => { const n = Math.min((S.by[k] || []).length, 3); return n ? `<span class="dots">${"<i></i>".repeat(n)}</span>` : ""; };
const ringSel = () => S.user.settings.sel_style === "ring";

function tileHTML(c, curMonth, today, week) {
  const k = K(c), sel = k === K(S.sel), isT = k === today, ring = ringSel();
  const cls = [week ? "wtile" : "tile", "num", !week && c.getMonth() !== curMonth ? "out" : "", isT ? "today" : "", sel ? "sel" : "", ring ? "ring" : ""].join(" ");
  const rings = ring ? (sel ? svg("ringp ringsel", PATH.ring) : isT ? svg("ringp ringtod", PATH.ring) : "") : "";
  const inner = week ? `<small>${WD[c.getDay()]}</small><b>${c.getDate()}</b>` : `<span class="n">${c.getDate()}</span>`;
  return `<button class="${cls}" data-act="day" data-k="${k}">${markHTML(k)}${rings}${inner}${dotsHTML(k)}</button>`;
}
function weekStart(d) { const off = (d.getDay() - S.user.settings.week_start + 7) % 7; return addD(d, -off); }
function weekTitle(d) { const a = weekStart(d), b = addD(a, 6); return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MONTHS_G[a.getMonth()]}` : `${a.getDate()} ${MONTHS_G[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MONTHS_G[b.getMonth()].slice(0, 3)}`; }

function monthHTML() {
  const d = S.sel, first = new Date(d.getFullYear(), d.getMonth(), 1);
  const off = (first.getDay() - S.user.settings.week_start + 7) % 7;
  const start = addD(first, -off), today = K(new Date());
  let h = `<div class="panel"><div class="grid7" style="margin-bottom:4px">${wdOrder().map((i) => `<div class="wd">${WD[i]}</div>`).join("")}</div><div class="grid7">`;
  for (let i = 0; i < 42; i++) h += tileHTML(addD(start, i), d.getMonth(), today, false);   // всегда 6 недель — высота не меняется
  return h + `</div></div>` + agenda(d);
}
function weekHTML() {
  const a = weekStart(S.sel), today = K(new Date());
  let h = `<div class="panel"><div class="week">`;
  for (let i = 0; i < 7; i++) h += tileHTML(addD(a, i), 0, today, true);
  return h + `</div></div>`;
}
function evTime(e) {
  if (e.all_day) return "Весь день";
  const s = new Date(e.occ_start), en = e.occ_end ? new Date(e.occ_end) : null;
  return en ? `${hm(s)} – ${hm(en)}` : hm(s);
}
const memberName = (id) => { const m = S.team && (S.team.members || []).find((x) => x.id === id); return m ? m.name : ""; };
function evCard(e) {
  const g = S.groups.find((x) => x.id === e.owner_id || x.id === e.group_id);
  const who = e.group_id && S.team && e.owner_id !== S.user.id ? memberName(e.owner_id) : "";
  return `<button class="ev ${e.all_day ? "allday" : ""}" data-act="edit" data-id="${esc(e.id)}"><b>${esc(e.title)}</b><small class="num">${evTime(e)}${e.repeat ? " · ↻" : ""}</small>${g ? `<span class="tag">👥 ${esc(g.title)}${who ? ` · 👤 ${esc(who)}` : ""}</span>` : ""}</button>`;
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
    const here = timed.filter((e) => new Date(e.occ_start).getHours() === i);
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
    ms.filter((m) => m.id !== S.user.id).map((m) => c(sc.t === "u" && sc.id === m.id, "scope", `data-t="u" data-id="${m.id}"`, m.name)).join("");
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
function openSheet(html) { $("#box").innerHTML = html; $("#sheet").classList.add("open"); $("#box").scrollTop = 0; }
function closeSheet() { $("#sheet").classList.remove("open"); }

const REM_TIMED = [[5, "5 мин"], [15, "15 мин"], [30, "30 мин"], [60, "1 час"], [1440, "1 день"]];
const REM_ALL = [[-540, "в 9:00"], [360, "накануне в 18:00"]];
const remLabel = (m) => m < 0 ? `в ${Math.round(-m / 60)}:00` : m % 10080 === 0 ? `${m / 10080} нед.` : m % 1440 === 0 ? `${m / 1440} дн.` : m % 60 === 0 ? `${m / 60} ч` : `${m} мин`;
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
  const L = S.limits, tg = targets();
  const pre = !ev && S.scope.t === "u" && S.team ? `t:${S.team.id}:${S.scope.id}` : !ev && S.ctx && tg.some((x) => x.v === `g:${S.ctx}`) ? `g:${S.ctx}` : "me";
  openSheet(`
    <h2>${ev ? "Событие" : "Новое событие"}</h2>
    <div class="field"><label for="f-title">Название</label><input id="f-title" class="in" maxlength="200" placeholder="Например, стоматолог" value="${esc(F.title)}"></div>
    ${tg.length > 1 && !ev ? `<div class="field"><label for="f-owner">Кому / куда</label><select id="f-owner" class="in">${tg.map((o) => `<option value="${esc(o.v)}" ${o.v === pre ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></div>` : ""}
    <div class="sw" data-act="fAll"><span>Весь день</span><span class="tg ${F.all_day ? "on" : ""}" id="f-all"></span></div>
    <div class="field"><label for="f-date">Дата</label><input id="f-date" type="date" class="in num" value="${K(F.s)}"></div>
    <div class="row2" id="f-times" style="${F.all_day ? "display:none" : ""}">
      <div class="field"><label for="f-start">Начало</label><input id="f-start" type="time" class="in num" value="${hm(F.s)}"></div>
      <div class="field"><label for="f-end">Конец</label><input id="f-end" type="time" class="in num" value="${F.e ? hm(F.e) : ""}"></div>
    </div>
    <div class="field"><span class="lbl">Повтор</span><div class="chips" id="f-rep">
      ${[["", "Нет"], ["daily", "Каждый день"], ["weekly", "Неделю"], ["monthly", "Месяц"], ["yearly", "Год"]].map(([v, t]) => {
        const lock = v && !L.repeat; return `<button class="chip ${F.repeat === v ? "on" : ""} ${lock ? "lock" : ""}" data-act="fRep" data-v="${v}">${lock ? "🔒 " : ""}${t}</button>`; }).join("")}
    </div></div>
    <div class="field"><span class="lbl">Напомнить <span class="sub">(до ${L.maxReminders}; по умолчанию — в настройках)</span></span><div class="chips" id="f-rem"></div></div>
    <div class="field"><label for="f-notes">Заметка</label><textarea id="f-notes" class="in" rows="2" maxlength="1000">${esc(F.notes)}</textarea></div>
    <div class="btns"><button class="btn" data-act="fSave">Сохранить</button>${ev ? `<button class="btn danger" data-act="fDel">Удалить</button>` : ""}</div>
    ${ev && ev.repeat ? `<p class="sub" style="text-align:center;margin:12px 0 0">Изменения применятся ко всей серии</p>` : ""}`);
  drawRem();
  if (!ev) setTimeout(() => { const t = $("#f-title"); t && t.focus({ preventScroll: true }); }, 300);
}
function drawRem() {
  const opts = F.all_day ? REM_ALL : REM_TIMED;
  const extra = F.remind.filter((m) => !opts.some((o) => o[0] === m)).map((m) => [m, remLabel(m)]);
  $("#f-rem").innerHTML = [...opts, ...extra].map(([m, t]) => `<button class="chip ${F.remind.includes(m) ? "on" : ""}" data-act="fRem" data-m="${m}">${t}</button>`).join("");
}
function formSave() {
  const title = $("#f-title").value.trim();
  if (!title) { toast("Введите название"); $("#f-title").focus(); return; }
  const [Y, M, D] = $("#f-date").value.split("-").map(Number);
  if (!Y) { toast("Укажите дату"); return; }
  let starts, ends = null;
  if (F.all_day) starts = new Date(Y, M - 1, D, 0, 0);
  else {
    const [sh, sm] = ($("#f-start").value || "09:00").split(":").map(Number);
    starts = new Date(Y, M - 1, D, sh, sm);
    const ev = $("#f-end").value;
    if (ev) { const [eh, em] = ev.split(":").map(Number); const e = new Date(Y, M - 1, D, eh, em); if (e > starts) ends = e; }
  }
  const body = { id: F.id, owner_id: F.owner_id, title, notes: $("#f-notes").value.trim() || null, all_day: F.all_day, starts_at: starts.toISOString(), ends_at: ends && ends.toISOString(), repeat: F.repeat || null, remind: F.remind };
  const t = $("#f-owner") ? $("#f-owner").value : "me";
  if (!F.id) {
    if (t.startsWith("g:")) body.owner_id = Number(t.slice(2));
    else if (t.startsWith("t:")) { const [, g, u] = t.split(":"); body.group_id = Number(g); body.assignee_id = Number(u); }
  }
  const btn = document.querySelector('[data-act="fSave"]'); btn.disabled = true;
  api("save", body).then(async (r) => {
    btn.disabled = false;
    if (r.error) { toast(r.message || "Не удалось сохранить"); if (r.error === "limit" || r.error === "team") setTimeout(openSettings, 900); return; }
    closeSheet(); S.sel = sod(starts); (r.notes || []).forEach((n) => toast(n)); tap(); await load(true);
  }).catch(() => { btn.disabled = false; toast("Нет связи с сервером"); });
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
  openSheet(`
    <h2>Настройки</h2>
    <h3>Тема</h3>
    <div class="themes">${S.themes.map((t) => { const ok = L.themes.includes(t), c = THEMES[t]; return `<div><button class="th ${st.theme === t ? "on" : ""}" style="background:${c[1]}" data-act="theme" data-t="${t}" aria-label="${esc(c[0])}"><b style="background:${c[2]}"></b><i style="background:${c[2]}"></i>${ok ? "" : `<span class="lk">🔒</span>`}</button><div class="th-name">${esc(c[0])}</div></div>`; }).join("")}</div>
    <h3>Скругление углов</h3>
    <input type="range" id="rad" min="0" max="50" step="1" value="${st.radius}" aria-label="Скругление углов">
    <div class="sub" style="display:flex;justify-content:space-between"><span>Острые</span><span>Круглые</span></div>
    <h3>Яркость плиток дней</h3>
    <input type="range" id="dim" min="0" max="30" step="1" value="${st.tile_dim}" aria-label="Яркость плиток">
    <div class="sub" style="display:flex;justify-content:space-between"><span>Скрыты</span><span>Ярче</span></div>
    <div class="prev" id="prev"><div class="tile num">12</div><div class="tile num sel">13</div><div class="tile num today">14</div><div class="tile num">15</div></div>
    <h3>Отметки дней</h3>
    <div class="chips">${[["scribble", "Зигзаг"], ["stroke", "Мазок"], ["dot", "Точка"]].map(([v, t]) => chip(st.mark_style === v, "mstyle", `data-v="${v}"`, t)).join("")}</div>
    <h3>Выбранный день</h3>
    <div class="chips">${[["fill", "Заливка"], ["ring", "Кольцо"]].map(([v, t]) => chip(st.sel_style === v, "sstyle", `data-v="${v}"`, t)).join("")}</div>
    <h3>Неделя начинается с</h3>
    <div class="chips">${chip(st.week_start === 1, "ws", 'data-v="1"', "Понедельника")}${chip(st.week_start === 0, "ws", 'data-v="0"', "Воскресенья")}</div>

    <h3>Напоминания по умолчанию <span class="sub">(до ${L.maxReminders})</span></h3>
    <div class="chips" id="rem-chips">${remAll.map((m) => chip(st.remind.includes(m), "dRem", `data-m="${m}"`, "за " + remLabel(m))).join("")}</div>
    <div class="row3" style="margin-top:10px"><input id="cr-n" class="in num" type="number" min="1" max="999" placeholder="Своё"><select id="cr-u" class="in"><option value="1">мин</option><option value="60">час</option><option value="1440">дн</option></select><button class="btn alt sm" data-act="dRemAdd">Добавить</button></div>
    <div class="row2" style="margin-top:10px;align-items:center"><span class="sub">«Весь день» — напомнить в</span><select id="ah" class="in" data-act="allh">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${st.allday_hour === h ? "selected" : ""}>${pad(h)}:00</option>`).join("")}</select></div>

    <h3>Утро и вечер в чате</h3>
    <div class="kv"><div>Утром: задачи на день<small>бот пришлёт список в выбранное время</small></div><div style="display:flex;gap:6px;align-items:center"><input id="dm" class="in num" type="time" style="width:110px;min-height:40px;padding:8px" value="${st.digest_morning || ""}"><button class="mini alt" data-act="dOff" data-k="digest_morning">Выкл</button></div></div>
    <div class="kv"><div>Вечером: план на завтра<small>напоминание о завтрашних делах</small></div><div style="display:flex;gap:6px;align-items:center"><input id="de" class="in num" type="time" style="width:110px;min-height:40px;padding:8px" value="${st.digest_evening || ""}"><button class="mini alt" data-act="dOff" data-k="digest_evening">Выкл</button></div></div>
    <div class="kv"><div>Присылать, если событий не меньше<small>чтобы не писать в «пустые» дни</small></div><select id="dmin" class="in" style="width:90px;min-height:40px;padding:8px">${[1, 2, 3, 5, 8].map((n) => `<option value="${n}" ${st.digest_min === n ? "selected" : ""}>${n}</option>`).join("")}</select></div>

    <h3>Тариф</h3>
    ${["free", "plus", "pro", "team"].map((k) => planCard(k, p, until)).join("")}
    <h3>Код подписки</h3>
    <div class="row2" style="grid-template-columns:1fr auto"><input id="promo" class="in" placeholder="CAL-XXXX-XXXX" autocapitalize="characters" autocomplete="off"><button class="btn sm" style="width:auto;padding:0 18px" data-act="redeem">Применить</button></div>
    <h3>Подключения</h3>
    ${integrations()}
    ${S.user.is_admin ? `<h3>Владелец</h3><button class="btn alt" data-act="admin">🛠 Админ-панель</button>` : ""}
    <h3>Данные</h3>
    <div class="kv"><div>Удалить мои данные<small>Все события, настройки и подключения</small></div><button class="mini alt" data-act="wipe">Удалить</button></div>
    <p class="sub" style="text-align:center;margin-top:18px">Мы храним только ваш Telegram ID, часовой пояс, настройки и события.</p>`);
}
function planCard(k, cur, until) {
  const P = S.plans[k] || DEMO_PLANS[k], f = { free: ["До 40 активных событий", "1 напоминание", "1 группа", "3 темы"],
    plus: ["События без лимита", "Повторы событий", "До 3 напоминаний", "Все темы", "Подписка для Apple и Google (ICS)", "До 3 групп"],
    pro: ["Всё из Plus", "Синхронизация с Google Календарём", "До 5 напоминаний", "Группы без лимита"],
    team: ["Всё из Pro", "Режим салона: вкладка на каждого сотрудника", "Запись на сотрудника по @нику", "Админ видит записи всех", "Напоминания и в группу, и сотруднику лично"] }[k];
  return `<div class="plan ${cur === k ? "cur" : ""}"><h4><span>${P.title}</span><span class="sub">${k === "free" ? "бесплатно" : `${P.stars.month} ⭐/мес`}</span></h4>
    <ul>${f.map((x) => `<li>${x}</li>`).join("")}</ul>
    ${k === "free" ? (cur === "free" ? `<div class="sub">Ваш тариф</div>` : "") : cur === k ? `<div class="sub" style="margin-bottom:8px">Активен до ${until}</div>` : ""}
    ${k !== "free" ? `<div class="prices"><button data-act="buy" data-p="${k}" data-d="month">${P.stars.month} ⭐ / мес</button><button class="alt" data-act="buy" data-p="${k}" data-d="year">${P.stars.year} ⭐ / год</button></div>` : ""}</div>`;
}
function integrations() {
  const L = S.limits;
  const ics = L.ics && S.ics
    ? `<div class="kv"><div>Apple Календарь / подписка<small>Добавьте ссылку как «Подписной календарь» (iPhone: Настройки → Календарь → Учётные записи → Добавить → Другое). События идут из бота в календарь, обратно — нет.</small><code class="url">${esc(S.ics)}</code></div></div>
       <div class="row2" style="margin-bottom:8px"><button class="btn alt sm" data-act="icsCopy">Скопировать</button><button class="btn alt sm" data-act="icsNew">Новая ссылка</button></div>`
    : `<div class="kv"><div>Apple Календарь / подписка<small>🔒 Тариф Plus и выше</small></div></div>`;
  const g = L.google
    ? (S.user.google
      ? `<div class="kv"><div>Google Календарь<small>Подключён</small></div><div style="display:flex;gap:6px"><button class="mini" data-act="gSync">Синхронизировать</button><button class="mini alt" data-act="gOff">Отключить</button></div></div>`
      : `<div class="kv"><div>Google Календарь<small>Только события, без почты и контактов</small></div><button class="mini" data-act="gOn">Подключить</button></div>`)
    : `<div class="kv"><div>Google Календарь<small>🔒 Тариф Pro и выше</small></div></div>`;
  return ics + g;
}

/* ---------- админ-панель ---------- */
async function openAdmin() {
  openSheet(`<h2>Админ-панель</h2><div class="empty">Загрузка…</div>`);
  const [s, c] = await Promise.all([api("admin_stats"), api("admin_codes")]);
  if (s.error) { openSheet(`<h2>Админ-панель</h2><div class="empty">Нет доступа</div>`); return; }
  const tick = s.last_tick ? Math.round((Date.now() - new Date(s.last_tick).getTime()) / 60000) : null;
  const sched = tick === null ? "⚠️ планировщик не запускался (cron.sql)" : tick <= 3 ? `✅ планировщик работает (${tick} мин назад)` : `⚠️ планировщик молчит ${tick} мин`;
  openSheet(`<h2>Админ-панель</h2>
    <div class="stat"><div><b>${s.users}</b><span>пользователей</span></div><div><b>${s.paid}</b><span>с тарифом</span></div><div><b>${s.groups}</b><span>групп</span></div></div>
    <div class="stat"><div><b>${s.events}</b><span>событий</span></div><div><b>${s.stars}</b><span>⭐ получено</span></div><div><b>${s.codes}</b><span>кодов</span></div></div>
    <p class="sub">${sched}</p>
    <h3>Создать коды подписки</h3>
    <div class="row2"><div class="field"><label>Тариф</label><select id="ac-plan" class="in"><option value="plus">Plus</option><option value="pro" selected>Pro</option><option value="team">Team</option></select></div>
    <div class="field"><label>Дней</label><input id="ac-days" class="in num" type="number" value="30" min="1" max="3650"></div></div>
    <div class="row2"><div class="field"><label>Использований на код</label><input id="ac-uses" class="in num" type="number" value="1" min="1"></div>
    <div class="field"><label>Сколько кодов</label><input id="ac-count" class="in num" type="number" value="1" min="1" max="100"></div></div>
    <div class="field"><label>Заметка (кому / зачем)</label><input id="ac-note" class="in" maxlength="100" placeholder="например, салон «Роза»"></div>
    <button class="btn" data-act="acCreate">Создать</button><div id="ac-out"></div>
    <h3>Выдать тариф по Telegram ID</h3>
    <div class="row3"><input id="ag-id" class="in num" type="number" placeholder="ID"><select id="ag-plan" class="in"><option value="plus">Plus</option><option value="pro">Pro</option><option value="team">Team</option><option value="free">Free</option></select><input id="ag-days" class="in num" type="number" value="30"></div>
    <button class="btn alt" style="margin-top:8px" data-act="agGrant">Выдать</button>
    <h3>Последние коды</h3>
    ${(c.codes || []).map((x) => `<div class="crow ${x.revoked ? "off" : ""}"><div><code>${esc(x.code)}</code><br><span class="sub">${esc(x.plan)} · ${x.days} дн. · ${x.used_count}/${x.max_uses}${x.note ? " · " + esc(x.note) : ""}</span></div>${x.revoked ? "" : `<button class="mini alt" data-act="acRevoke" data-c="${esc(x.code)}">Отозвать</button>`}</div>`).join("") || `<div class="empty">Кодов пока нет</div>`}
    <p class="sub" style="margin-top:12px">Пользователь вводит код в Настройках → «Код подписки» или командой /code КОД в боте.</p>`);
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
    case "view": S.view = el.dataset.v; tap(); S.user.settings.view = S.view; api("settings", { view: S.view }).catch(() => {}); return render();
    case "day": { const [y, m, d] = el.dataset.k.split("-").map(Number); S.sel = new Date(y, m - 1, d); tap(); return load(); }
    case "scope": S.scope = el.dataset.t === "u" ? { t: "u", id: Number(el.dataset.id) } : { t: el.dataset.t }; tap(); return load(true, true);
    case "add": return openForm(null);
    case "addAt": return openForm(null, Number(el.dataset.h));
    case "edit": { const ev = S.events.find((x) => x.id === el.dataset.id); if (ev) openForm(ev); return; }
    case "close": return closeSheet();
    case "help": return openHelp();
    case "copy": return copy(el.dataset.t, "Пример скопирован");
    case "settings": return openSettings();
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
    case "fSave": return formSave();
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
      const n = Number($("#cr-n").value), u = Number($("#cr-u").value), m = Math.round(n * u);
      if (!n || m < 1 || m > 43200) { toast("Введите число и единицы (до 30 дней)"); return; }
      const cur = S.user.settings.remind;
      if (cur.includes(m)) return toast("Такое уже есть");
      if (cur.length + 1 > S.limits.maxReminders) { toast(`В вашем тарифе до ${S.limits.maxReminders} напоминаний`); return; }
      return reloadRem({ remind: [...cur, m].sort((x, y) => x - y) });
    }
    case "dOff": { const k = el.dataset.k; await saveSetting({ [k]: null }); return openSettings(); }
    case "buy": {
      const r = await api("invoice", { plan: el.dataset.p, period: el.dataset.d });
      if (!r.url) return toast(r.message || "Оплата недоступна");
      if (TG && TG.openInvoice) TG.openInvoice(r.url, (s) => { if (s === "paid") { toast("Спасибо! Тариф активируется ✨"); setTimeout(async () => { await init(true); openSettings(); }, 1500); } });
      else window.open(r.url, "_blank");
      return;
    }
    case "redeem": {
      const code = ($("#promo").value || "").trim(); if (!code) return toast("Введите код");
      const r = await api("redeem", { code });
      if (r.error) return toast(r.message || "Код не подошёл");
      toast("Код принят 🎁"); await init(true); return openSettings();
    }
    case "icsCopy": return copy(S.ics, "Ссылка скопирована");
    case "icsNew": if (await ask("Старая ссылка перестанет работать. Создать новую?")) { const r = await api("ics_rotate"); S.ics = r.ics; openSettings(); } return;
    case "gOn": { const r = await api("google_url"); if (!r.url) return toast(r.message || "Недоступно"); TG && TG.openLink ? TG.openLink(r.url) : window.open(r.url, "_blank"); return toast("Подтвердите доступ в браузере и вернитесь сюда"); }
    case "gSync": { toast("Синхронизирую…"); const r = await api("google_sync"); toast(r.error ? "Не получилось. Подключите заново" : `Готово: получено ${r.pulled}, отправлено ${r.pushed}`); await load(true); return; }
    case "gOff": if (await ask("Отключить Google Календарь?")) { await api("google_disconnect"); S.user.google = false; openSettings(); } return;
    case "wipe": if (await ask("Удалить все ваши данные? Это нельзя отменить.")) { const r = await api("delete_me", { confirm: "DELETE" }); if (r.ok) { toast("Данные удалены"); setTimeout(() => TG && TG.close && TG.close(), 1200); } } return;

    case "admin": return openAdmin();
    case "acCreate": {
      const r = await api("admin_create", { plan: $("#ac-plan").value, days: $("#ac-days").value, uses: $("#ac-uses").value, count: $("#ac-count").value, note: $("#ac-note").value });
      if (!r.codes || !r.codes.length) return toast("Не удалось создать (выполнена ли миграция 002?)");
      $("#ac-out").innerHTML = `<pre class="codes">${r.codes.join("\n")}</pre><button class="btn alt sm" data-act="copy" data-t="${r.codes.join("\n")}">Скопировать все</button>`;
      return;
    }
    case "acRevoke": if (await ask("Отозвать код?")) { await api("admin_revoke", { code: el.dataset.c }); openAdmin(); } return;
    case "agGrant": { const r = await api("admin_grant", { user_id: $("#ag-id").value, plan: $("#ag-plan").value, days: $("#ag-days").value }); return toast(r.ok ? "Тариф выдан" : "Проверьте ID и тариф"); }
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "rad") document.documentElement.style.setProperty("--rn", e.target.value);
  if (e.target.id === "dim") document.documentElement.style.setProperty("--td", e.target.value);
});
document.addEventListener("change", async (e) => {
  const id = e.target.id;
  if (id === "rad") await saveSetting({ radius: Number(e.target.value) });
  else if (id === "dim") await saveSetting({ tile_dim: Number(e.target.value) });
  else if (id === "ah") await saveSetting({ allday_hour: Number(e.target.value) });
  else if (id === "dm") await saveSetting({ digest_morning: e.target.value || null });
  else if (id === "de") await saveSetting({ digest_evening: e.target.value || null });
  else if (id === "dmin") await saveSetting({ digest_min: Number(e.target.value) });
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

// Возврат в приложение: тихо обновляем события, ничего не перерисовывая «с нуля»
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (!DEMO && S.ready && Date.now() - hiddenAt > 30000 && !$("#sheet").classList.contains("open")) { init(true); }
});
// Страховка от «пустого» календаря: если ширина области изменилась (окно Telegram раскрылось), перерисовываем
let lastW = 0;
if (window.ResizeObserver) new ResizeObserver(() => { const w = $("#main").clientWidth; if (Math.abs(w - lastW) > 2) { lastW = w; if (S.ready || true) render(true); } }).observe($("#main"));

/* ============================ СТАРТ ============================ */
if (TG) { try { TG.ready(); TG.expand(); TG.disableVerticalSwipes && TG.disableVerticalSwipes(); } catch (e) {} }
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
