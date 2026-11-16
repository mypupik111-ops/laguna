"use strict";

const depthZoomRange = { min: .4, max: 2 };

function zoomPercent(relative) {
  const percent = Math.round(relative * 100);
  if (relative > depthZoomRange.min && percent === 40) return "41%";
  if (relative < depthZoomRange.max && percent === 200) return "199%";
  return percent + "%";
}

function seaChartGeometry(width) {
  const narrow = width < 550;
  return narrow
    ? { width: 480, height: 530, cardWidth: 201 }
    : { width: 810, height: 465, cardWidth: 238 };
}

function seaSurfaceGeometry(viewportWidth, viewportHeight) {
  const width = Math.max(1, viewportWidth - 14);
  const height = Math.max(1, viewportHeight - 14);
  const narrow = width < 620;
  const scale = Math.min(viewportWidth / 3348, viewportHeight / 1880) / depthZoomRange.min;
  const artWidth = 3348 * scale;
  const artHeight = 1880 * scale;
  const left = (width - artWidth) / 2;
  const top = (height - artHeight) / 2;
  const cardWidth = narrow ? Math.min(193, width * .58) : 238;
  const markerX = left + (narrow ? 900 : 1250) * scale;
  const markerY = top + (narrow ? 720 : 560) * scale;
  return {
    width, height, cardWidth,
    art: { left, top, width: artWidth, height: artHeight },
    pin: { x: left + 960 * scale, y: top + 581 * scale },
    marker: { x: markerX, y: markerY },
  };
}

function surfaceCardSize(zoom) {
  return .8 + (zoom - depthZoomRange.min) * .4;
}

function createWheelZoom({ read, base, apply, finish = () => {} }) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let goal = null;
  let anchor;
  let lastTime = 0;

  function cancel() {
    cancelAnimationFrame(frame);
    frame = 0;
    goal = null;
  }

  function step(time) {
    const current = read();
    const elapsed = Math.max(0, Math.min(32, time - lastTime));
    lastTime = time;
    const next = current + (goal - current) * (1 - Math.exp(-elapsed / 35));
    if (Math.abs(goal - next) <= .002) {
      apply(goal, anchor);
      cancel();
      finish();
    } else {
      apply(next, anchor);
      frame = requestAnimationFrame(step);
    }
  }

  return {
    cancel,
    move(distance, event) {
      const initial = read();
      const previous = goal ?? initial;
      const scale = base();
      const next = Math.max(scale * depthZoomRange.min,
        Math.min(scale * depthZoomRange.max, previous * Math.exp(distance * .003)));
      if (Math.abs(next - initial) < .0001 && goal === null) return false;
      anchor = { x: event.clientX, y: event.clientY };
      if (reduced.matches) {
        apply(next, anchor);
        finish();
        return true;
      }
      goal = next;
      if (!frame) {
        lastTime = performance.now();
        frame = requestAnimationFrame(step);
      }
      return true;
    },
  };
}

function bindDepthWheel(viewport, { getLayer, count, magnify, preview, navigate }) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const threshold = 450;
  let amount = 0;
  let target = null;
  let progress = 0;
  let frame = 0;
  let lastTime = 0;
  let timer;
  let lockedUntil = 0;
  let leaving = false;

  function reset() {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    frame = 0;
    if (leaving) return;
    amount = 0;
    progress = 0;
    target = null;
    preview(null, 0);
  }

  function step(time) {
    frame = 0;
    const goal = Math.abs(amount) / threshold;
    const elapsed = Math.max(0, Math.min(32, time - lastTime));
    lastTime = time;
    progress += (goal - progress) * (reduced.matches ? 1 : 1 - Math.exp(-elapsed / 44));
    if (Math.abs(progress - goal) < .004) progress = goal;
    if (progress === 0 && goal === 0) {
      reset();
      return;
    }
    preview(target, progress);
    if (progress === 1) {
      lockedUntil = performance.now() + 140;
      leaving = navigate(target) === false;
      reset();
    } else if (progress !== goal) frame = requestAnimationFrame(step);
  }

  function render() {
    if (frame) return;
    lastTime = performance.now();
    if (reduced.matches) step(lastTime);
    else frame = requestAnimationFrame(step);
  }

  function settle() {
    if (leaving || Math.abs(amount) === threshold) return;
    amount = 0;
    render();
  }

  viewport.addEventListener("wheel", event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (leaving || performance.now() < lockedUntil || event.deltaY === 0) return;
    const current = getLayer();
    const units = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? 320 : 1;
    const distance = -Math.max(-155, Math.min(155, event.deltaY * units));
    const incoming = current + Math.sign(distance);
    if (target !== null && incoming !== target) {
      amount = Math.sign(amount) * Math.max(0, Math.abs(amount) - Math.abs(distance));
      render();
      return;
    }
    if (target === null && magnify(distance, event)) return;
    if (incoming < 0 || incoming >= count) return;
    target = incoming;
    amount = Math.max(-threshold, Math.min(threshold, amount + distance));
    clearTimeout(timer);
    timer = setTimeout(settle, 760);
    render();
  }, { passive: false });

  window.addEventListener("keyup", event => {
    if (event.key === "Control" || event.key === "Meta") settle();
  });
  window.addEventListener("blur", settle);
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    leaving = false;
    lockedUntil = 0;
    reset();
  });
  return () => {
    if (leaving) {
      leaving = false;
      lockedUntil = 0;
    }
    reset();
  };
}
