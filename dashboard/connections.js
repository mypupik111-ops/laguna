"use strict";

function createConnections(board, layer) {
  const operationEdges = [
    ["costs", "cash"], ["decision", "cash"], ["decision", "scenarios"],
    ["cash", "result"], ["scenarios", "result"],
  ];
  let edges = operationEdges;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const ns = "http://www.w3.org/2000/svg";
  let frame = 0;
  let timer = 0;
  let live = false;
  let selectedEdges = null;
  let waitingForLayout = false;
  let layoutRevision = 0;
  let drawKey = "";
  let visualRevision = 0;
  let queuedPlay = null;
  const flowSpeed = 18;
  const flowSpacing = 60;

  function reachable(start, reverse = false) {
    const visited = new Set([start]);
    for (const id of visited) {
      for (const [from, to] of edges) {
        if ((reverse ? to : from) === id) visited.add(reverse ? from : to);
      }
    }
    visited.delete(start);
    return visited;
  }

  function setFocus(id, changed = false) {
    const upstream = id ? reachable(id, true) : new Set();
    const downstream = id ? reachable(id) : new Set();
    selectedEdges = id ? new Map(edges.flatMap(([from, to]) => {
      const key = from + "/" + to;
      if (upstream.has(from) && (to === id || upstream.has(to))) return [[key, "upstream"]];
      if (downstream.has(to) && (from === id || downstream.has(from))) return [[key, "downstream"]];
      return [];
    })) : null;
    if (changed) queuedPlay = { sources: [id] };
    visualRevision++;
    refresh();
    return { upstream, downstream };
  }

  function element(tag, attributes) {
    const node = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  }

  function attachment(group, edge, next) {
    const [x, y] = edge;
    const length = Math.hypot(next[0] - x, next[1] - y);
    if (!length) return;
    const dx = (next[0] - x) / length;
    const dy = (next[1] - y) / length;
    const reach = Math.min(length * .58, 13);
    const point = (along, across) => (x + dx * along - dy * across) + "," + (y + dy * along + dx * across);
    const branches = [-15, -8, 8, 15].map((spread) =>
      "M" + point(.6, spread) + "C" + point(reach * .35, spread * .65) + " "
        + point(reach * .35, spread * .13) + " " + point(reach, 0)).join("");
    group.append(element("path", { d: branches, class: "connection-web" }),
      element("circle", { cx: x, cy: y, r: 1.8, class: "connection-anchor" }));
  }

  function smoothPath(points) {
    const along = ([x, y], [a, b], distance) => {
      const length = Math.hypot(a - x, b - y);
      const fraction = length ? Math.min(distance / length, .48) : 0;
      return [x + (a - x) * fraction, y + (b - y) * fraction].join(",");
    };
    let path = "M" + points[0].join(",");
    for (let i = 1; i < points.length - 1; i++) {
      const corner = points[i];
      path += "L" + along(corner, points[i - 1], 18)
        + "Q" + corner.join(",") + " " + along(corner, points[i + 1], 18);
    }
    return path + "L" + points.at(-1).join(",");
  }

  // Route between card edges through the gutters, including custom arrangements.
  function route(source, target, boxes, sourceFraction, targetFraction) {
    const ports = ({ x, y, right, bottom }, fraction) => {
      const cx = x + (right - x) * fraction;
      const cy = y + (bottom - y) * fraction;
      return [[[x, cy], [x - 4, cy]], [[right, cy], [right + 4, cy]],
        [[cx, y], [cx, y - 4]], [[cx, bottom], [cx, bottom + 4]]];
    };
    const starts = ports(source, sourceFraction);
    const ends = ports(target, targetFraction);
    const padding = 2;
    const obstacles = boxes.map(({ x, y, right, bottom }) =>
      ({ x: x - padding, y: y - padding, right: right + padding, bottom: bottom + padding }));
    const portsX = [...starts, ...ends].map(([, [x]]) => x);
    const portsY = [...starts, ...ends].map(([, [, y]]) => y);
    const xs = [...new Set([...portsX, ...obstacles.flatMap((b) => [b.x, b.right])])].sort((a, b) => a - b);
    const ys = [...new Set([...portsY, ...obstacles.flatMap((b) => [b.y, b.bottom])])].sort((a, b) => a - b);
    const inside = (x, y) => obstacles.some((b) => x > b.x && x < b.right && y > b.y && y < b.bottom);
    const nodes = ys.map((y) => xs.map((x) => inside(x, y) ? null : { x, y, distance: Infinity }));
    const locate = ([x, y]) => nodes[ys.indexOf(y)][xs.indexOf(x)];
    const goals = new Map(ends.map(([edge, port]) => [locate(port), edge]));
    const queue = [];
    for (const [edge, port] of starts) {
      const node = locate(port);
      if (!node) continue;
      node.distance = 0;
      node.previous = { x: edge[0], y: edge[1] };
      queue.push(node);
    }
    while (queue.length) {
      queue.sort((a, b) => b.distance - a.distance);
      const node = queue.pop();
      if (goals.has(node)) {
        const points = [goals.get(node)];
        for (let step = node; step; step = step.previous) points.unshift([step.x, step.y]);
        const corners = points.filter((point, index) => {
          if (index === 0 || index === points.length - 1) return true;
          const before = points[index - 1];
          const after = points[index + 1];
          return !(before[0] === point[0] && point[0] === after[0])
            && !(before[1] === point[1] && point[1] === after[1]);
        });
        return corners;
      }
      const ix = xs.indexOf(node.x);
      const iy = ys.indexOf(node.y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = nodes[iy + dy]?.[ix + dx];
        if (!next || inside((node.x + next.x) / 2, (node.y + next.y) / 2)) continue;
        const distance = node.distance + Math.abs(node.x - next.x) + Math.abs(node.y - next.y);
        if (distance >= next.distance) continue;
        next.distance = distance;
        next.previous = node;
        if (!queue.includes(next)) queue.push(next);
      }
    }
    return null;
  }

  function draw() {
    const origin = board.getBoundingClientRect();
    const scale = origin.width / board.offsetWidth || 1;
    const boxes = new Map([...board.querySelectorAll(".card")].map((card) => {
      const rect = card.getBoundingClientRect();
      return [card.id, { x: (rect.left - origin.left) / scale, y: (rect.top - origin.top) / scale,
        right: (rect.right - origin.left) / scale, bottom: (rect.bottom - origin.top) / scale }];
    }));
    const canvas = Boolean(board.closest(".canvas-view"));
    const key = JSON.stringify([visualRevision, canvas, reduced.matches, [...boxes.values()]]);
    if (key === drawKey) return;
    drawKey = key;
    const groups = document.createDocumentFragment();
    for (const [source, target] of edges) {
      const fraction = (id, index) => {
        const related = edges.filter((edge) => edge[index] === id);
        return (related.findIndex((edge) => edge[0] === source && edge[1] === target) + 1) / (related.length + 1);
      };
      const points = route(boxes.get(source), boxes.get(target), [...boxes.values()], fraction(source, 0), fraction(target, 1));
      if (!points) continue;
      const d = smoothPath(points);
      const group = document.createElementNS(ns, "g");
      group.dataset.from = source;
      group.dataset.to = target;
      const relation = selectedEdges?.get(source + "/" + target);
      if (selectedEdges) group.dataset.relation = relation ?? "muted";
      for (const name of ["line", "pulse"]) {
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        path.setAttribute("pathLength", "100");
        path.setAttribute("class", "connection-" + name);
        group.append(path);
      }
      if (canvas) {
        attachment(group, points[0], points[1]);
        attachment(group, points.at(-1), points.at(-2));
      }
      const [x, y] = points.at(-1);
      const [a, b] = points.at(-2);
      const length = Math.hypot(x - a, y - b) || 1;
      const dx = (x - a) / length;
      const dy = (y - b) / length;
      group.append(element("path", {
        class: "connection-direction",
        d: "M" + (x - dx * 12 - dy * 4) + "," + (y - dy * 12 + dx * 4)
          + "L" + (x - dx * 3) + "," + (y - dy * 3)
          + "L" + (x - dx * 12 + dy * 4) + "," + (y - dy * 12 - dx * 4),
      }));
      if (!reduced.matches && (canvas ? live && (!selectedEdges || relation) : relation)) {
        group.querySelector(".connection-pulse").classList.add("continuous");
      }
      groups.append(group);
    }
    layer.replaceChildren(groups);
    for (const pulse of layer.querySelectorAll(".connection-pulse")) {
      const length = pulse.getTotalLength() * scale;
      // One dash period is shared by all pulses on this link, so the loop
      // wraps without an empty interval or a visible reset.
      const count = Math.max(2, Math.round(length / flowSpacing));
      const period = 100 / count;
      const segment = Math.min(period * .44, 1700 / Math.max(1, length));
      const duration = Math.max(1.1, length / count / flowSpeed);
      pulse.style.setProperty("--flow-dashes", `${segment} ${period - segment}`);
      pulse.style.setProperty("--flow-end", -period + "px");
      pulse.style.setProperty("--flow-duration", duration + "s");
      pulse.style.setProperty("--flow-delay", -(performance.now() / 1000 % duration) + "s");
    }
  }

  function followLayout(animations) {
    if (!animations.length && !waitingForLayout) {
      refresh();
      return;
    }
    const revision = ++layoutRevision;
    waitingForLayout = true;
    cancelAnimationFrame(frame);
    layer.classList.add("connections-moving");
    Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (revision !== layoutRevision) return;
      waitingForLayout = false;
      refresh();
    });
  }

  function refresh() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (waitingForLayout || board.closest("[hidden]") || board.matches(".editing, .gesture-drag")) return;
      draw();
      layer.classList.remove("connections-moving");
      if (queuedPlay) {
        const { sources } = queuedPlay;
        queuedPlay = null;
        playGroups(sources);
      }
    });
  }

  function play(sources = null) {
    if (board.matches(".editing, .gesture-drag")) return;
    if (waitingForLayout) {
      queuedPlay = { sources };
      return;
    }
    draw();
    playGroups(sources);
  }

  function playGroups(sources) {
    clearTimeout(timer);
    for (const group of layer.children) {
      group.firstElementChild.classList.remove("lit");
      group.querySelector(".connection-pulse").classList.remove("playing");
    }
    const affected = sources && new Set(sources);
    const groups = [...layer.children].filter((group) => {
      if (group.dataset.relation === "muted") return false;
      if (!affected) return true;
      if (!affected.has(group.dataset.from)) return false;
      affected.add(group.dataset.to);
      return true;
    });
    groups.forEach((group) => {
      group.firstElementChild.classList.add("lit");
      const pulse = group.querySelector(".connection-pulse");
      if (!reduced.matches && (live || !board.closest(".canvas-view"))) pulse.classList.add("playing");
    });
    timer = setTimeout(() => {
      for (const group of groups) {
        group.firstElementChild.classList.remove("lit");
        group.querySelector(".connection-pulse").classList.remove("playing");
      }
    }, 3500);
  }

  const observer = new ResizeObserver(refresh);
  observer.observe(board);
  reduced.addEventListener("change", refresh);
  return { refresh, play, setFocus, followLayout, setEdges(next = operationEdges) {
    edges = next;
    queuedPlay = null;
    visualRevision++;
  }, setLive(value) {
    if (live !== value) visualRevision++;
    live = value;
    refresh();
  } };
}
