"use strict";

const { layers, groups, nodes, links, scenario } = seaData;
const byId = Object.fromEntries(nodes.map(node => [node.id, node]));
const groupById = Object.fromEntries(groups.map(group => [group.id, group]));
const layerIndex = Object.fromEntries(layers.map((layer, index) => [layer.id, index]));
const depths = ["sea", ...layers.map(layer => layer.id)];
const $ = id => document.getElementById(id);
const viewport = $("map-viewport");
const world = $("map-world");
const atlas = $("sea-atlas");
const surround = $("sea-surround");
const surroundContext = surround.getContext("2d");
const seaFeather = 16;
const financeDesk = $("finance-desk");
const mapShade = $("map-shade");
const requested = new URLSearchParams(location.search).get("node");
const isDesk = requested && Object.hasOwn(byId, requested);
const svgNS = "http://www.w3.org/2000/svg";
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "UTC" });
const dateLabel = date => dateFormat.format(new Date(date + "T12:00:00Z"));
const escape = value => String(value).replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function storedScenario(value) {
  try {
    if (value !== undefined) localStorage.setItem(scenario.storageKey, String(value));
    return localStorage.getItem(scenario.storageKey) === "true";
  } catch { return false; }
}

const state = {
  layer: "sea", selected: null, scope: null, trace: null,
  changed: storedScenario(),
};
let scene;
let panoramaSource;
let camera = { x: 0, y: 0, zoom: 1 };
let drag = null;
let dragFrame = 0;
let skipClick = false;
let diveScale = 1;
let diveDesk = null;
let financeActive = false;
let financeReady = false;
let financePrepared = false;
let financePreparing = false;
let surfaceUnderDesk = false;
let financePending = 0;
const positionKey = "decision-sea.surface-positions.v1";
const surfacePositions = new Map();
try {
  for (const [id, point] of Object.entries(JSON.parse(localStorage.getItem(positionKey) ?? "{}"))) {
    if (byId[id] && Array.isArray(point) && point.length === 2
      && point.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
      surfacePositions.set(id, point);
    }
  }
} catch { /* The map is also usable without browser storage. */ }

function traverse(start, direction) {
  const reached = new Set([start]);
  const paths = new Set();
  for (const id of reached) {
    for (const edge of links) {
      if (edge.kind !== "basis") continue;
      const { from, to } = edge;
      if ((direction === "upstream" ? to : from) !== id) continue;
      reached.add(direction === "upstream" ? from : to);
      paths.add(edge.id);
    }
  }
  return { nodes: reached, edges: paths };
}

function related(id) {
  return links.filter(edge => edge.kind === "related" && (edge.from === id || edge.to === id));
}

function versions(node) {
  return state.changed && node.id === scenario.foundation ? [...node.versions, node.scenarioVersion] : node.versions;
}

function reviewInfo() {
  return state.changed ? traverse(scenario.foundation, "downstream") : { nodes: new Set(), edges: new Set() };
}

function operationFor(group) {
  return nodes.find(node => node.group === group && node.layer === "operations");
}

function inScope(id, scope) {
  return !scope || traverse(scope, "upstream").nodes.has(id);
}

function layerView(layer) {
  const selected = byId[state.selected]?.layer === layer ? state.selected
    : state.scope ? nodes.find(node => node.layer === layer && inScope(node.id, state.scope))?.id ?? null : null;
  return { layer, trace: null, selected, scope: state.scope };
}

function setLayer(layer, center) {
  mapWheelZoom.cancel();
  if (layer === "sea" && isDesk) {
    location.assign("./index.html");
    return false;
  }
  Object.assign(state, layerView(layer));
  render({ fit: true, center });
}

function showDesk(id) {
  const node = byId[id];
  state.selected = id;
  state.layer = node.layer;
  state.scope = operationFor(node.group)?.id ?? null;
  render({ fit: true, center: id });
  $("status").textContent = node.title + " · " + layers[layerIndex[node.layer]].label;
}

function openDesk(id) {
  const node = byId[id];
  if (id === "op.press") {
    if (!financeReady) {
      if (!financePending) financePending = setTimeout(() => location.assign(node.financeLink), 1200);
      return true;
    }
    financeDesk.getAnimations().forEach(animation => animation.cancel());
    const shade = Number(getComputedStyle(mapShade).opacity);
    mapShade.getAnimations().forEach(animation => animation.cancel());
    mapShade.style.opacity = Math.max(.47, shade);
    prepareFinance();
    financeActive = true;
    surfaceUnderDesk = false;
    document.body.classList.remove("finance-releasing");
    document.body.classList.add("finance-active");
    viewport.inert = true;
    setCurrentLayer("operations");
    if (financePrepared) revealFinance();
    return true;
  }
  location.assign(node.financeLink ?? "./index.html?node=" + encodeURIComponent(id));
  return false;
}

function sendFinance(type, depth) {
  financeDesk.contentWindow.postMessage({ channel: "decision-sea-host", type, depth }, "*");
}

