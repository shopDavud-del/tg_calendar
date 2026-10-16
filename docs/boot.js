/* Применяет сохранённую тему ДО первой отрисовки, чтобы не мигал стандартный дизайн */
(function () {
  try {
    var u = JSON.parse(localStorage.getItem("ui") || "{}"), r = document.documentElement;
    if (u.theme) r.dataset.theme = u.theme;
    if (u.radius != null) r.style.setProperty("--rn", u.radius);
    if (u.dim != null) r.style.setProperty("--td", u.dim);
    if (u.done) r.dataset.done = u.done;
    if (u.lang) r.lang = u.lang;
  } catch (e) {}
})();
