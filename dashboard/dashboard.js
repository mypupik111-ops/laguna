"use strict";

const $ = (id) => document.getElementById(id);
const desktop = {
  result: [0, 0, 8, 2], cash: [8, 0, 4, 1], revenue: [8, 1, 4, 1],
  costs: [0, 2, 4, 1], scenarios: [4, 2, 4, 1], checks: [8, 2, 4, 1],
  decision: [0, 3, 12, 1],
};
const mobile = {
  result: [0, 0, 6, 2], cash: [0, 2, 3, 1], revenue: [3, 2, 3, 1],
  costs: [0, 3, 3, 1], scenarios: [3, 3, 3, 1], checks: [0, 4, 6, 1],
  decision: [0, 5, 6, 1],
};
const canvasDesktop = {
  result: [0, 0, 8, 2],
  cash: [0, 2.5, 4, 1],
  scenarios: [4, 2.5, 4, 1],
  costs: [0, 3.5, 4, 1],
  decision: [4, 3.5, 4, 1],
  checks: [8, .5, 3.5, 1],
  revenue: [8, 1.5, 3.5, 1],
};
const canvasMobile = {
  result: [0, 0, 6, 2], cash: [.5, 2, 5.5, 1], scenarios: [.5, 3, 5.5, 1],
  costs: [0, 4, 3, 1], decision: [3, 4, 3, 1],
  revenue: [0, 5, 3, 1], checks: [3, 5, 3, 1],
};
const media = matchMedia("(max-width: 700px)");
const board = $("board");
const viewport = $("canvas-viewport");
const ghost = $("ghost");
const embed = new URLSearchParams(location.search).get("embed");
const embedded = window.parent !== window && ["sea", "lagoon"].includes(embed);
const depthWater = $("depth-water");
if (embedded && embed === "sea") document.documentElement.classList.add("embedded-desk");
if (embedded && embed === "lagoon") document.documentElement.classList.add("lagoon-desk");
function notifySea(type, fields = {}) {
  if (embedded) parent.postMessage({ channel: "decision-sea-desk", type, ...fields }, "*");
}
const connections = createConnections(board, $("connections"));
const depthNames = ["operations", "rules", "method", "values"];
const depthCards = Object.fromEntries(depthNames.map(depth => {
  const source = depth === "operations" ? board : $("depth-" + depth).content;
  return [depth, Object.fromEntries([...source.querySelectorAll(".card")].map(card => [card.id, card]))];
}));
let activeDepth = "operations";
let cards = depthCards.operations;
let ids = Object.keys(cards);
const defaults = { ...window.orderData };
const fields = {
  units: "Футболки, шт.", revenue: "Сумма заказа, ₽", advance: "Аванс, ₽",
  fabric: "Ткань на партию, ₽", sewing: "Пошив за штуку, ₽", cutting: "Раскрой за штуку, ₽",
  print: "Печать за штуку, ₽", equipment: "Пресс, ₽", shipping: "Доставка пресса, ₽",
  outsourcing: "Доплата за нанесение на стороне, ₽", resale: "Чистая выручка от продажи пресса, ₽",
  other: "Прочие затраты заказа, ₽",
};
const moneyFormat = new Intl.NumberFormat("ru-RU", {
  style: "currency", currency: "RUB", maximumFractionDigits: 0,
});
const money = (cents) => moneyFormat.format(cents / 100);
const exactMoneyFormat = new Intl.NumberFormat("ru-RU", {
  style: "currency", currency: "RUB", minimumFractionDigits: 2,
});
let view = load("koltushi.view", "canvas") === "bento" ? "bento" : "canvas";
const subdivisions = () => view === "canvas" ? 2 : 1;
const cols = () => (media.matches ? 6 : 12) * subdivisions();
const canvasMargin = { x: 48, y: 40 };
const canvasRows = 100;
const canvasCols = () => cols() + 2 * canvasMargin.x;
const layoutKey = (depth = activeDepth, mode = view) => {
  if (depth !== "operations") return "koltushi.depth." + depth + "." + (media.matches ? "mobile" : "desktop");
  return mode === "bento" ? "koltushi.layout.v2." + cols() : "koltushi.canvas.v6." + cols();
};
const dataKey = "koltushi.data.v1." + JSON.stringify(defaults);
function initialLayout(depth = activeDepth, mode = view) {
  const narrow = media.matches;
  const unit = mode === "canvas" ? 2 : 1;
  if (depth === "operations") {
    const base = mode === "canvas" ? (narrow ? canvasMobile : canvasDesktop) : (narrow ? mobile : desktop);
    return Object.fromEntries(Object.entries(base).map(([id, rect]) => [id, rect.map(value => value * unit)]));
  }
  const rectangles = narrow ? [[0, 0, 6, 2.5], [0, 3, 3, 2], [3, 3, 3, 2]]
    : [[0, 0, 7.5, 3], [8.5, 0, 3.5, 1.5], [8.5, 2, 3.5, 1.5]];
  return Object.fromEntries(Object.keys(depthCards[depth]).map((id, i) => [id, rectangles[i].map(value => value * unit)]));
}

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* The board remains usable if storage is unavailable. */ }
}
const validData = (data) => data && Object.keys(fields).every((key) =>
  Number.isSafeInteger(data[key]) && data[key] >= 0 &&
  data[key] <= (key === "units" ? 100000 : 10000000000)) && data.units > 0 && data.advance <= data.revenue;
let data = load(dataKey, defaults);
if (!validData(data)) data = defaults;
let includeAdvance = true;

function calculate() {
  const sewing = data.sewing * data.units;
  const cutting = data.cutting * data.units;
  const print = data.print * data.units;
  const orderCost = data.fabric + sewing + cutting + print + data.other;
  const pressCost = data.equipment + data.shipping;
  const remainder = data.revenue - orderCost - pressCost;
  const usedAdvance = includeAdvance ? data.advance : 0;
  const cash = Math.max(0, orderCost + pressCost - usedAdvance);
  const extra = pressCost - data.outsourcing;
  return { sewing, cutting, print, orderCost, pressCost, remainder, cash, extra, usedAdvance };
}