function prepareFinance() {
  if (!financeReady || financePrepared || financePreparing) return;
  financePreparing = true;
  sendFinance("prepare");
}

function releaseShade() {
  const opacity = Number(getComputedStyle(mapShade).opacity);
  mapShade.getAnimations().forEach(animation => animation.cancel());
  mapShade.style.opacity = 0;
  if (!reduced.matches && opacity > 0) {
    mapShade.animate([{ opacity, offset: 0 }, { opacity, offset: .18 }, { opacity: 0, offset: 1 }],
      { duration: 260, easing: "ease-out" });
  }
}

function revealFinance() {
  financeDesk.style.setProperty("--finance-opacity", 1);
  financeDesk.style.setProperty("--finance-blur", "0px");
  financeDesk.inert = false;
  financeDesk.setAttribute("aria-hidden", "false");
  financeDesk.contentWindow.focus();
  releaseShade();
}

function previewFinance(progress = 0) {
  const onSurface = financePrepared && state.layer === "sea";
  financeDesk.style.setProperty("--finance-opacity", onSurface ? .19 + progress * .81 : 0);
  financeDesk.style.setProperty("--finance-blur", 10 * (1 - progress) + "px");
  positionFinancePreview(progress);
}

function positionFinancePreview(progress = 0) {
  if (state.layer !== "sea" || financeActive) return;
  const card = $("map-nodes").querySelector('[data-node="op.press"]');
  if (!card) return;
  const box = card.getBoundingClientRect();
  const panel = financeDesk.parentElement.getBoundingClientRect();
  const padX = Math.min(68, panel.width * .12);
  const padY = Math.min(48, panel.height * .1);
  const inset = (value, size) => Math.max(0, Math.min(size, value)) * (1 - progress);
  const left = inset(box.left - panel.left - padX, panel.width);
  const top = inset(box.top - panel.top - padY, panel.height);
  const right = inset(panel.right - box.right - padX, panel.width);
  const bottom = inset(panel.bottom - box.bottom - padY, panel.height);
  const width = Math.max(0, panel.width - left - right);
  const height = Math.max(0, panel.height - top - bottom);
  const feather = Math.min(18, width / 4, height / 4) * (1 - progress);
  for (const [key, value] of Object.entries({
    left, top, right, bottom, width, height, feather, radius: 24 * (1 - progress),
  })) {
    financeDesk.style.setProperty("--peek-" + key, value + "px");
  }
}

