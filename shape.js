// SVG вставляється в сторінку прихованим, браузер рахує криві й трансформації,
// ми знімаємо точки з рівним кроком
function parseSVG(txt, name) {
  const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
  const src = doc.documentElement;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', BASE_W);
  svg.setAttribute('height', BASE_H);
  const vb = src.getAttribute('viewBox');
  if (vb) svg.setAttribute('viewBox', vb);
  svg.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
  svg.innerHTML = src.innerHTML;
  document.body.appendChild(svg);

  const els = svg.querySelectorAll('path, polyline, polygon, line, rect, circle, ellipse');
  const out = [];

  els.forEach(el => {
    const len = el.getTotalLength();
    const m = el.getCTM();
    const n = max(2, ceil(len / STEP));
    let cur = [];
    let prev = null;

    for (let k = 0; k <= n; k++) {
      let p = el.getPointAtLength(len * k / n);
      if (m) p = p.matrixTransform(m);
      if (prev && dist(prev.x, prev.y, p.x, p.y) > STEP * 4) {
        if (cur.length > 1) out.push(cur);
        cur = [];
      }
      cur.push({ x: p.x, y: p.y });
      prev = p;
    }
    if (cur.length > 1) out.push(cur);
  });

  svg.remove();
  console.log(name, '| елементів:', els.length, '| ліній:', out.length);
  return out;
}

function bounds(lines) {
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const ln of lines) for (const p of ln) {
    xMin = min(xMin, p.x); xMax = max(xMax, p.x);
    yMin = min(yMin, p.y); yMax = max(yMax, p.y);
  }
  return { xMin, xMax, yMin, yMax };
}

// дихання: рухаються тільки точки кривої (лівіше xCut), рамка стоїть
function deform(shape, b, tm) {
  const { xMin, xMax, yMin, yMax } = shape.b;
  const xCut = xMin + 0.4 * (xMax - xMin);
  const amp = ui.amp.value();
  const fr = ui.freq.value();
  const sp = ui.speed.value();

  return shape.lines.map(ln => ln.map(p => {
    if (p.x >= xCut) return p;
    const t = (p.y - yMin) / (yMax - yMin);
    const w = sin(PI * t);
    const dx = amp * w * (
      b[1] * sin(t * fr * TWO_PI + tm * sp) +
      0.5 * b[2] * sin(t * fr * 5 * PI - tm * sp * 2.3)
    );
    return { x: p.x + dx, y: p.y };
  }));
}

// найлівіший перетин горизонталі y з контуром
function edgeX(lines, dx, y) {
  let best = Infinity;
  for (const ln of lines) {
    for (let k = 0; k < ln.length - 1; k++) {
      const a = ln[k], b = ln[k + 1];
      if (a.y === b.y) continue;
      if ((y - a.y) * (y - b.y) > 0) continue;
      const x = a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y);
      if (x < best) best = x;
    }
  }
  return best === Infinity ? null : best + dx;
}

// масштаб по осях: x·W/1080, y·H/1350, рамка масштабується разом з кривою
function scaleShape(s, sx, sy) {
  if (sx === 1 && sy === 1) return s;
  return {
    lines: s.lines.map(ln => ln.map(p => ({ x: p.x * sx, y: p.y * sy }))),
    b: { xMin: s.b.xMin * sx, xMax: s.b.xMax * sx, yMin: s.b.yMin * sy, yMax: s.b.yMax * sy }
  };
}

function refit() {
  const sx = W / BASE_W;
  const sy = H / BASE_H;
  shapes = baseShapes.map(s => scaleShape(s, sx, sy));
  fitW = W;
  fitH = H;
}