function renderNumbers(animate = false) {
  const { cash, orderCost, pressCost, extra } = calculate();
  const values = {
    "cash-value": money(cash),
    "revenue-value": money(data.revenue), "cost-value": money(orderCost),
    "comparison-value": money(Math.abs(extra)), "press-value": money(pressCost),
  };
  for (const [id, value] of Object.entries(values)) {
    const element = $(id);
    if (element.textContent === value) continue;
    element.textContent = value;
    if (animate && !reducedMotion.matches) element.animate([
      { backgroundColor: "#c18e4566" }, { backgroundColor: "transparent" },
    ], { duration: 650, easing: "ease-out" });
  }
  $("cash-explanation").textContent = includeAdvance
    ? "Если аванс пришёл. Без него — " + money(orderCost + pressCost) + "."
    : "Сценарий без поступившего аванса.";
  $("comparison-note").textContent = extra > 0 ? "Доплата за покупку вместо подряда."
    : extra < 0 ? "Экономия до затрат на своё нанесение." : "Покупка и подряд равны до затрат на своё нанесение.";
  $("hero-economics").textContent = extra > 0
    ? "По выгоде. На этой партии подряд требует меньше денег."
    : "По выгоде. Уточни стоимость своего нанесения.";
  const plural = { one: "футболка", few: "футболки", many: "футболок" };
  const unit = plural[new Intl.PluralRules("ru").select(data.units)] ?? plural.many;
  $("units-label").textContent = data.units.toLocaleString("ru-RU") + " " + unit;
}

function detailRows(entries) {
  const list = document.createElement("dl");
  list.className = "rows";
  for (const [name, amount] of entries) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = name;
    value.textContent = amount % 100 ? exactMoneyFormat.format(amount / 100) : money(amount);
    row.append(term, value);
    list.append(row);
  }
  return list;
}

const detailButtons = {};
const detailPanels = {};
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let expanded = new Set();
let activeBranch = null;
let detailScroll = null;
let detailPositions = new Map();
let detailDrag = null;

function renderDetail(id) {
  if (activeDepth !== "operations") {
    const content = cards[id].querySelector(".depth-detail").content;
    detailPanels[id].replaceChildren(content.cloneNode(true));
    return;
  }
  const { sewing, cutting, print, orderCost, pressCost, remainder, cash, extra, usedAdvance } = calculate();
  const note = document.createElement("p");
  note.className = "quiet detail-note";
  const details = {
    result: [[["Нужно до доплаты при полученном авансе", Math.max(0, orderCost + pressCost - data.advance)],
      ["Нужно до доплаты без аванса", orderCost + pressCost]],
    "С Верой сначала сверить свободный остаток цеха, аванс и платежи до доплаты. Затем уточнить цену подряда и своего нанесения. К покупке стоит вернуться, если хватает денег до доплаты, а экономия на следующих партиях или реалистичная перепродажа покрывает разницу."],
    cash: [[["Затраты на партию", orderCost], ["Пресс и доставка", pressCost],
      ["Аванс в расчёте", usedAdvance ? -usedAdvance : 0], ["Нужно до доплаты", cash]],
    "Статус аванса требует сверки с выпиской. Расчёт предполагает, что все указанные расходы предстоят до доплаты. Свободные деньги цеха, обязательства, налоги и логистика пока не подтверждены."],
    revenue: [[["Сумма заказа", data.revenue], ["Предполагаемый аванс", data.advance],
      ["Остаток к оплате", data.revenue - data.advance]],
    "Сумма заказа, поступление аванса и дата доплаты требуют сверки с документами."],
    costs: [[["Ткань", data.fabric], ["Пошив", sewing], ["Раскрой", cutting], ["Печать", print],
      ...(data.other ? [["Прочее", data.other]] : []), ["Всего", orderCost]],
    "Пошив, раскрой и печать рассчитаны на " + data.units.toLocaleString("ru-RU") + " шт. Если печать подорожает на 10 ₽ за штуку, остаток уменьшится на " + money(1000 * data.units) + "."],
    scenarios: [[["Подряд, только нанесение", data.outsourcing], ["Пресс с доставкой", pressCost],
      ["Остаток после оплаты с прессом", remainder], ["Остаток с подрядом", data.revenue - orderCost - data.outsourcing],
      ["Порог чистой перепродажи при нулевой цене своего нанесения", Math.max(0, extra)],
      ["Сценарий чистой перепродажи", data.resale],
      ["Разница с подрядом после перепродажи, до своего нанесения", data.resale - extra]],
    "Печать считается одинаковой. Уточни, входит ли печать в цену подряда. Остатки указаны после полной оплаты до налогов и неучтённых расходов. Из разницы после перепродажи вычти своё нанесение. Цена и срок продажи пока неизвестны."
      + (data.outsourcing > 0 && pressCost > 0 ? " Без перепродажи потребуется не менее "
        + Math.ceil(pressCost / data.outsourcing) + " таких партий при той же ставке подряда и нулевых затратах на своё нанесение." : "")],
    decision: [[["Цена пресса", data.equipment], ["Доставка пресса", data.shipping], ["Всего", pressCost]],
    "Рабочие оценки для б/у Xinhong EasyTrans B2‑4. Перед покупкой подтвердить цену, доставку и работу обоих столов."],
  };
  const body = detailPanels[id];
  if (id === "checks") {
    const context = document.createElement("p");
    context.className = "quiet detail-note";
    context.textContent = "По вводным Кости раскрой считается отдельно от пошива. Тарифы, цена заказа и аванс пока требуют сверки.";
    const list = document.createElement("ul");
    list.className = "checklist";
    for (const text of ["По счёту — подтвердить сумму и дату доплаты.",
      "По выписке — проверить аванс и что уже оплачено.",
      "У Веры — уточнить ставки раскроя, пошива и печати.",
      "Добавить доставку ткани и партии, налоги и затраты на своё нанесение."]) {
      const item = document.createElement("li");
      item.textContent = text;
      list.append(item);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Открыть вводные";
    button.addEventListener("click", openInputs);
    body.replaceChildren(context, list, button);
  } else {
    const [entries, caption] = details[id];
    note.textContent = caption;
    const rows = detailRows(entries);
    if (id === "result") {
      rows.children[includeAdvance ? 0 : 1].classList.add("current-scenario");
      const status = document.createElement("p");
      status.className = "quiet detail-note";
      status.textContent = "В расчёте сейчас " + (includeAdvance ? "сценарий с авансом." : "сценарий без аванса.");
      body.replaceChildren(rows, status, note);
    } else if (id === "cash") {
      rows.lastElementChild.classList.add("current-scenario");
      body.replaceChildren(advanceControl(), rows, note);
    } else body.replaceChildren(rows, note);
  }
}

function advanceControl() {
  const label = document.createElement("label");
  label.className = "advance-option";
  label.textContent = "Сценарий для аванса " + money(data.advance);
  const select = document.createElement("select");
  select.id = "advance-scenario";
  select.add(new Option("Считаем полученным", "received"));
  select.add(new Option("Ещё не поступил", "pending"));
  select.value = includeAdvance ? "received" : "pending";
  select.addEventListener("change", () => {
    includeAdvance = select.value === "received";
    renderNumbers(true);
    for (const key of ["cash", "result"]) {
      if (!expanded.has(key)) continue;
      const top = detailPanels[key].scrollTop;
      renderDetail(key);
      detailPanels[key].scrollTop = top;
    }
    $("advance-scenario").focus({ preventScroll: true });
    setBranch("cash", true);
    $("announcement").textContent = "До доплаты нужно " + money(calculate().cash) + ".";
  });
  label.append(select);
  return label;
}

function setBranch(id, changed = false) {
  activeBranch = id;
  const { upstream, downstream } = connections.setFocus(id, changed);
  viewport.classList.toggle("branch-active", Boolean(id));
  document.documentElement.classList.toggle("branch-dimmed", Boolean(id));
  for (const key of ids) {
    if (!id) delete cards[key].dataset.branch;
    else cards[key].dataset.branch = key === id ? "selected"
      : upstream.has(key) ? "upstream" : downstream.has(key) ? "downstream" : "muted";
  }
}

function overlaps([x, y, w, h], [a, b, c, d]) {
  return x < a + c && a < x + w && y < b + d && b < y + h;
}
function loadLayout(depth = activeDepth, mode = view) {
  const result = load(layoutKey(depth, mode), initialLayout(depth, mode));
  const keys = Object.keys(depthCards[depth]);
  const canvas = mode === "canvas";
  const unit = canvas ? 2 : 1;
  const columns = (media.matches ? 6 : 12) * unit;
  if (depth === "operations" && result && !result.decision && !canvas) {
    const bottom = Math.max(...ids.filter((id) => id !== "decision").map((id) => {
      const rect = result[id];
      return Array.isArray(rect) ? rect[1] + rect[3] : 0;
    }));
    result.decision = [0, bottom, cols(), 1];
  }
  const valid = result && keys.every((id, i) => {
    const rect = result[id];
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isInteger)) return false;
    const [x, y, w, h] = rect;
    return x >= (canvas ? -canvasMargin.x : 0) && x + w <= columns + (canvas ? canvasMargin.x : 0)
      && y >= (canvas ? -canvasMargin.y : 0) && (canvas ? y + h <= canvasRows - canvasMargin.y : y <= 100 * unit)
      && w >= 3 * unit && h >= unit && h <= 4 * unit &&
      keys.slice(0, i).every((other) => !overlaps(rect, result[other]));
  });
  return valid ? result : initialLayout(depth, mode);
}
let layout = loadLayout();
let editing = false;
let gesture = null;
const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
let zoom = 1;
let fittedZoom = 1;
let pan = null;
let panMoved = false;
let spaceHeld = false;
let canvasStep = 0;
let visibleLayout = layout;
let dragFrame = 0;
const boardScale = () => view === "canvas" ? zoom : 1;
const depthTabs = [...document.querySelectorAll(".depth-nav button")];
const depthStates = new Map();
const depthPreview = $("depth-preview");
const levels = ["sea", ...depthNames];

