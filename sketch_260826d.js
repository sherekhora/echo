let cam;

// Контент (відео/лінії/текст) завжди має висоту CONTENT_H — це система
// координат, у якій рахуються криві й верстка. Полотно росте вгору понад
// неї на висоту плашки, а сам контент малюється зсунутим на bandPx вниз
// через translate(). Це тримає координати кривих незалежними від того,
// яка зараз висота плашки.
const CONTENT_H = 720;
let bandPx = 0;

let bodySeg;
let maskPixels = null;
let maskW = 0, maskH = 0;
let maskAlphaVaries = null;
let modelReady = false;

let maskBounds = [];

let curves = [];
let generatedIndex = -1;

let prevBase = [null, null];
let blueCurve = null; // добудована лінія в режимі «силует»

// як показувати значення слайдера поруч із ним
const FMT = {
  zoom:    function (v) { return (v / 100).toFixed(2) + '×'; },
  inertia: function (v) { return (v / 100).toFixed(2); }
};

function setup() {
  let c = createCanvas(1280, CONTENT_H);
  c.parent('holder');
  pixelDensity(1);

  // роздільність просимо через constraints; .size() змінює лише розмір
  // HTML-елемента і на сам потік не впливає
  cam = createCapture({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  cam.hide();

  ml5.bodySegmentation('SelfieSegmentation', { maskType: 'background' }, function (model) {
    bodySeg = model;
    modelReady = true;
    bodySeg.detectStart(cam, gotMask);
  });
}

function gotMask(result) {
  if (!result || !result.mask) return;
  let m = result.mask;
  m.loadPixels();
  maskPixels = m.pixels;
  maskW = m.width;
  maskH = m.height;

  if (maskAlphaVaries === null) {
    let mn = 255, mx = 0;
    for (let i = 3; i < maskPixels.length; i += 4 * 97) {
      let a = maskPixels[i];
      if (a < mn) mn = a;
      if (a > mx) mx = a;
    }
    maskAlphaVaries = (mx - mn) > 40;
  }
}

function draw() {
  // плашка задається в пунктах відносно макета — той самий коефіцієнт k,
  // що й усюди в тексті; звідси й розмір полотна для цього кадру
  let k = width / fieldNum('artboard');
  bandPx = checked('showBanner') ? fieldNum('bandH') * k : 0;

  let totalH = round(CONTENT_H + bandPx);
  if (height !== totalH) resizeCanvas(width, totalH);

  background(0);

  // весь контент малюється в системі координат 0..CONTENT_H, зсунутій
  // на bandPx вниз — тому криві й верстка не залежать від висоти плашки
  push();
  translate(0, bandPx);

  drawSource();

  filter(GRAY);
  filter(BLUR, val('blur'));

  loadPixels();
  buildMaskBounds();

  let mode = document.getElementById('mode').value;

  if (mode === 'outline') {
    // силует — це одна лінія; друга добудовується тією ж формулою зсуву,
    // що й у режимі трьох ліній, тільки джерелом є краї маски
    curves = [];
    generatedIndex = -1;
    if (maskBounds.length) {
      let inertia = val('inertia') / 100;
      let Lc = stabilize(smoothCurve(silhouetteEdge(false), val('smooth')), 0, inertia);
      let Rc = stabilize(smoothCurve(silhouetteEdge(true),  val('smooth')), 1, inertia);
      blueCurve = makeThirdCurve(Lc, Rc);
    } else {
      blueCurve = null;
    }
  } else {
    let base = extractBaseCurves();
    let third = makeThirdCurve(base[0], base[1]);

    // синя (добудована) лінія завжди перша зліва — base сортуємо між собою,
    // third ставимо попереду незалежно від її фактичного x
    base.sort(function (p, q) { return meanX(p) - meanX(q); });
    curves = [third].concat(base);
    generatedIndex = 0;
    enforceOrder(curves, val('gap'));
  }

  filter(THRESHOLD, val('threshView') / 255);

  if (checked('hideVideo')) { noStroke(); fill(255); rect(0, 0, width, CONTENT_H); }

  if (checked('showMask')) drawMaskOverlay();

  if (mode === 'outline') {
    drawOutlineText();
    drawOutline();
    drawBlue();
  } else {
    drawColumns();
    drawCurves();
  }

  drawStatus();
  pop();

  // плашка — поза зсувом, її верх завжди на реальному верху полотна
  if (checked('showBanner')) drawBanner(mode);
  refreshLabels();
}

// ---------------------------------------------------------------- джерело + кроп

// drawImage() адресує <video> у ЙОГО власній роздільності (videoWidth/
// videoHeight), а cam.width повертає розмір HTML-елемента. Поки обидва
// збігались (640×480), різниці не було видно; щойно запросили 1280×720 —
// вирізка почала читатись не з тих координат. Тому джерелом істини тут
// може бути тільки videoWidth.
function camW() { return (cam && cam.elt && cam.elt.videoWidth)  || 0; }
function camH() { return (cam && cam.elt && cam.elt.videoHeight) || 0; }

function cropRect() {
  let cw = camW(), ch = camH();
  let z = val('zoom') / 100;

  // найбільший прямокутник із пропорцією полотна, що вміщується в кадр —
  // так картинка не розтягується, навіть якщо камера віддала 4:3
  let ar = width / CONTENT_H;
  let bw = cw, bh = cw / ar;
  if (bh > ch) { bh = ch; bw = ch * ar; }

  let sw = bw / z;
  let sh = bh / z;
  let sx = (cw - sw) * (1 - val('panX') / 100);
  let sy = (ch - sh) * (val('panY') / 100);
  return { sx: sx, sy: sy, sw: sw, sh: sh };
}

function drawSource() {
  if (camW() === 0) return;
  let r = cropRect();
  push();
  translate(width, 0);
  scale(-1, 1);
  image(cam, 0, 0, width, CONTENT_H, r.sx, r.sy, r.sw, r.sh);
  pop();
}

// ---------------------------------------------------------------- маска

function isPerson(mx, my) {
  if (mx < 0 || my < 0 || mx >= maskW || my >= maskH) return false;
  let i = (my * maskW + mx) * 4;
  let v = maskAlphaVaries ? maskPixels[i + 3] : maskPixels[i];
  let on = v > 128;
  return checked('invMask') ? !on : on;
}

function buildMaskBounds() {
  maskBounds = [];
  if (!maskPixels || camW() === 0) return;

  let r = cropRect();

  for (let y = 0; y < CONTENT_H; y++) {
    let my = floor(r.sy + (y / CONTENT_H) * r.sh);
    let x0 = -1, x1 = -1;

    for (let x = 0; x < width; x += 3) {
      let mx = floor(r.sx + ((width - 1 - x) / width) * r.sw);
      if (isPerson(mx, my)) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    maskBounds[y] = (x0 < 0) ? null : [x0, min(x1, width - 2)];
  }
}

function drawMaskOverlay() {
  if (!maskBounds.length) return;
  noStroke();
  fill(255, 0, 120, 60);
  for (let y = 0; y < CONTENT_H; y++) {
    let b = maskBounds[y];
    if (!b) { rect(0, y, width, 1); continue; }
    rect(0, y, b[0], 1);
    rect(b[1], y, width - b[1], 1);
  }
}

// ---------------------------------------------------------------- з кадру

function extractBaseCurves() {
  let inertia = val('inertia') / 100;
  let mode = document.getElementById('lineA').value;
  let out = [];

  // лінія A — край силуету, якщо маска є; інакше відкат на тональну
  let rawA;
  if (mode !== 'tonal' && maskBounds.length) {
    rawA = silhouetteEdge(mode === 'right');
  } else {
    rawA = traceThreshold(val('threshView'), width / 3, val('jump'));
  }
  out.push(stabilize(smoothCurve(rawA, val('smooth')), 0, inertia));

  // лінія B — теж край силуету, завжди правий; відкат на тональну,
  // якщо маски ще немає
  let rawB;
  if (maskBounds.length) {
    rawB = silhouetteEdge(true);
  } else {
    rawB = traceThreshold(val('threshB'), width * 2 / 3, val('jump'));
  }
  out.push(stabilize(smoothCurve(rawB, val('smooth')), 1, inertia));

  return out;
}

// крайня точка маски в кожному рядку; рядки без людини заповнюються
// найближчим відомим значенням, щоб лінія не обривалась над головою
function silhouetteEdge(right) {
  let col = new Array(CONTENT_H);
  let firstKnown = -1;

  for (let y = 0; y < CONTENT_H; y++) {
    let b = maskBounds[y];
    if (b) {
      col[y] = right ? b[1] : b[0];
      if (firstKnown < 0) firstKnown = y;
    } else {
      col[y] = null;
    }
  }
  if (firstKnown < 0) { for (let y = 0; y < CONTENT_H; y++) col[y] = width / 2; return col; }

  for (let y = firstKnown - 1; y >= 0; y--) col[y] = col[y + 1];
  for (let y = firstKnown + 1; y < CONTENT_H; y++) if (col[y] === null) col[y] = col[y - 1];
  return col;
}

function stabilize(col, idx, inertia) {
  if (!prevBase[idx] || prevBase[idx].length !== col.length) {
    prevBase[idx] = col.slice();
    return prevBase[idx].slice();
  }
  let p = prevBase[idx];
  let a = 1 - inertia;
  for (let y = 0; y < col.length; y++) p[y] = p[y] + (col[y] - p[y]) * a;
  return p.slice();
}

function traceThreshold(t, seed, maxJump) {
  let col = new Array(CONTENT_H);
  let midY = floor(CONTENT_H / 2);

  let x = scanRow(midY, t, seed, width);
  col[midY] = x;

  for (let y = midY + 1; y < CONTENT_H; y++) { x = scanRow(y, t, x, maxJump); col[y] = x; }
  x = col[midY];
  for (let y = midY - 1; y >= 0; y--)     { x = scanRow(y, t, x, maxJump); col[y] = x; }
  return col;
}

function scanRow(y, t, seed, window) {
  let lo = 0, hi = width - 2;

  if (checked('useMask') && maskBounds.length) {
    let b = maskBounds[y];
    if (!b) return seed;
    lo = b[0];
    hi = b[1];
  }
  if (hi <= lo) return seed;

  let s = constrain(round(seed), lo, hi);
  for (let d = 0; d <= window; d++) {
    if (s - d >= lo && crosses(s - d, y, t)) return s - d;
    if (s + d <= hi && crosses(s + d, y, t)) return s + d;
  }
  return seed;
}

function crosses(x, y, t) {
  // pixels[] адресує реальний буфер полотна — translate() на нього не
  // впливає, тому рядок контенту y треба перевести в рядок полотна
  // додаванням bandPx, інакше трасування читало б не той рядок
  let ry = y + bandPx;
  let a = pixels[(ry * width + x) * 4];
  let b = pixels[(ry * width + x + 1) * 4];
  return (a <= t && b > t) || (b <= t && a > t);
}

// ---------------------------------------------------------------- добудова

function makeThirdCurve(a, b) {
  // добудована лінія завжди ліворуч: беремо ліву з базових і зсуваємо вліво.
  // Раніше бік обирався за вільним простором, а потім лінія примусово
  // ставилась першою в масиві — і enforceOrder виштовхував решту вправо
  let src = meanX(a) <= meanX(b) ? a : b;
  let dir = -1;

  let variation = val('variation') / 100;
  let offset    = val('offset');
  let deform    = val('deform');

  let shiftY = floor(variation * 70);
  let amp    = 1 + variation * 0.3;
  let m      = meanX(src);
  let half   = CONTENT_H / 2;

  let out = new Array(CONTENT_H);
  for (let y = 0; y < CONTENT_H; y++) {
    let yy = constrain(y + shiftY, 0, CONTENT_H - 1);
    let v  = m + (src[yy] - m) * amp;
    let n  = (noise(y * 0.008, 100) - 0.5) * 2 * variation * 25;

    let t = (y - half) / half;
    let k = max(0, -t); // зсув наростає вище середини, як і має бути ліворуч
    let extra = dir * deform * smoothstep(k);

    out[y] = v + dir * offset + n + extra;
  }
  return out;
}

function smoothstep(k) { return k * k * (3 - 2 * k); }

function meanX(col) {
  let s = 0;
  for (let y = 0; y < col.length; y++) s += col[y];
  return s / col.length;
}

// ---------------------------------------------------------------- спільне

function smoothCurve(col, w) {
  if (w <= 0) return col;
  let out = new Array(col.length);
  for (let y = 0; y < col.length; y++) {
    let sum = 0, count = 0;
    for (let d = -w; d <= w; d++) {
      let yy = y + d;
      if (yy >= 0 && yy < col.length) { sum += col[yy]; count++; }
    }
    out[y] = sum / count;
  }
  return out;
}

function enforceOrder(cs, gap) {
  for (let y = 0; y < CONTENT_H; y++) {
    for (let i = 1; i < cs.length; i++) {
      if (cs[i][y] < cs[i - 1][y] + gap) cs[i][y] = cs[i - 1][y] + gap;
    }
  }
}

// ---------------------------------------------------------------- рендер

// кольори ліній; чекбокси в легенді керують лише видимістю
function lineColorFrame() { return color(224, 35, 26); }
function lineColorGen()   { return color(0, 80, 255); }

function drawCurves() {
  noFill();
  strokeWeight(3 * width / 640);
  for (let i = 0; i < curves.length; i++) {
    let isGen = (i === generatedIndex);
    if (isGen && !checked('showGenLine')) continue;
    if (!isGen && !checked('showFrameLine')) continue;

    stroke(isGen ? lineColorGen() : lineColorFrame());
    beginShape();
    for (let y = 0; y < CONTENT_H; y += 2) vertex(curves[i][y], y);
    endShape();
  }
}

// ---------------------------------------------------------------- режим «силует (обвід)»

// один суцільний штрих: униз уздовж лівого краю маски, тоді вгору
// вздовж правого — саме так виходить арка, що обводить голову й плечі
function drawOutline() {
  if (!checked('showFrameLine')) return;
  let rows = [];
  for (let y = 0; y < CONTENT_H; y++) if (maskBounds[y]) rows.push(y);
  if (!rows.length) return;

  noFill();
  stroke(lineColorFrame());
  strokeWeight(3 * width / 640);
  beginShape();
  for (let i = 0; i < rows.length; i += 2) vertex(maskBounds[rows[i]][0], rows[i]);
  for (let i = rows.length - 1; i >= 0; i -= 2) vertex(maskBounds[rows[i]][1], rows[i]);
  endShape();
}

function drawBlue() {
  if (!blueCurve || !checked('showGenLine')) return;
  noFill();
  stroke(lineColorGen());
  strokeWeight(3 * width / 640);
  beginShape();
  for (let y = 0; y < CONTENT_H; y += 2) vertex(blueCurve[y], y);
  endShape();
}

// дві лінії ділять кадр на три області, по одній групі тексту на кожну.
// межі рахуються заново на кожному рядку:
//   0 — ліворуч від добудованої лінії
//   1 — між нею і силуетом, плюс усе праворуч від силуету (це та сама
//       зв'язна область, тому один потік слів на обидва відрізки)
//   2 — всередині силуету
function outlineSpans(group, yy, xB, pad) {
  let b = maskBounds[yy];

  if (group === 0) return [[0, xB - pad]];

  if (group === 1) {
    return b ? [[xB + pad, b[0] - pad], [b[1] + pad, width]]
             : [[xB + pad, width]];
  }
  return b ? [[b[0] + pad, b[1] - pad]] : [];
}

function drawOutlineText() {
  let k = width / fieldNum('artboard');
  let pad = fieldNum('pad');

  noStroke();
  textFont('Times New Roman');
  textAlign(LEFT, BASELINE);

  for (let i = 0; i < 3; i++) {
    let raw = fieldText('txt' + (i + 1)).trim();
    if (!raw) continue;
    if (i !== 1) raw = raw.toUpperCase(); // 1-й і 3-й — капс, 2-й — як введено

    let words = tokenize(raw);
    let size = fieldNum('size' + (i + 1)) * k;
    let lead = fieldNum('lead' + (i + 1)) * k;
    if (size < 1 || lead < 1) continue;

    textSize(size);
    fill(fieldText('color' + (i + 1)));
    let spaceW = textWidth(' ');

    let wi = 0;
    let blank = false;
    let done = false;

    for (let y = lead; y < CONTENT_H + lead && !done; y += lead) {
      let yy = constrain(round(y - size * 0.32), 0, CONTENT_H - 1);
      let xB = blueCurve ? blueCurve[yy] : 0;

      let spans = outlineSpans(i, yy, xB, pad);
      if (!spans.length) continue;

      if (blank) { blank = false; continue; }

      for (let s = 0; s < spans.length; s++) {
        let L = spans[s][0], R = spans[s][1];
        if (R - L < size * 0.5) continue;

        let picked = [];
        let w = 0;
        while (wi < words.length) {
          if (words[wi] === '\n') { wi++; break; }   // примусовий перенос
          let ww = textWidth(words[wi]);
          let need = picked.length ? w + spaceW + ww : ww;
          if (need > R - L && picked.length) break;
          picked.push(words[wi]);
          w = need;
          wi++;
        }
        if (picked.length) text(picked.join(' '), L, y);

        if (wi >= words.length) {
          // без повтору — група закінчилась, зупиняємо і рядок, і весь стовпчик
          if (!checked('repeat' + (i + 1))) { done = true; break; }
          wi = 0;
          blank = true;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- набір тексту

// назви навмисно з префіксом: p5 у глобальному режимі копіює свої методи
// у window уже після завантаження скетча, тому короткі імена на кшталт
// str() мовчки затираються вбудованими
function fieldNum(id) { return +document.getElementById(id).value; }
function fieldText(id) { return document.getElementById(id).value; }

// розбиває текст на слова, лишаючи '\n' окремим токеном — це маркер
// примусового переносу. Порожній рядок у полі дає порожній рядок у верстці
function tokenize(raw) {
  let out = [];
  let paras = raw.split(/\r?\n/);
  for (let i = 0; i < paras.length; i++) {
    let ws = paras[i].trim().split(/\s+/);
    for (let j = 0; j < ws.length; j++) if (ws[j]) out.push(ws[j]);
    if (i < paras.length - 1) out.push('\n');
  }
  return out;
}

function drawColumns() {
  if (curves.length < 3) return;

  // кегль задається в пунктах відносно макета, а канвас — його зменшене
  // прев'ю, тому переводимо pt у пікселі одним коефіцієнтом
  let k = width / fieldNum('artboard');
  let pad = fieldNum('pad');

  noStroke();
  textFont('Times New Roman');
  textAlign(LEFT, BASELINE);

  for (let i = 0; i < 3; i++) {
    let raw = fieldText('txt' + (i + 1)).trim();
    if (!raw) continue;
    if (i !== 1) raw = raw.toUpperCase(); // 1-й і 3-й — капс, 2-й — як введено

    let words = tokenize(raw);
    let size = fieldNum('size' + (i + 1)) * k;
    let lead = fieldNum('lead' + (i + 1)) * k;
    if (size < 1 || lead < 1) continue;

    textSize(size);
    fill(fieldText('color' + (i + 1)));
    let spaceW = textWidth(' ');

    let wi = 0;
    let blank = false;

    for (let y = lead; y < CONTENT_H + lead; y += lead) {
      let yy = constrain(round(y - size * 0.32), 0, CONTENT_H - 1);

      let L = curves[i][yy] + pad;
      let R = (i < 2 ? curves[i + 1][yy] : width) - pad;
      if (R - L < size * 0.5) continue;

      // порожній рядок між повторами тексту
      if (blank) { blank = false; continue; }

      let picked = [];
      let w = 0;
      while (wi < words.length) {
        if (words[wi] === '\n') { wi++; break; }   // примусовий перенос
        let ww = textWidth(words[wi]);
        let need = picked.length ? w + spaceW + ww : ww;
        if (need > R - L && picked.length) break;
        picked.push(words[wi]);
        w = need;
        wi++;
      }
      if (picked.length) text(picked.join(' '), L, y);

      if (wi >= words.length) {
        if (!checked('repeat' + (i + 1))) break;
        wi = 0;
        blank = true;
      }
    }
  }
}

// ---------------------------------------------------------------- плашка

// біла смуга на всю ширину з чорним правилом по нижньому краю.
// три слова стають на x тієї лінії, до якої прив'язані, а базова лінія
// шрифту лягає рівно на нижній край правила
function drawBanner(mode) {
  let k = width / fieldNum('artboard');
  let h  = fieldNum('bandH') * k;
  let lw = fieldNum('bandLine') * k;
  let size = fieldNum('bandSize') * k;

  noStroke();
  fill(255);
  rect(0, 0, width, h);

  // контент тепер починається одразу під плашкою (рядок 0 у своїй системі
  // координат), а не в рядку h полотна — тому прив'язка йде по row 0
  let yy = 0;
  let anchors;

  if (mode === 'outline') {
    let b = maskBounds[yy];
    anchors = [
      0,                                        // від краю кадру
      blueCurve ? blueCurve[yy] : 0,            // добудована
      b ? (b[0] + b[1]) / 2 : width / 2         // центр силуету
    ];
  } else {
    anchors = [
      curves[0] ? curves[0][yy] : 0,            // добудована (завжди перша)
      curves[1] ? curves[1][yy] : 0,            // перша з кадру
      curves[2] ? curves[2][yy] : 0             // друга з кадру
    ];
  }

  // слова і правило беруть колір першого текстового блоку
  let c = fieldText('color1');

  fill(c);
  textFont('Arial');
  textStyle(BOLD);
  textSize(size);
  textAlign(LEFT, BASELINE);
  for (let i = 0; i < 3; i++) {
    let w = fieldText('word' + (i + 1)).trim().toUpperCase();
    if (w) text(w, anchors[i], h);
  }
  textStyle(NORMAL);

  if (lw > 0) { noStroke(); fill(c); rect(0, h - lw, width, lw); }
}

function drawStatus() {
  // якщо камера віддала не те, що просили — показуємо фактичне
  if (camW() && (camW() !== 1280 || camH() !== 720)) {
    noStroke(); fill(0, 200); rect(8, CONTENT_H - 34, 190, 26);
    fill(255); textFont('sans-serif'); textSize(12); textAlign(LEFT, BASELINE);
    text('камера: ' + camW() + '×' + camH(), 16, CONTENT_H - 16);
  }

  if (modelReady && maskPixels) return;
  noStroke();
  fill(0, 200);
  rect(8, 8, 210, 26);
  fill(255);
  textFont('sans-serif');
  textSize(12);
  textAlign(LEFT, BASELINE);
  text(modelReady ? 'чекаю першу маску…' : 'модель вантажиться…', 16, 25);
}

// ---------------------------------------------------------------- зв'язок з інтерфейсом

function val(key) {
  return +document.getElementById(key).value;
}

function checked(key) {
  return document.getElementById(key).checked;
}

function refreshLabels() {
  let outs = document.querySelectorAll('output[id$="-val"]');
  for (let i = 0; i < outs.length; i++) {
    let key = outs[i].id.slice(0, -4);
    let el = document.getElementById(key);
    if (!el) continue;

    // кольори показуємо як hex, решту — як число
    if (el.type === 'color') { outs[i].textContent = el.value.toUpperCase(); continue; }

    let v = +el.value;
    outs[i].textContent = FMT[key] ? FMT[key](v) : v;
  }
}