function setCurrentLayer(layer) {
  const nav = $("layer-nav");
  nav.hidden = layer === "sea";
  for (const button of nav.querySelectorAll("button")) {
    if (button.dataset.layer === layer) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
}

function showSurfaceUnderDesk() {
  if (surfaceUnderDesk) return;
  surfaceUnderDesk = true;
  Object.assign(state, { layer: "sea", trace: null, selected: null, scope: null });
  render({ fit: true });
  showDiveProgress(null, 0);
  setCurrentLayer("operations");
}

function closeFinance() {
  const opacity = Number(getComputedStyle(financeDesk).opacity);
  financeDesk.getAnimations().forEach(animation => animation.cancel());
  showSurfaceUnderDesk();
  financeActive = false;
  financePrepared = false;
  financePreparing = false;
  document.body.classList.remove("finance-active");
  viewport.inert = false;
  financeDesk.inert = true;
  financeDesk.setAttribute("aria-hidden", "true");
  financeDesk.style.setProperty("--finance-opacity", 0);
  const prepareSurface = () => {
    document.body.classList.remove("finance-releasing");
    if (!financeActive) prepareFinance();
  };
  if (!reduced.matches && opacity > .05) {
    document.body.classList.add("finance-releasing");
    const fade = financeDesk.animate([{ opacity }, { opacity: 0 }], { duration: 220, easing: "ease-out" });
    fade.addEventListener("finish", prepareSurface, { once: true });
  } else prepareSurface();
  releaseShade();
  setCurrentLayer("sea");
  viewport.focus({ preventScroll: true });
}

window.addEventListener("message", event => {
  if (event.source !== financeDesk.contentWindow || event.data?.channel !== "decision-sea-desk") return;
  const { type, depth, progress } = event.data;
  if (type === "ready") {
    financeReady = true;
    if (!isDesk) prepareFinance();
    if (financePending) {
      clearTimeout(financePending);
      financePending = 0;
      openDesk("op.press");
    }
  }
  if (type === "prepared" && financePreparing) {
    financePreparing = false;
    financePrepared = true;
    if (financeActive) revealFinance();
    else if (!viewport.classList.contains("diving")) previewFinance();
  }
  if (!financeActive) return;
  if (type === "layer" && layers.some(layer => layer.id === depth)) setCurrentLayer(depth);
  if (type === "surface-progress" && financePrepared && Number.isFinite(progress)) {
    if (progress > 0) showSurfaceUnderDesk();
    financeDesk.getAnimations().forEach(animation => animation.cancel());
    financeDesk.style.setProperty("--finance-opacity", 1 - Math.min(1, Math.max(0, progress)));
  }
  if (type === "surface") closeFinance();
});

function operationAt(event) {
  const target = event.target.closest("[data-node]");
  const node = byId[target?.dataset.node];
  if (node) return node.layer === "operations" ? node.id : operationFor(node.group)?.id;
  const bounds = viewport.getBoundingClientRect();
  const x = (event.clientX - bounds.left - camera.x) / camera.zoom;
  const y = (event.clientY - bounds.top - camera.y) / camera.zoom;
  const nearest = scene.items.reduce((best, item) => {
    const distance = Math.hypot(item.x - x, item.y - y);
    return distance < best.distance ? { item, distance } : best;
  }, { distance: Infinity }).item;
  if (nearest?.node.layer === "operations") return nearest.node.id;
  return operationFor(nearest?.node.group)?.id ?? "op.press";
}

function showTrace(root, direction, changed = false) {
  state.selected = root;
  state.layer = byId[root].layer;
  state.trace = { root, direction, changed };
  render({ fit: true });
  $("status").textContent = (direction === "upstream" ? "Показаны основания." : "Показаны зависимые решения.")
    + (changed ? " Покупка пресса помечена на пересмотр." : "");
}

function buildScene({ layer, selected, scope, trace } = state) {
  const narrow = viewport.clientWidth < 550;
  const surface = layer === "sea";
  const geometry = surface ? seaSurfaceGeometry(viewport.clientWidth, viewport.clientHeight)
    : seaChartGeometry(viewport.clientWidth);
  const { width, height, cardWidth } = geometry;
  if (trace) {
    const path = traverse(trace.root, trace.direction);
    const rows = layers.map(layer => nodes.filter(node => node.layer === layer.id && path.nodes.has(node.id)));
    const visibleRows = rows.filter(row => row.length);
    const items = visibleRows.flatMap((row, index) => row.map((node, i) => ({
      node, x: width * (i + 1) / (row.length + 1), y: 0, row: index,
      w: narrow ? 177 : 227, h: 0,
    })));
    return { width, rows: visibleRows.length, items, edges: links.filter(edge => path.edges.has(edge.id)), path };
  }

  const visibleNodes = nodes.filter(node => node.layer === (surface ? "operations" : layer));
  const horizontal = new Set(related(selected).flatMap(edge => [edge.from, edge.to]));
  const filtered = visibleNodes.filter(node => inScope(node.id, scope) || horizontal.has(node.id));
  const items = filtered.map((node, index) => {
    const point = surface && surfacePositions.get(node.id);
    const marker = surface && node.id === "op.press" ? geometry.marker : null;
    const { art } = geometry;
    return {
      node, surface,
      x: point ? art.left + point[0] * art.width : marker?.x ?? width * (index + 1) / (filtered.length + 1),
      y: point ? art.top + point[1] * art.height : marker?.y ?? height / 2,
      w: cardWidth, h: surface ? 116 : 112,
    };
  });
  const edges = links.filter(edge => edge.kind === "related" && visibleNodes.some(node => node.id === edge.from));
  return { width, height, items, edges, art: geometry.art, pin: geometry.pin };
}

function tetherPath(item) {
  const { x, y } = scene.pin;
  const zoom = camera.zoom * diveScale;
  const edgeX = item.x + (item.x < x ? 1 : -1) * item.w / 2 * surfaceCardSize(zoom) / zoom;
  return `M${x},${y} Q${(x + edgeX) / 2},${item.y} ${edgeX},${item.y}`;
}

function constrainSurfaceCamera() {
  const { art } = scene;
  const { zoom } = camera;
  const approach = (zoom - depthZoomRange.min) / (depthZoomRange.max - depthZoomRange.min);
  function limit(origin, offset, length, extent) {
    const start = offset * zoom;
    const fullSize = length * depthZoomRange.min;
    // Leave enough room to bring a card at the edge from the panorama into the center.
    const margin = (extent - fullSize * (1 - approach)) / 2;
    return Math.max(extent - margin - start - length * zoom, Math.min(margin - start, origin));
  }
  camera.x = limit(camera.x, art.left, art.width, viewport.clientWidth);
  camera.y = limit(camera.y, art.top, art.height, viewport.clientHeight);
}

function paintSeaSurround(left, top, width, height) {
  const viewWidth = viewport.clientWidth;
  const viewHeight = viewport.clientHeight;
  const coversView = left <= -seaFeather && top <= -seaFeather
    && left + width >= viewWidth + seaFeather && top + height >= viewHeight + seaFeather;
  surround.hidden = !panoramaSource || coversView;
  if (surround.hidden || !surroundContext) return;

  // Render the soft continuation at low resolution, with bleed for CSS blur.
  const bleed = 16;
  const ratio = 384 / (Math.max(viewWidth, viewHeight) + 2 * bleed);
  const canvasWidth = Math.max(1, Math.round((viewWidth + 2 * bleed) * ratio));
  const canvasHeight = Math.max(1, Math.round((viewHeight + 2 * bleed) * ratio));
  if (surround.width !== canvasWidth) surround.width = canvasWidth;
  if (surround.height !== canvasHeight) surround.height = canvasHeight;

  function bands(start, length, size, end) {
    const begin = Math.round((start + bleed) * ratio);
    const finish = Math.round((start + length + bleed) * ratio);
    const sample = gap => Math.max(1, Math.min(Math.round(size * .22),
      Math.round(size * gap / Math.max(1, finish - begin))));
    const outer = sample(end - finish);
    return [[0, sample(begin), 0, begin, true], [0, size, begin, finish - begin, false],
      [size - outer, outer, finish, end - finish, true]];
  }
  const columns = bands(left, width, panoramaSource.width, canvasWidth);
  const rows = bands(top, height, panoramaSource.height, canvasHeight);
  for (const [sx, sw, dx, dw, mirrorX] of columns) {
    for (const [sy, sh, dy, dh, mirrorY] of rows) {
      if (dw <= 0 || dh <= 0) continue;
      surroundContext.setTransform(mirrorX ? -1 : 1, 0, 0, mirrorY ? -1 : 1,
        dx + (mirrorX ? dw : 0), dy + (mirrorY ? dh : 0));
      surroundContext.drawImage(panoramaSource, sx, sy, sw, sh, 0, 0, dw, dh);
    }
  }
}

function paintMapPlanes() {
  const scale = camera.zoom * diveScale;
  const target = scene.art && scene.items.find(item => item.node.id === diveDesk);
  const x = camera.x + (target?.x ?? 0) * (camera.zoom - scale);
  const y = camera.y + (target?.y ?? 0) * (camera.zoom - scale);
  world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  if (!scene.art) return;
  const { left, top, width, height } = scene.art;
  const artX = x + left * scale;
  const artY = y + top * scale;
  atlas.style.transform = `translate(${artX}px, ${artY}px) scale(${scale})`;
  paintSeaSurround(artX, artY, width * scale, height * scale);
  if (!surround.hidden) atlas.style.setProperty("--sea-feather", seaFeather / scale + "px");
  world.style.setProperty("--surface-card-scale", surfaceCardSize(scale) / scale);
  const press = scene.items.find(item => item.node.id === "op.press");
  if (press) $("map-lines").querySelector(".surface-tether")?.setAttribute("d", tetherPath(press));
}

function moveSurfaceCard(item, x, y) {
  const art = scene.art;
  item.x = Math.max(art.left, Math.min(art.left + art.width, x));
  item.y = Math.max(art.top, Math.min(art.top + art.height, y));
  item.element.style.left = item.x + "px";
  item.element.style.top = item.y + "px";
  if (item.node.id === "op.press") {
    $("map-lines").querySelector(".surface-tether")?.setAttribute("d", tetherPath(item));
    positionFinancePreview();
  }
}

function saveSurfacePosition(item) {
  const art = scene.art;
  surfacePositions.set(item.node.id, [(item.x - art.left) / art.width, (item.y - art.top) / art.height]);
  try {
    localStorage.setItem(positionKey, JSON.stringify(Object.fromEntries(surfacePositions)));
  } catch { /* The new position remains available on this page. */ }
}

const depthPreview = $("map-depth-preview");
let previewLayer;
function renderDepthPreview(layer, desk = null) {
  const target = !layer ? null : desk ? { layer, scope: desk }
    : layer === "sea" ? { layer } : layerView(layer);
  const key = [layer, target?.selected, target?.scope, viewport.clientWidth, viewport.clientHeight, state.changed].join("/");
  if (key === previewLayer) return;
  previewLayer = key;
  depthPreview.replaceChildren();
  if (!layer) return;
  const next = buildScene(target);
  const scale = fitScale(next);
  const plane = document.createElement("div");
  plane.className = "map-preview-plane";
  plane.style.width = next.width + "px";
  plane.style.height = next.height + "px";
  plane.style.setProperty("--preview-scale", scale);
  for (const item of next.items) {
    const card = document.createElement("div");
    card.className = "map-node" + (item.surface ? " surface-card" : "");
    card.dataset.layer = layer;
    card.dataset.previewNode = item.node.id;
    card.style.left = item.x + "px";
    card.style.top = item.y + "px";
    card.style.setProperty("--node-width", item.w + "px");
    card.innerHTML = nodeMarkup(item, reviewInfo());
    plane.append(card);
  }
  depthPreview.append(plane);
}

function showDiveProgress(index, progress) {
  if (index === null && financeActive && !surfaceUnderDesk) return;
  const current = wheelDepth();
  const enteringDesk = !isDesk && index !== null && index > current;
  const target = enteringDesk ? "operations" : !isDesk && index !== null ? "sea"
    : index === null ? depths[depths.indexOf(state.layer) + 1] : depths[index];
  const enteringFinance = enteringDesk && diveDesk === "op.press";
  const financeUnderMap = state.layer === "sea" && (enteringFinance || index === null);
  renderDepthPreview(financeUnderMap ? null : target, enteringDesk ? diveDesk : null);
  if (enteringFinance) prepareFinance();
  viewport.style.setProperty("--dive-progress", progress);
  viewport.classList.toggle("diving", index !== null);
  diveScale = 1 + progress * .12 * Math.sign((index ?? current) - current);
  paintMapPlanes();
  if (!financeActive) {
    previewFinance(enteringFinance ? progress : 0);
    mapShade.getAnimations().forEach(animation => animation.cancel());
    mapShade.style.opacity = enteringFinance ? .17 + progress * .43 : zoomShade();
  }
  const water = $("map-water");
  if (index !== null && target) {
    water.getAnimations().forEach(animation => animation.cancel());
    water.dataset.tint = target;
  }
  water.style.opacity = index !== null ? progress : 0;
}

function zoomShade() {
  const relative = camera.zoom / fitScale();
  return Math.max(0, Math.min(.17, (relative - 1.8) * .85));
}

function wheelDepth() {
  return isDesk ? depths.indexOf(state.layer) : state.layer === "sea" ? 0 : 1;
}

function edgePath(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy) * 1.15) {
    const sign = Math.sign(dx);
    const start = a.x + a.w / 2 * sign;
    const end = b.x - b.w / 2 * sign;
    const middle = (start + end) / 2;
    return `M${start},${a.y} C${middle},${a.y} ${middle},${b.y} ${end},${b.y}`;
  }
  const sign = Math.sign(dy);
  const start = a.y + a.h / 2 * sign;
  const end = b.y - b.h / 2 * sign;
  const middle = (start + end) / 2;
  return `M${a.x},${start} C${a.x},${middle} ${b.x},${middle} ${b.x},${end}`;
}