function canvasMetrics() {
  const style = getComputedStyle(document.documentElement);
  const gap = parseFloat(style.getPropertyValue("--canvas-gap"));
  const side = parseFloat(style.getPropertyValue("--canvas-side"));
  const top = parseFloat(style.getPropertyValue("--canvas-top"));
  const rowStep = parseFloat(style.getPropertyValue("--canvas-row")) + gap;
  const columns = (media.matches ? 6 : 12) * 2;
  const step = (Math.max(280, viewport.clientWidth - 2 * side) + gap) / columns;
  return { gap, side, top, rowStep, step };
}

function fitPosition(rects, metrics, allowShrink = true) {
  const { gap, side, rowStep, step } = metrics;
  const left = Math.min(...rects.map(([x]) => x));
  const top = Math.min(...rects.map(([, y]) => y));
  const right = Math.max(...rects.map(([x, , w]) => x + w));
  const bottom = Math.max(...rects.map(([, y, , h]) => y + h));
  const scale = Math.min(1, (viewport.clientWidth - 2 * side) / ((right - left) * step - gap),
    (viewport.clientHeight - 42) / ((bottom - top) * rowStep - gap));
  const zoom = clamp(allowShrink ? scale : Math.max(.85, scale), .35, 2);
  return { zoom, left: (left + canvasMargin.x) * step * zoom, top: (top + canvasMargin.y) * rowStep * zoom };
}

function projectDepth(depth) {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (depth === "sea") {
    const surfaceWidth = document.documentElement.clientWidth;
    const surfaceTop = surfaceWidth <= 540 ? 88 : 55;
    const surfaceHeight = Math.max(410, window.innerHeight - surfaceTop) - 2;
    const world = seaSurfaceGeometry(surfaceWidth, surfaceHeight);
    const zoom = depthZoomRange.min;
    const cardSize = surfaceCardSize(zoom);
    const frame = viewport.getBoundingClientRect();
    const originX = (surfaceWidth - world.width * zoom) / 2 - frame.left;
    const originY = surfaceTop + 1 + (surfaceHeight - world.height * zoom) / 2 - frame.top;
    return { scale: 1, boxes: [[
      originX + world.marker.x * zoom - world.cardWidth * cardSize / 2,
      originY + world.marker.y * zoom - 58 * cardSize,
      world.cardWidth * cardSize, 116 * cardSize,
    ]] };
  }
  const prior = depthStates.get(depth);
  const restored = prior?.projection;
  if (restored?.width === width && restored.height === height) {
    return { scale: prior.view === "canvas" ? prior.zoom : 1, boxes: restored.boxes };
  }
  const rects = Object.values(loadLayout(depth, "canvas"));
  const metrics = canvasMetrics();
  const { gap, side, rowStep, step } = metrics;
  const camera = fitPosition(rects, metrics);
  const boxes = rects.map(([x, y, w, h]) => [
    side + (x + canvasMargin.x) * step * camera.zoom - camera.left,
    metrics.top + (y + canvasMargin.y) * rowStep * camera.zoom - camera.top,
    (w * step - gap) * camera.zoom, (h * rowStep - gap) * camera.zoom,
  ]);
  return { scale: camera.zoom, boxes };
}

function renderDepthPreview(next = depthNames[depthNames.indexOf(activeDepth) + 1]) {
  depthPreview.hidden = !next;
  if (!next) {
    depthPreview.replaceChildren();
    return;
  }
  depthPreview.dataset.layer = next;
  const plane = document.createElement("div");
  plane.className = "depth-preview-plane";
  plane.dataset.depth = next;
  if (depthStates.get(next)?.expanded.size) plane.classList.add("inline-details");
  plane.style.width = viewport.clientWidth + "px";
  plane.style.height = viewport.clientHeight + "px";
  const { scale, boxes } = projectDepth(next);
  const source = next === "sea" ? [] : Object.values(depthCards[next]);
  plane.append(...boxes.map(([x, y, w, h], index) => {
    const card = source[index]?.cloneNode(true) ?? document.createElement("div");
    if (next === "sea") {
      card.className = "card surface-preview";
      card.innerHTML = '<span class="quiet">Вопрос</span><strong>Колтуши</strong><span class="quiet">Покупать ли термопресс?</span>';
    }
    card.dataset.previewCard = source[index]?.id ?? "op.press";
    card.removeAttribute("id");
    for (const element of card.querySelectorAll("[id]")) element.removeAttribute("id");
    card.inert = true;
    card.removeAttribute("style");
    card.style.zoom = scale;
    card.style.insetInlineStart = x / scale + "px";
    card.style.top = y / scale + "px";
    card.style.width = w / scale + "px";
    card.style.height = h / scale + "px";
    return card;
  }));
  depthPreview.replaceChildren(plane);
}

