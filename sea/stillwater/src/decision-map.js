import * as THREE from 'three';
import './decision-map.css';

const markerWorld = new THREE.Vector3(9, .07, -19);
const overview = () => ({ x: -5, z: -31, distance: Math.min(148, 63 * Math.max(1, .84 * innerHeight / innerWidth)) });
const closeDistance = 14;
const diveDistance = 8;
const pitch = 1.02;
const yaw = .19;

export function createDecisionMap(canvas, uniforms, lagoon) {
  document.documentElement.lang = 'ru';
  document.title = 'Лагуна';
  document.body.classList.add('decision-map');
  const root = document.createElement('div');
  root.id = 'lagoon-map';
  root.innerHTML = `
    <div class="lagoon-heading">
      <h1>Лагуна</h1>
    </div>
    <button id="press-point" class="lagoon-point" type="button" hidden>
      <span class="lagoon-point-caption">Купить пресс?</span><span class="lagoon-point-pin" aria-hidden="true"></span>
    </button>
    <nav class="lagoon-controls" aria-label="Камера">
      <button id="lagoon-zoom-out" type="button" aria-label="Отдалить">−</button>
      <button id="lagoon-zoom-in" type="button" aria-label="Приблизить">+</button>
      <button id="lagoon-focus" type="button" aria-label="Приблизиться к точке">К точке</button>
      <button id="lagoon-overview" type="button">Общий вид</button>
    </nav>
    <section id="lagoon-calculation" class="lagoon-calculation" aria-label="Расчёт заказа" hidden>
      <div class="lagoon-calculation-bar"><button id="lagoon-return" type="button">← К лагуне</button></div>
      <iframe id="lagoon-desk" src="../../../dashboard/index.html?embed=lagoon" title="Финансовый стол Smile Koltushi"></iframe>
    </section>`;
  document.body.append(root);

  const point = root.querySelector('#press-point');
  const desk = root.querySelector('#lagoon-calculation');
  const frame = root.querySelector('#lagoon-desk');
  const back = root.querySelector('#lagoon-return');
  const current = overview();
  const target = { ...current };
  const projected = new THREE.Vector3();
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  let drag;
  let returnFocus;
  let divePending = false;

  function isNearMarker(view) {
    return Math.hypot(view.x - markerWorld.x, view.z - markerWorld.z) <= 4;
  }

  function setZoom(amount, overPoint = false) {
    const wasAtMarkerLimit = target.distance === diveDistance && isNearMarker(target);
    const distance = target.distance * Math.exp(amount);
    target.distance = distance <= diveDistance + .006 ? diveDistance : Math.min(Math.max(96, overview().distance), distance);
    if (amount < 0 && (overPoint || isNearMarker(target))) {
      target.x = markerWorld.x;
      target.z = markerWorld.z;
      if (target.distance === diveDistance && !wasAtMarkerLimit) divePending = true;
    }
    if (amount > 0) divePending = false;
  }

  function closeDesk() {
    desk.hidden = true;
    canvas.inert = false;
    for (const item of root.children) if (item !== desk) item.inert = false;
    (returnFocus ?? point).focus({ preventScroll: true });
  }

  function openDesk() {
    divePending = false;
    Object.assign(target, current);
    returnFocus = root.contains(document.activeElement) ? document.activeElement : point;
    desk.hidden = false;
    canvas.inert = true;
    for (const item of root.children) if (item !== desk) item.inert = true;
    back.focus({ preventScroll: true });
  }
  point.addEventListener('click', openDesk);
  back.addEventListener('click', closeDesk);
  addEventListener('message', event => {
    if (!desk.hidden && event.origin === location.origin && event.source === frame.contentWindow
      && event.data?.channel === 'decision-sea-desk' && event.data.type === 'surface') closeDesk();
  });
  addEventListener('keydown', event => {
    if (event.code === 'Escape' && !desk.hidden) closeDesk();
    if (!desk.hidden || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return;
    event.preventDefault();
    const step = target.distance * .07;
    const x = Number(event.code === 'ArrowRight') - Number(event.code === 'ArrowLeft');
    const z = Number(event.code === 'ArrowDown') - Number(event.code === 'ArrowUp');
    pan(x * step, z * step);
  });

  root.querySelector('#lagoon-focus').onclick = () => {
    divePending = false;
    Object.assign(target, { x: markerWorld.x, z: markerWorld.z, distance: closeDistance });
  };
  root.querySelector('#lagoon-overview').onclick = () => {
    divePending = false;
    Object.assign(target, overview());
  };
  root.querySelector('#lagoon-zoom-out').onclick = () => setZoom(.23);
  root.querySelector('#lagoon-zoom-in').onclick = () => setZoom(-.23);
  function wheel(event) {
    event.preventDefault();
    if (drag) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    const delta = THREE.MathUtils.clamp(event.deltaY * unit, -180, 180);
    setZoom(delta * .0019, event.currentTarget === point);
  }
  canvas.addEventListener('wheel', wheel, { passive: false });
  point.addEventListener('wheel', wheel, { passive: false });

  function pan(x, z) {
    divePending = false;
    target.x = THREE.MathUtils.clamp(target.x + x * cos + z * sin, -65, 65);
    target.z = THREE.MathUtils.clamp(target.z + z * cos - x * sin, -85, 22);
  }
  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('panning');
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== drag?.id) return;
    const step = 1.1 * current.distance / innerHeight;
    pan((drag.x - event.clientX) * step, (drag.y - event.clientY) * step);
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => {
      if (event.pointerId !== drag?.id) return;
      drag = null;
      canvas.classList.remove('panning');
    });
  }

  function update(dt) {
    for (const key of Object.keys(current)) {
      current[key] = THREE.MathUtils.damp(current[key], target[key], 7, dt);
      if (Math.abs(current[key] - target[key]) < .006) current[key] = target[key];
    }
    const vertical = current.distance * Math.sin(pitch);
    const horizontal = current.distance * Math.cos(pitch);
    uniforms.uCameraPosition.value.set(current.x + horizontal * sin, vertical, current.z + horizontal * cos);
    uniforms.uHeight.value = vertical;
    uniforms.uPitch.value = pitch;
    uniforms.uYaw.value = yaw;
    if (divePending && current.distance === diveDistance
      && current.x === markerWorld.x && current.z === markerWorld.z) openDesk();
  }

  function positionPoint() {
    projected.copy(markerWorld).applyMatrix4(lagoon.viewProjection);
    const x = (projected.x + 1) * innerWidth / 2;
    const y = (1 - projected.y) * innerHeight / 2;
    const visible = projected.z > -1 && projected.z < 1 && x > 0 && x < innerWidth && y > 0 && y < innerHeight;
    point.toggleAttribute('hidden', !visible);
    if (visible) point.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-100%)`;
  }

  update(0);
  window.lagoonMapDiagnostics = () => ({ current: { ...current }, target: { ...target },
    point: markerWorld.toArray(), pitch, yaw, calculationOpen: !desk.hidden });
  return { update, positionPoint, suspended: () => !desk.hidden };
}