function svgElement(tag, attributes) {
  const element = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function nodeMarkup(item, review) {
  const { node } = item;
  const group = groupById[node.group];
  const label = item.surface ? node.surface?.kind ?? "Вопрос" : layers[layerIndex[node.layer]].label;
  const meta = label + (node.demo ? " · демо" : "");
  const caption = (item.surface && node.surface?.caption) || versions(node).at(-1).position;
  const isReview = review.nodes.has(node.id) && node.id !== scenario.foundation;
  const changedNode = state.changed && node.id === scenario.foundation;
  return `<span class="node-meta"><span class="node-symbol" aria-hidden="true">${escape(group.symbol)}</span>${escape(meta)}</span>
    <span class="node-title">${escape((item.surface && node.surface?.title) || node.title)}</span>
    <span class="node-caption">${escape(caption)}</span>
    ${isReview || changedNode ? `<span class="node-review">${isReview ? "На пересмотр" : "Изменено в демо"}</span>` : ""}`;
}

function renderScene() {
  renderDepthPreview(state.layer === "sea" ? null : depths[depths.indexOf(state.layer) + 1]);
  scene = buildScene();
  world.style.width = scene.width + "px";
  if (scene.art) {
    const { width, height } = scene.art;
    atlas.style.width = width + "px";
    atlas.style.height = height + "px";
  }
  const review = reviewInfo();
  const selectedLinks = new Set(related(state.selected).map(edge => edge.id));
  const itemById = Object.fromEntries(scene.items.map(item => [item.node.id, item]));
  $("map-nodes").replaceChildren(...scene.items.map(item => {
    const { node } = item;
    const selected = state.selected === node.id;
    const isReview = review.nodes.has(node.id) && node.id !== scenario.foundation;
    const changedNode = state.changed && node.id === scenario.foundation;
    const visibleNeighbor = related(state.selected).some(edge => edge.from === node.id || edge.to === node.id);
    const faded = state.selected && !scene.path && !selected && !visibleNeighbor;
    const button = document.createElement("button");
    button.type = "button";
    button.className = ["map-node", item.surface && "surface-card", selected && "selected", faded && "faded",
      (isReview || changedNode) && "review"].filter(Boolean).join(" ");
    button.dataset.node = node.id;
    button.dataset.layer = item.surface ? "sea" : node.layer;
    if (!item.surface) button.setAttribute("aria-pressed", String(selected));
    button.style.left = item.x + "px";
    button.style.top = item.y + "px";
    button.style.setProperty("--node-width", item.w + "px");
    button.innerHTML = nodeMarkup(item, review);
    button.addEventListener("click", () => {
      if (skipClick) return;
      openDesk(node.id);
    });
    item.element = button;
    return button;
  }));

  for (const item of scene.items) item.h = item.element.offsetHeight;
  if (scene.path) {
    let top = 25;
    for (let row = 0; row < scene.rows; row++) {
      const items = scene.items.filter(item => item.row === row);
      const tallest = Math.max(...items.map(item => item.h));
      for (const item of items) {
        item.y = top + tallest / 2;
        item.element.style.top = item.y + "px";
      }
      top += tallest + 43;
    }
    scene.height = top - 18;
  }
  world.style.height = scene.height + "px";

  const drawings = document.createDocumentFragment();
  const press = itemById["op.press"];
  if (scene.pin && press) {
    const { x, y } = scene.pin;
    drawings.append(svgElement("path", {
      d: tetherPath(press),
      class: "surface-tether",
    }), svgElement("circle", { cx: x, cy: y, r: 5, class: "surface-pin" }));
  }
  const defs = svgElement("defs", {});
  for (const color of ["normal", "review"]) {
    const marker = svgElement("marker", { id: "arrow-" + color, viewBox: "0 0 8 8",
      refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
    marker.append(svgElement("path", { d: "M1,1 L7,4 L1,7", fill: "none",
      stroke: color === "review" ? "#ffce8c" : "#c1eef1", "stroke-width": 1.2 }));
    defs.append(marker);
  }
  drawings.append(defs);
  for (const edge of scene.edges) {
    const a = itemById[edge.from];
    const b = itemById[edge.to];
    if (!a || !b) continue;
    const d = edgePath(a, b);
    const isReview = review.edges.has(edge.id);
    const lit = Boolean(scene.path || selectedLinks.has(edge.id));
    const faded = state.selected && !lit;
    const group = svgElement("g", { "data-edge": edge.id, "data-review": String(isReview) });
    const title = svgElement("title", {});
    title.textContent = edge.label;
    const line = svgElement("path", { d,
      class: ["map-edge", edge.kind, lit && "lit", isReview && "review", faded && "faded"].filter(Boolean).join(" ") });
    if (edge.kind === "basis") line.setAttribute("marker-end", isReview ? "url(#arrow-review)" : "url(#arrow-normal)");
    group.append(title, line);
    if ((lit || isReview) && !reduced.matches) {
      group.append(svgElement("path", { d, class: "map-edge-pulse" + (isReview ? " review" : "") }));
    }
    drawings.append(group);
  }
  $("map-lines").replaceChildren(drawings);
}

function relationSection(label, relations, target) {
  if (!relations.length) return "";
  return `<h3>${label}</h3><div class="relation-list">${relations.map(edge => {
    const node = byId[target(edge)];
    return `<button type="button" class="relation-link" data-target="${node.id}">
      ${escape(node.title)} <span aria-hidden="true">↗</span><small>${escape(edge.label)}</small></button>`;
  }).join("")}</div>`;
}

function renderInspector() {
  const panel = $("inspector-body");
  const node = byId[state.selected];
  if (!isDesk || !node) return;
  {
    const history = versions(node);
    const current = history.at(-1);
    const past = history.slice(0, -1).reverse();
    const review = reviewInfo().nodes.has(node.id) && node.id !== scenario.foundation;
    const canTraceUp = links.some(edge => edge.kind === "basis" && edge.to === node.id);
    const canTraceDown = links.some(edge => edge.kind === "basis" && edge.from === node.id);
    panel.innerHTML = `<p class="eyebrow">${escape(layers[layerIndex[node.layer]].label)} · ${escape(groupById[node.group].label)}${node.demo ? " · демо" : ""}</p>
      <h2>${escape(node.title)}</h2>
      <div class="position" data-version="${current.id}"><div class="position-heading"><span>Актуальная позиция</span><time datetime="${current.date}">${dateLabel(current.date)}</time></div>
        <strong>${escape(current.position)}</strong>
        <p class="inspector-copy">${escape(current.reason)}</p>
        ${current.source ? `<p class="inspector-copy">${escape(current.source)}</p>` : ""}
        ${review ? '<p class="review-note">На пересмотр · изменилось основание в демо</p>' : ""}
      </div>
      ${node.financeLink ? `<a class="source" href="${node.financeLink}">Открыть финансовый стол ↗</a>` : ""}
      <div class="desk-actions">
        ${canTraceUp ? '<button type="button" class="subtle" id="trace-up">Все основания ↓</button>' : ""}
        ${canTraceDown ? '<button type="button" class="subtle" id="trace-down">Все зависимости ↑</button>' : ""}
        ${node.id === scenario.foundation ? `<button type="button" class="subtle" id="scenario">${state.changed ? "Сбросить сценарий" : "Проверить изменение в демо"}</button>` : ""}
      </div>
      ${relationSection("↓ Основания", links.filter(edge => edge.kind === "basis" && edge.to === node.id), edge => edge.from)}
      ${relationSection("↑ На что влияет", links.filter(edge => edge.kind === "basis" && edge.from === node.id), edge => edge.to)}
      ${relationSection("↔ На этом слое", related(node.id), edge => edge.from === node.id ? edge.to : edge.from)}
      <details class="history"><summary>История${past.length ? " · " + past.length : ""}</summary>
      ${past.length ? past.map((version, index) => `<article data-version="${version.id}"><time datetime="${version.date}">${dateLabel(version.date)}</time>
        <p>${escape(version.position)}</p><p>Сменили ${dateLabel((past[index - 1] ?? current).date).replace(/ г\.$/, "")}. ${escape((past[index - 1] ?? current).reason)}</p></article>`).join("")
        : '<p class="inspector-copy">Пока есть одна версия.</p>'}</details>`;
  }
  panel.scrollTop = 0;
  panel.querySelectorAll("[data-target]").forEach(button => button.addEventListener("click", () => {
    openDesk(button.dataset.target);
  }));
  $("trace-up")?.addEventListener("click", () => showTrace(node.id, "upstream"));
  $("trace-down")?.addEventListener("click", () => showTrace(node.id, "downstream"));
  $("scenario")?.addEventListener("click", () => {
    state.changed = !state.changed;
    storedScenario(state.changed);
    showTrace(scenario.foundation, "downstream", state.changed);
  });
}

function fitScale(target = scene) {
  return Math.min((viewport.clientWidth - 14) / target.width, (viewport.clientHeight - 14) / target.height, 1.12);
}

function paintCamera(smooth = false) {
  world.classList.toggle("sailing", smooth && !reduced.matches);
  if (scene.art) constrainSurfaceCamera();
  paintMapPlanes();
  if (scene.art) {
    const light = $("surface-light");
    const drift = offset => Math.max(-30, Math.min(30, offset * .10));
    light.style.transform = `translate(${drift(camera.x)}px, ${drift(camera.y)}px)`;
  }
  $("zoom-label").value = zoomPercent(camera.zoom / fitScale());
  if (!viewport.classList.contains("diving")) positionFinancePreview();
  if (!financeActive && !viewport.classList.contains("diving") && !mapShade.getAnimations().length) {
    mapShade.style.opacity = zoomShade();
  }
}

function fitMap(center) {
  mapWheelZoom.cancel();
  const target = scene.items.find(item => item.node.id === center);
  const fit = fitScale();
  const zoom = scene.art ? fit * depthZoomRange.min
    : target && scene.items.length <= 2 ? Math.min(1.05, fit * 1.2) : fit;
  const x = target && scene.items.length === 1 ? target.x : scene.width / 2;
  const y = target && scene.items.length === 1 ? target.y : scene.height / 2;
  camera = { zoom, x: viewport.clientWidth / 2 - x * zoom, y: viewport.clientHeight / 2 - y * zoom };
  paintCamera(Boolean(center) && !scene.art);
}

function render(options = {}) {
  document.body.dataset.layer = state.layer;
  $("map-viewport").classList.toggle("tracing", Boolean(state.trace));
  $("inspector").hidden = !isDesk;
  $("back-to-map").hidden = !isDesk;
  document.body.classList.toggle("desk-open", Boolean(isDesk));
  document.title = isDesk && state.selected ? byId[state.selected].title + " · Море решений" : "Море решений";
  setCurrentLayer(state.layer);
  renderScene();
  renderInspector();
  if (options.fit) fitMap(options.center);
  else paintCamera();
}

function zoomTo(zoom, x, y, target) {
  const ratio = zoom / camera.zoom;
  const focus = scene.art && target && zoom > camera.zoom && scene.items.find(item => item.node.id === target);
  if (focus) {
    const remaining = depthZoomRange.max - camera.zoom;
    const approach = Math.min(1, (zoom - camera.zoom) / remaining);
    function frame(origin, position, midpoint) {
      const current = origin + position * camera.zoom;
      return current + (midpoint - current) * approach - position * zoom;
    }
    camera = { zoom, x: frame(camera.x, focus.x, viewport.clientWidth / 2),
      y: frame(camera.y, focus.y, viewport.clientHeight / 2) };
  } else camera = { zoom, x: x - (x - camera.x) * ratio, y: y - (y - camera.y) * ratio };
  paintCamera();
}

function zoomBy(multiplier, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
  mapWheelZoom.cancel();
  const fit = fitScale();
  const zoom = Math.max(fit * depthZoomRange.min, Math.min(fit * depthZoomRange.max, camera.zoom * multiplier));
  zoomTo(zoom, x, y);
}

function moveDraggedCard(clientX, clientY) {
  const bounds = viewport.getBoundingClientRect();
  moveSurfaceCard(drag.item, (clientX - bounds.left - camera.x) / camera.zoom + drag.offsetX,
    (clientY - bounds.top - camera.y) / camera.zoom + drag.offsetY);
}

function panWhileDragging() {
  const { clientX, clientY } = drag;
  const bounds = viewport.getBoundingClientRect();
  const speed = (point, low, high) => Math.min(16, Math.max(0, (low + 42 - point) / 3))
    - Math.min(16, Math.max(0, (point - high + 42) / 3));
  const x = camera.x;
  const y = camera.y;
  camera.x += speed(clientX, bounds.left, bounds.right);
  camera.y += speed(clientY, bounds.top, bounds.bottom);
  constrainSurfaceCamera();
  if (camera.x !== x || camera.y !== y) {
    paintCamera();
    moveDraggedCard(clientX, clientY);
  }
  dragFrame = requestAnimationFrame(panWhileDragging);
}

for (const layer of layers) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "layer-button";
  button.dataset.layer = layer.id;
  button.textContent = layer.label;
  button.addEventListener("click", () => {
    if (financeActive) {
      sendFinance("layer", layer.id);
      return;
    }
    const before = state.layer;
    diveDesk = null;
    resetDive();
    setLayer(layer.id);
    if (before !== layer.id && !reduced.matches) {
      const water = $("map-water");
      water.dataset.tint = before;
      water.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease-out" });
    }
  });
  $("layer-nav").append(button);
}

document.querySelector(".brand").addEventListener("click", event => {
  if (!financeActive) return;
  event.preventDefault();
  closeFinance();
});
financeDesk.src = "../dashboard/index.html?embed=sea";

$("zoom-in").addEventListener("click", () => zoomBy(1.25));
$("zoom-out").addEventListener("click", () => zoomBy(.8));
$("fit").addEventListener("click", () => fitMap());
viewport.addEventListener("wheel", event => {
  if (event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  if (drag) return;
  const rect = viewport.getBoundingClientRect();
  zoomBy(Math.exp(-event.deltaY * .002), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });
viewport.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0 || viewport.classList.contains("diving")) return;
  mapWheelZoom.cancel();
  skipClick = false;
  const card = event.target.closest(".surface-card[data-node]");
  const item = card ? scene.items.find(entry => entry.node.id === card.dataset.node) : null;
  const bounds = viewport.getBoundingClientRect();
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, item,
    left: item?.x ?? camera.x, top: item?.y ?? camera.y,
    offsetX: item && item.x - (event.clientX - bounds.left - camera.x) / camera.zoom,
    offsetY: item && item.y - (event.clientY - bounds.top - camera.y) / camera.zoom };
});
viewport.addEventListener("pointermove", event => {
  if (event.pointerId !== drag?.id) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!skipClick) {
    if (Math.hypot(dx, dy) < 6) return;
    skipClick = true;
    viewport.setPointerCapture(event.pointerId);
    if (drag.item) {
      drag.item.element.classList.add("dragging");
      dragFrame = requestAnimationFrame(panWhileDragging);
    }
    else viewport.classList.add("panning");
  }
  if (drag.item) {
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    moveDraggedCard(event.clientX, event.clientY);
  } else {
    camera.x = drag.left + dx;
    camera.y = drag.top + dy;
    paintCamera();
  }
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
  window.addEventListener(type, event => {
    if (event.pointerId !== drag?.id) return;
    cancelAnimationFrame(dragFrame);
    if (drag.item && skipClick) {
      drag.item.element.classList.remove("dragging");
      if (type === "pointerup") saveSurfacePosition(drag.item);
      else moveSurfaceCard(drag.item, drag.left, drag.top);
    }
    drag = null;
    viewport.classList.remove("panning");
    setTimeout(() => { skipClick = false; }, 0);
  });
}
viewport.addEventListener("keydown", event => {
  const step = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] }[event.key];
  if (!step) return;
  const card = event.target.closest(".surface-card[data-node]");
  const item = card && scene.items.find(entry => entry.node.id === card.dataset.node);
  if (item) {
    event.preventDefault();
    moveSurfaceCard(item, item.x - step[0] / camera.zoom, item.y - step[1] / camera.zoom);
    saveSurfacePosition(item);
    return;
  }
  if (event.target !== viewport) return;
  event.preventDefault();
  camera.x += step[0];
  camera.y += step[1];
  paintCamera();
});