function setDepth(depth, gestureTransition = false) {
  if (depth === activeDepth) return;
  deskWheelZoom.cancel();
  const previousDepth = activeDepth;
  finish(false);
  finishDetailDrag(false);
  if (editing) setEditing(false);
  setSpace(false);
  if (pan && viewport.hasPointerCapture(pan.id)) viewport.releasePointerCapture(pan.id);
  const frame = viewport.getBoundingClientRect();
  const projection = { width: viewport.clientWidth, height: viewport.clientHeight, boxes: ids.map(id => {
    const rect = cards[id].getBoundingClientRect();
    return [rect.x - frame.x, rect.y - frame.y, rect.width, rect.height];
  }) };
  depthStates.set(activeDepth, { view, zoom, fittedZoom, expanded, detailPositions, detailScroll, activeBranch, projection,
    scroll: [viewport.scrollLeft, viewport.scrollTop, window.scrollY] });
  for (const card of Object.values(cards)) {
    for (const animation of card.getAnimations()) {
      if (animation.id === "window-layout") animation.cancel();
    }
    card.remove();
  }
  for (const animation of board.getAnimations()) {
    if (animation.id === "depth-reveal") animation.cancel();
  }

  activeDepth = depth;
  const operations = depth === "operations";
  const state = depthStates.get(depth);
  cards = depthCards[depth];
  ids = Object.keys(cards);
  view = state?.view ?? "canvas";
  zoom = state?.zoom ?? 1;
  fittedZoom = state?.fittedZoom ?? 1;
  expanded = state?.expanded ?? new Set();
  detailPositions = state?.detailPositions ?? new Map();
  detailScroll = state?.detailScroll ?? null;
  board.classList.remove("inline-details");
  ghost.before(...Object.values(cards));
  connections.setEdges(operations ? undefined : ids.slice(1).map(id => [id, ids[0]]));
  document.documentElement.dataset.depth = depth;
  notifySea("layer", { depth });
  $("view-canvas").parentElement.hidden = !operations;
  $("inputs").hidden = !operations;
  $("edit").disabled = expanded.size > 0;
  for (const tab of depthTabs) {
    if (tab.dataset.dive === depth) tab.setAttribute("aria-current", "true");
    else tab.removeAttribute("aria-current");
  }
  setBranch(state?.activeBranch ?? null);
  layout = loadLayout();
  renderView();
  renderLayout(layout);
  if (state) {
    const [left, top, pageTop] = state.scroll;
    viewport.scrollTo(left, top);
    window.scrollTo(0, pageTop);
    if (expanded.size) placeDetails();
  } else fitCanvas();
  updateZoomControls();
  renderDepthPreview();
  connections.followLayout([]);
  if (!reducedMotion.matches) {
    if (!gestureTransition) {
      depthWater.dataset.tint = previousDepth;
      depthWater.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease-out" });
    }
    const reveal = board.animate([
      { opacity: .86 }, { opacity: 1 },
    ], { duration: 180, easing: "ease-out" });
    reveal.id = "depth-reveal";
  }
}

for (const button of depthTabs) {
  button.addEventListener("click", () => {
    resetDepthWheel();
    setDepth(button.dataset.dive);
  });
}

const deskWheelZoom = createWheelZoom({
  read: () => zoom,
  base: () => fittedZoom,
  apply(value, anchor) {
    const frame = viewport.getBoundingClientRect();
    setZoom(value, anchor.x - frame.left, anchor.y - frame.top, false);
  },
  finish() {
    if (expanded.size) placeDetails();
    connections.refresh();
  },
});
const resetDepthWheel = bindDepthWheel(viewport, {
  getLayer: () => levels.indexOf(activeDepth),
  count: levels.length,
  magnify(distance, event) {
    if (view !== "canvas") return true;
    return deskWheelZoom.move(distance, event);
  },
  preview(index, progress) {
    const target = index === null ? levels[levels.indexOf(activeDepth) + 1] : levels[index];
    if (depthPreview.hidden === Boolean(target) || (target && depthPreview.dataset.layer !== target)) {
      renderDepthPreview(target);
    }
    viewport.style.setProperty("--dive-progress", progress);
    viewport.classList.toggle("depth-gesture", index !== null);
    viewport.classList.toggle("depth-surface", embedded && index === 0);
    depthWater.getAnimations().forEach(animation => animation.cancel());
    viewport.style.setProperty("--water-height", viewport.clientHeight + "px");
    depthWater.dataset.tint = target ?? activeDepth;
    depthWater.style.opacity = index === null ? 0 : progress;
    if (embedded && activeDepth === "operations" && (index === 0 || index === null)) {
      notifySea("surface-progress", { progress: index === 0 ? progress : 0 });
    }
  },
  navigate(index) {
    if (levels[index] === "sea") {
      if (embedded) notifySea("surface");
      else location.assign("../sea/index.html");
      return false;
    }
    viewport.classList.remove("depth-gesture");
    setDepth(levels[index], true);
  },
});

if (embedded) {
  window.addEventListener("message", event => {
    if (event.source !== parent || event.data?.channel !== "decision-sea-host") return;
    if (event.data.type === "prepare") {
      resetDepthWheel();
      setDepth("operations");
      if (view === "canvas") fitCanvas();
      requestAnimationFrame(() => requestAnimationFrame(() => notifySea("prepared")));
      return;
    }
    if (event.data.type === "layer" && depthNames.includes(event.data.depth)) {
      resetDepthWheel();
      setDepth(event.data.depth);
    }
  });
  document.querySelector(".sea-entry").addEventListener("click", event => {
    event.preventDefault();
    notifySea("surface");
  });
}

function sizeCanvas() {
  if (viewport.hidden) return;
  if (view !== "canvas") {
    if (expanded.size) placeDetails();
    return;
  }
  const { gap, step, rowStep } = canvasMetrics();
  const previous = canvasStep;
  canvasStep = step;
  board.style.width = canvasStep * canvasCols() - gap + "px";
  board.style.setProperty("--canvas-columns", canvasCols());
  board.style.minHeight = (rowStep * canvasRows - gap) + "px";
  if (previous && previous !== canvasStep) viewport.scrollLeft *= canvasStep / previous;
  if (expanded.size) placeDetails();
  connections.refresh();
}

function fitCanvas(allowShrink = true) {
  deskWheelZoom.cancel();
  const fit = fitPosition(Object.values(visibleLayout), canvasMetrics(), allowShrink);
  fittedZoom = fit.zoom;
  setZoom(fit.zoom, 0, 0);
  viewport.scrollTo(fit.left, fit.top);
  if (expanded.size) placeDetails();
}

function setZoom(value, anchorX = viewport.clientWidth / 2, anchorY = viewport.clientHeight / 2, redraw = true) {
  const previous = zoom;
  const origin = board.getBoundingClientRect();
  const frame = viewport.getBoundingClientRect();
  const x = (frame.left + anchorX - origin.left) / previous;
  const y = (frame.top + anchorY - origin.top) / previous;
  zoom = clamp(value, fittedZoom * depthZoomRange.min, fittedZoom * depthZoomRange.max);
  board.style.zoom = zoom;
  const next = board.getBoundingClientRect();
  viewport.scrollLeft += next.left + x * zoom - frame.left - anchorX;
  viewport.scrollTop += next.top + y * zoom - frame.top - anchorY;
  updateZoomControls();
  if (redraw) {
    if (expanded.size) placeDetails();
    connections.refresh();
  }
}

function updateZoomControls() {
  const relative = zoom / fittedZoom;
  $("zoom-level").textContent = zoomPercent(relative);
  $("zoom-out").disabled = relative <= depthZoomRange.min;
  $("zoom-in").disabled = relative >= depthZoomRange.max;
}

$("zoom-out").addEventListener("click", () => {
  deskWheelZoom.cancel();
  setZoom(zoom - .15);
});
$("zoom-in").addEventListener("click", () => {
  deskWheelZoom.cancel();
  setZoom(zoom + .15);
});
$("zoom-fit").addEventListener("click", () => fitCanvas());
function setSpace(held) {
  spaceHeld = held;
  viewport.classList.toggle("space-pan", held);
}
window.addEventListener("keydown", (event) => {
  if (viewport.hidden || view !== "canvas" || event.code !== "Space" || event.altKey || event.ctrlKey || event.metaKey
    || event.target.closest?.("input, textarea, select, dialog, [contenteditable]:not([contenteditable=false])")) return;
  event.preventDefault();
  setSpace(true);
});
window.addEventListener("keyup", (event) => {
  if (event.code === "Space") setSpace(false);
});
window.addEventListener("blur", () => {
  setSpace(false);
  if (pan && viewport.hasPointerCapture(pan.id)) viewport.releasePointerCapture(pan.id);
});
viewport.addEventListener("pointerdown", (event) => {
  panMoved = false;
  if (view !== "canvas" || gesture || event.pointerType === "touch" || event.button !== 0
    || (!spaceHeld && (editing || event.target.closest(".card, button")))) return;
  if (spaceHeld) {
    event.preventDefault();
    event.stopPropagation();
  }
  pan = { id: event.pointerId, x: event.clientX + viewport.scrollLeft, y: event.clientY + viewport.scrollTop };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add("panning");
}, true);
viewport.addEventListener("pointermove", (event) => {
  if (pan?.id !== event.pointerId) return;
  if (Math.hypot(event.clientX + viewport.scrollLeft - pan.x,
    event.clientY + viewport.scrollTop - pan.y) > 2) panMoved = true;
  viewport.scrollLeft = pan.x - event.clientX;
  viewport.scrollTop = pan.y - event.clientY;
});
viewport.addEventListener("lostpointercapture", () => {
  pan = null;
  viewport.classList.remove("panning");
});
viewport.addEventListener("click", (event) => {
  if (activeBranch && !panMoved && !event.target.closest(".card, button")) setBranch(null);
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeBranch && !$("input-dialog").open
    && !event.target.closest?.("select")) setBranch(null);
});
new ResizeObserver(() => {
  sizeCanvas();
  viewport.style.setProperty("--water-height", viewport.clientHeight + "px");
  if (!viewport.classList.contains("depth-gesture")) renderDepthPreview();
}).observe(viewport);

function renderLayout(next) {
  visibleLayout = next;
  const offset = view === "canvas" ? canvasMargin : { x: 0, y: 0 };
  for (const id of ids) {
    const [x, y, w, h] = next[id];
    cards[id].style.gridArea = (y + offset.y + 1) + " / " + (x + offset.x + 1) + " / span " + h + " / span " + w;
  }
  if (expanded.size) placeDetails();
  connections.refresh();
}

function renderView() {
  const canvas = view === "canvas";
  document.documentElement.classList.toggle("canvas-view", canvas);
  $("view-canvas").setAttribute("aria-pressed", String(canvas));
  $("view-bento").setAttribute("aria-pressed", String(!canvas));
  $("zoom-controls").hidden = !canvas;
  if (canvas) {
    board.style.zoom = zoom;
    sizeCanvas();
  } else {
    setSpace(false);
    board.style.removeProperty("zoom");
    board.style.removeProperty("width");
    board.style.removeProperty("min-height");
  }
  $("show-flow").hidden = canvas;
  connections.setLive(canvas);
}

for (const mode of ["canvas", "bento"]) {
  $("view-" + mode).addEventListener("click", () => {
    if (view === mode) return;
    finishDetailDrag(false);
    detailPositions.clear();
    if (editing) setEditing(false);
    view = mode;
    save("koltushi.view", view);
    layout = loadLayout();
    renderView();
    renderLayout(layout);
    if (view === "canvas") fitCanvas(!media.matches);
  });
}

// Keep cards close to their grid positions while finding room for expanded details.
function packDetails(entries, width, height, gap) {
  const scales = [1, .88, .76, .64, .52, .40, .28, .16];
  for (const scale of scales) {
    for (const compact of scales.filter(value => value <= scale && value >= scale * .55)) {
      const placed = [];
      for (const entry of entries) {
        const factor = entry.open ? scale : compact;
        const w = entry.width * factor;
        const h = entry.height * factor;
        const xs = [entry.x, 0, ...placed.flatMap(([x, , a]) => [x - w - gap, x + a + gap])];
        const ys = [entry.y, 0, ...placed.flatMap(([, y, , b]) => [y - h - gap, y + b + gap])];
        let best = null;
        let distance = Infinity;
        for (const left of xs) for (const top of ys) {
          const x = clamp(left, 0, width - w);
          const y = clamp(top, 0, height - h);
          const score = (x - entry.x) ** 2 + (y - entry.y) ** 2;
          const gutter = gap - .01;
          if (score >= distance || placed.some(([a, b, c, d]) =>
            overlaps([x - gutter, y - gutter, w + 2 * gutter, h + 2 * gutter], [a, b, c, d]))) continue;
          best = [x, y, w, h];
          distance = score;
        }
        if (!best) break;
        placed.push(best);
      }
      if (placed.length === entries.length) return placed;
    }
  }
  const columns = width > height ? 4 : 2;
  const rows = Math.ceil(entries.length / columns);
  const w = width / columns;
  const h = height / rows;
  return entries.map((_, index) => [index % columns * w, Math.floor(index / columns) * h,
    Math.max(1, w - gap), Math.max(1, h - gap)]);
}