const mapWheelZoom = createWheelZoom({
  read: () => camera.zoom,
  base: () => fitScale(),
  apply(value, anchor) {
    const bounds = viewport.getBoundingClientRect();
    zoomTo(value, anchor.x - bounds.left, anchor.y - bounds.top, diveDesk);
  },
});
const resetDive = bindDepthWheel(viewport, {
  getLayer: wheelDepth,
  count: isDesk ? depths.length : 3,
  magnify(distance, event) {
    if (drag) return true;
    if (!isDesk && distance > 0) diveDesk = operationAt(event);
    if (distance < 0) diveDesk = null;
    return mapWheelZoom.move(distance, event);
  },
  preview: showDiveProgress,
  navigate(index) {
    if (isDesk) return setLayer(depths[index]);
    if (index === 0) return setLayer("sea");
    return openDesk(diveDesk ?? "op.press") === true ? undefined : false;
  },
});

if (isDesk) showDesk(requested);
else render({ fit: true });
if (!isDesk && surroundContext) {
  const tiles = [...atlas.querySelectorAll("img")];
  Promise.all(tiles.map(tile => tile.decode())).then(() => {
    const source = document.createElement("canvas");
    source.width = 512;
    source.height = 288;
    const context = source.getContext("2d");
    for (const [index, tile] of tiles.entries()) {
      context.drawImage(tile, (index % 2) * 256, Math.floor(index / 2) * 144, 256, 144);
    }
    panoramaSource = source;
    paintMapPlanes();
  }).catch(() => { /* The source tiles still render independently. */ });
}
let viewportSize = "";
new ResizeObserver(() => {
  const size = viewport.clientWidth + "/" + viewport.clientHeight;
  if (size === viewportSize || financeActive) return;
  viewportSize = size;
  renderScene();
  fitMap();
}).observe(viewport);
reduced.addEventListener("change", renderScene);