function placeDetails(preferredId) {
  board.classList.remove("inline-details");
  const bounds = viewport.getBoundingClientRect();
  const origin = board.getBoundingClientRect();
  const scale = boardScale();
  const gap = media.matches ? 8 : 14;
  const left = bounds.left + gap;
  const top = Math.max(0, bounds.top) + gap;
  const width = Math.max(1, viewport.clientWidth - 2 * gap);
  const height = Math.max(1, Math.min(window.innerHeight, bounds.bottom) - top - gap);
  const magnification = view === "canvas" ? zoom / fittedZoom : 1;
  const preferredWidth = Math.max(width * .58, Math.min(410, width * .92));
  const wide = Math.min(width, preferredWidth * magnification);
  const tall = width * height / (3 * preferredWidth) * magnification;
  const entries = ids.map(id => {
    const card = cards[id];
    const open = expanded.has(id);
    const baseWidth = Math.min(card.offsetWidth * scale, width);
    const baseHeight = Math.min(card.offsetHeight * scale, height);
    const expandedWidth = Math.min(width, Math.max(wide, baseWidth * 1.04));
    const expandedHeight = Math.min(height, Math.max(tall * wide / expandedWidth,
      media.matches ? 0 : Math.min(baseHeight * 1.08, width * height * .41 / expandedWidth)));
    const [x, y] = detailPositions.get(id) ?? [card.offsetLeft, card.offsetTop];
    return { id, open, x: origin.left + x * scale - left,
      y: origin.top + y * scale - top,
      width: open ? expandedWidth : baseWidth,
      height: open ? expandedHeight : baseHeight };
  }).sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId)
    || Number(b.open) - Number(a.open) || a.y - b.y || a.x - b.x);
  const positions = packDetails(entries, width, height, gap);
  board.style.setProperty("--detail-board-height", origin.height / scale + "px");
  for (const [index, entry] of entries.entries()) {
    const [x, y, w, h] = positions[index];
    const style = cards[entry.id].style;
    style.setProperty("--detail-left", (left - origin.left + x) / scale + "px");
    style.setProperty("--detail-top", (top - origin.top + y) / scale + "px");
    style.setProperty("--detail-width", w / scale + "px");
    style.setProperty("--detail-height", h / scale + "px");
  }
  board.classList.add("inline-details");
}

function animateWindow(card, origin) {
  const target = card.getBoundingClientRect();
  const x = (origin.left - target.left) / boardScale();
  const y = (origin.top - target.top) / boardScale();
  if (!target.width || !target.height || !origin.width || !origin.height) return;
  const scaleX = origin.width / target.width;
  const scaleY = origin.height / target.height;
  if (Math.abs(x) < 1 && Math.abs(y) < 1 && Math.abs(scaleX - 1) < .01 && Math.abs(scaleY - 1) < .01) return;
  const animation = card.animate([
    { transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})` },
    { transform: "none" },
  ], { duration: 300, easing: "cubic-bezier(.2,.75,.25,1)" });
  animation.id = "window-layout";
  return animation;
}

function animateCardLayout(origins) {
  const animations = [...origins].map(([id, origin]) => animateWindow(cards[id], origin)).filter(Boolean);
  connections.followLayout(animations);
}

function captureCardPositions() {
  const origins = new Map();
  if (!reducedMotion.matches) {
    for (const key of ids) {
      const card = cards[key];
      origins.set(key, card.getBoundingClientRect());
      for (const animation of card.getAnimations()) {
        if (animation.id === "window-layout") animation.cancel();
      }
    }
  }
  return origins;
}

function toggleDetail(id) {
  finishDetailDrag(false);
  const origins = captureCardPositions();
  const open = !expanded.has(id);
  if (open) {
    if (!expanded.size) detailScroll = [viewport.scrollLeft, viewport.scrollTop, window.scrollY];
    expanded.add(id);
    renderDetail(id);
  } else {
    expanded.delete(id);
  }
  cards[id].classList.toggle("expanded", open);
  detailPanels[id].hidden = !open;
  const button = detailButtons[id];
  button.setAttribute("aria-expanded", String(open));
  button.setAttribute("aria-label", (open ? "Свернуть: " : "Подробности: ")
    + cards[id].querySelector(".card-label").textContent.trim());
  button.querySelector("use").setAttribute("href", open ? "#collapse" : "#arrow");
  if (open) setBranch(id);
  else if (id === activeBranch) setBranch([...expanded].at(-1) ?? null);
  $("edit").disabled = expanded.size > 0;
  if (expanded.size) placeDetails(detailPositions.has(id) ? id : undefined);
  else {
    detailPositions.clear();
    board.classList.remove("inline-details");
    if (detailScroll) {
      const [left, top, pageTop] = detailScroll;
      viewport.scrollTo(left, top);
      window.scrollTo(0, pageTop);
      detailScroll = null;
    }
  }

  animateCardLayout(origins);
  button.focus({ preventScroll: true });
}

function startDetailDrag(event) {
  const card = event.target.closest(".card");
  if (!card || detailDrag || !event.isPrimary || spaceHeld || event.button !== 0
    || event.target.closest(".card-detail")
    || (card.classList.contains("expanded") && !event.target.closest(".card-label"))) return;
  detailDrag = { card, pointer: event.pointerId, x: event.clientX, y: event.clientY,
    startX: viewport.scrollLeft, startY: viewport.scrollTop, active: false };
}

function moveDetailDrag(event) {
  const drag = detailDrag;
  const x = event.clientX - drag.x + viewport.scrollLeft - drag.startX;
  const y = event.clientY - drag.y + viewport.scrollTop - drag.startY;
  if (!drag.active) {
    if (Math.hypot(x, y) < 6) return;
    drag.active = true;
    for (const animation of drag.card.getAnimations()) {
      if (animation.id === "window-layout") animation.cancel();
    }
    drag.card.setPointerCapture(drag.pointer);
    board.classList.add("detail-dragging");
    drag.card.classList.add("dragging");
  }
  drag.card.style.translate = `${x / boardScale()}px ${y / boardScale()}px`;
}

function finishDetailDrag(commit) {
  if (!detailDrag) return;
  const { card, pointer, active } = detailDrag;
  detailDrag = null;
  if (!active) return;
  const origins = captureCardPositions();
  if (commit) {
    const rect = card.getBoundingClientRect();
    const origin = board.getBoundingClientRect();
    const scale = boardScale();
    detailPositions.set(card.id, [(rect.left - origin.left) / scale, (rect.top - origin.top) / scale]);
  }
  card.style.removeProperty("translate");
  card.classList.remove("dragging");
  board.classList.remove("detail-dragging");
  if (card.hasPointerCapture(pointer)) card.releasePointerCapture(pointer);
  if (commit) placeDetails(card.id);
  animateCardLayout(origins);
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
}

function setEditing(value) {
  if (gesture) finish(false);
  if (expanded.size) return;
  editing = value;
  board.classList.toggle("editing", value);
  $("show-flow").disabled = value;
  connections.refresh();
  $("edit").setAttribute("aria-pressed", String(value));
  $("edit").querySelector("span").textContent = value ? "Готово" : "Настроить стол";
  $("edit-bar").hidden = !value;
  for (const id of ids) {
    cards[id].tabIndex = value ? 0 : -1;
    detailButtons[id].tabIndex = value ? -1 : 0;
  }
}

function arrange(id, target) {
  const result = { ...layout, [id]: target };
  const fixed = [target];
  const displaced = [];
  for (const other of ids.filter((key) => key !== id)) {
    if (overlaps(target, layout[other])) displaced.push(other);
    else fixed.push(layout[other]);
  }
  for (const other of displaced) {
    const old = layout[other];
    const [, , w, h] = old;
    const oldSource = [layout[id][0], layout[id][1], w, h];
    let next = oldSource[0] + w <= (view === "canvas" ? cols() + canvasMargin.x : cols())
      && fixed.every((rect) => !overlaps(rect, oldSource))
      ? oldSource : [...old];
    while (fixed.some((rect) => overlaps(rect, next))) next[1]++;
    if (view === "canvas" && next[1] + h > canvasRows - canvasMargin.y) return layout;
    result[other] = next;
    fixed.push(next);
  }
  return result;
}

function gestureTarget(id, dx, dy, resize, origin = layout[id]) {
  const [x, y, w, h] = origin;
  const unit = subdivisions();
  if (view === "canvas") {
    const right = cols() + canvasMargin.x;
    const bottom = canvasRows - canvasMargin.y;
    return resize
      ? [x, y, clamp(w + dx, 3 * unit, right - x), clamp(h + dy, unit, Math.min(4 * unit, bottom - y))]
      : [clamp(x + dx, -canvasMargin.x, right - w), clamp(y + dy, -canvasMargin.y, bottom - h), w, h];
  }
  const lastRow = Math.max(...Object.values(layout).map(([, row, , height]) => row + height));
  return resize
    ? [x, y, clamp(w + dx, 3 * unit, cols() - x), clamp(h + dy, unit, 4 * unit)]
    : [clamp(x + dx, 0, cols() - w), clamp(y + dy, 0, Math.min(100 * unit, lastRow)), w, h];
}

function updateCandidate(event) {
  const g = gesture;
  g.lastEvent = event;
  const style = getComputedStyle(board);
  const gap = parseFloat(style.columnGap);
  const stepX = view === "canvas" ? canvasStep : (board.clientWidth + gap) / cols();
  const stepY = parseFloat(style.gridAutoRows) + gap;
  const deltaX = (event.clientX - g.x + viewport.scrollLeft - g.scrollX) / boardScale();
  const deltaY = (event.clientY - g.y + window.scrollY - g.scroll
    + viewport.scrollTop - g.scrollY) / boardScale();
  const dx = Math.round(deltaX / stepX);
  const dy = Math.round(deltaY / stepY);
  const target = gestureTarget(g.id, dx, dy, g.resize, g.origin);
  if (view === "canvas" && !g.resize) cards[g.id].style.translate = deltaX + "px " + deltaY + "px";
  g.preview = arrange(g.id, target);
  const [a, b, c, d] = g.preview[g.id];
  ghost.style.left = (a + (view === "canvas" ? canvasMargin.x : 0)) * stepX + "px";
  ghost.style.top = (b + (view === "canvas" ? canvasMargin.y : 0)) * stepY + "px";
  ghost.style.width = c * stepX - gap + "px";
  ghost.style.height = d * stepY - gap + "px";
  ghost.firstElementChild.textContent = c + " × " + d + " ячеек";
  ghost.hidden = false;
}

function scrollWhileDragging() {
  if (!gesture?.active || view !== "canvas") return;
  const { clientX, clientY } = gesture.lastEvent;
  const bounds = viewport.getBoundingClientRect();
  const speed = (point, low, high) =>
    clamp((point - high + 52) / 4, 0, 22) - clamp((low + 52 - point) / 4, 0, 22);
  const left = viewport.scrollLeft;
  const top = viewport.scrollTop;
  viewport.scrollBy(speed(clientX, bounds.left, bounds.right), speed(clientY, bounds.top, bounds.bottom));
  if (viewport.scrollLeft !== left || viewport.scrollTop !== top) updateCandidate(gesture.lastEvent);
  dragFrame = requestAnimationFrame(scrollWhileDragging);
}

function start(event) {
  if (expanded.size) return startDetailDrag(event);
  if (gesture || event.button !== 0) return;
  const card = event.target.closest(".card");
  const handle = event.target.closest(".handle");
  if (!card || event.target.closest(".card-detail")) return;
  const g = { id: card.id, pointer: event.pointerId, resize: Boolean(handle), x: event.clientX,
    y: event.clientY, scroll: window.scrollY, scrollX: viewport.scrollLeft, scrollY: viewport.scrollTop,
    active: false, preview: null, origin: layout[card.id] };
  g.direct = !editing && view === "canvas" && event.pointerType === "mouse";
  g.activate = (current) => {
    if (gesture !== g) return;
    if (!editing) {
      const [x, y] = visibleLayout[card.id];
      g.origin = [x, y, ...layout[card.id].slice(2)];
    }
    g.active = true;
    board.classList.add("gesture-drag");
    card.classList.add("dragging");
    if (card.hasPointerCapture(g.pointer) === false) card.setPointerCapture(g.pointer);
    updateCandidate(current);
    if (view === "canvas") dragFrame = requestAnimationFrame(scrollWhileDragging);
  };
  gesture = g;
  if (editing) g.activate(event);
  else if (!g.direct) g.timer = setTimeout(() => g.activate(event), 430);
}

function finish(commit) {
  if (!gesture) return;
  const g = gesture;
  clearTimeout(g.timer);
  cancelAnimationFrame(dragFrame);
  gesture = null;
  const card = cards[g.id];
  board.classList.remove("gesture-drag");
  card.style.removeProperty("translate");
  card.classList.remove("dragging");
  if (card.hasPointerCapture(g.pointer)) card.releasePointerCapture(g.pointer);
  ghost.hidden = true;
  if (commit && g.preview && !g.preview[g.id].every((value, index) => value === g.origin[index])) {
    layout = g.preview;
    renderLayout(layout);
    save(layoutKey(), layout);
    $("announcement").textContent = card.querySelector(".card-label").innerText + ": "
      + layout[g.id][2] + " × " + layout[g.id][3] + " ячеек";
  }
  if (g.active) {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }
  connections.refresh();
}

let suppressClick = false;
board.addEventListener("click", (event) => {
  if (suppressClick) event.stopImmediatePropagation();
}, true);
for (const card of Object.values(depthCards).flatMap(layer => Object.values(layer))) {
  const id = card.id;
  const label = card.querySelector(".card-label").textContent.trim();
  const detail = document.createElement("button");
  detail.type = "button";
  detail.className = "open-detail";
  detail.setAttribute("aria-label", "Подробности: " + label);
  detail.setAttribute("aria-expanded", "false");
  detail.setAttribute("aria-controls", id + "-detail");
  detail.innerHTML = '<svg aria-hidden="true"><use href="#arrow"/></svg>';
  detail.addEventListener("click", () => { if (!editing) toggleDetail(id); });
  card.addEventListener("click", (event) => {
    if (!editing && !event.target.closest("button, a, .card-detail")) detail.click();
  });
  detailButtons[id] = detail;
  const panel = document.createElement("div");
  panel.id = id + "-detail";
  panel.className = "card-detail";
  panel.tabIndex = 0;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", label);
  panel.hidden = true;
  panel.addEventListener("focusin", () => {
    if (activeBranch !== id) setBranch(id);
  });
  panel.addEventListener("click", () => {
    if (activeBranch !== id) setBranch(id);
  });
  detailPanels[id] = panel;
  card.append(panel);
  card.append(detail);
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "handle";
  handle.setAttribute("aria-label", "Размер виджета: " + card.querySelector(".card-label").firstChild.textContent.trim());
  handle.title = "Потяни угол или нажми стрелки";
  card.append(handle);
  card.tabIndex = -1;
}
board.addEventListener("pointerdown", start);
window.addEventListener("pointermove", (event) => {
  if (detailDrag?.pointer === event.pointerId) return moveDetailDrag(event);
  if (!gesture || gesture.pointer !== event.pointerId) return;
  if (!gesture.active) {
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6) {
      if (gesture.direct) gesture.activate(event);
      else finish(false);
    }
    return;
  }
  updateCandidate(event);
});
window.addEventListener("pointerup", (event) => {
  if (detailDrag?.pointer === event.pointerId) finishDetailDrag(true);
  if (gesture?.pointer === event.pointerId) finish(true);
});
window.addEventListener("pointercancel", (event) => {
  if (detailDrag?.pointer === event.pointerId) finishDetailDrag(false);
  if (gesture?.pointer === event.pointerId) finish(false);
});
board.addEventListener("lostpointercapture", (event) => {
  if (detailDrag?.pointer === event.pointerId) finishDetailDrag(false);
  if (gesture?.pointer === event.pointerId) finish(false);
});
board.addEventListener("contextmenu", (event) => {
  if (editing || gesture) event.preventDefault();
});
board.addEventListener("keydown", (event) => {
  if (!editing) return;
  if (event.key === "Escape") return setEditing(false);
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!arrow) return;
  const card = event.target.closest(".card");
  if (!card || (event.target !== card && !event.target.closest(".handle"))) return;
  event.preventDefault();
  const [dx, dy] = arrow;
  const target = gestureTarget(card.id, dx, dy, event.target !== card);
  layout = arrange(card.id, target);
  renderLayout(layout);
  save(layoutKey(), layout);
  $("announcement").textContent = "Позиция " + (target[0] + 1) + ", " + (target[1] + 1)
    + ". Размер " + target[2] + " × " + target[3] + " ячеек";
});
$("edit").addEventListener("click", () => setEditing(!editing));
$("reset").addEventListener("click", () => {
  finish(false);
  layout = initialLayout();
  renderLayout(layout);
  save(layoutKey(), layout);
  if (view === "canvas") fitCanvas(!media.matches);
});
media.addEventListener("change", () => {
  finishDetailDrag(false);
  detailPositions.clear();
  finish(false);
  layout = loadLayout();
  renderLayout(layout);
  renderDepthPreview();
});

const dialog = $("input-dialog");
const form = $("input-form");
for (const [key, title] of Object.entries(fields)) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.name = key;
  input.type = "text";
  input.inputMode = key === "units" ? "numeric" : "decimal";
  input.required = true;
  label.append(title, input);
  $("fields").append(label);
}
function fillForm(source) {
  for (const key of Object.keys(fields)) {
    form.elements.namedItem(key).value = source[key] / (key === "units" ? 1 : 100);
  }
  $("form-error").textContent = "";
}
function openInputs() {
  fillForm(data);
  dialog.showModal();
}
function parseValue(text, isUnits) {
  const clean = text.replace(/\s/g, "");
  if (isUnits) return /^\d+$/.test(clean) ? Number(clean) : NaN;
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(clean);
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : NaN;
}
$("inputs").addEventListener("click", openInputs);
$("close-inputs").addEventListener("click", () => dialog.close());
$("restore-inputs").addEventListener("click", () => fillForm(defaults));
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const next = Object.fromEntries(Object.keys(fields).map((key) =>
    [key, parseValue(form.elements.namedItem(key).value, key === "units")]));
  if (!validData(next)) {
    $("form-error").textContent = "Проверь суммы и количество. Аванс должен быть в пределах суммы заказа.";
    return;
  }
  const changedSources = [];
  if (next.advance !== data.advance) changedSources.push("cash");
  if (next.outsourcing !== data.outsourcing) changedSources.push("scenarios");
  if (next.equipment !== data.equipment || next.shipping !== data.shipping) changedSources.push("decision");
  if (["units", "fabric", "sewing", "cutting", "print", "other"].some((key) => next[key] !== data[key])) {
    changedSources.push("costs");
  }
  data = next;
  save(dataKey, data);
  renderNumbers(true);
  for (const id of expanded) renderDetail(id);
  dialog.close();
  if (changedSources.length) connections.play(changedSources);
});

$("show-flow").addEventListener("click", () => connections.play());
renderView();
renderLayout(layout);
renderNumbers();
renderDepthPreview();
if (view === "canvas") fitCanvas(!media.matches);
notifySea("ready");
