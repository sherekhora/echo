/* ---------- верхня панель ---------- */

function buildTopBar() {
  // ліворуч: контури і видимість
  const left = select('#tbLeft');
  createSpan('contours').class('lbl').parent(left);
  segToggle(left, ['2', '3'], count - 2, i => { count = i + 2; });

  const cb = createCheckbox('visible', showGuides).class('chk').parent(left);
  cb.changed(() => { showGuides = cb.checked(); });

  // по центру: розмір полотна
  const mid = select('#tbCenter');
  createSpan('size').class('lbl').parent(mid);
  const wrap = createDiv().class('sizeseg').parent(mid);
  ui.sizeMode = segToggle(wrap, ['post', 'story', 'custom'], 0, i => {
    if (i === 0) setCanvasSize(SIZE_POST[0], SIZE_POST[1]);
    if (i === 1) setCanvasSize(SIZE_STORY[0], SIZE_STORY[1]);
    // custom: розмір лишається, далі міняється полями
  });

  ui.cw = createInput(String(W), 'number').class('num').parent(mid);
  createSpan('×').class('lbl').parent(mid);
  ui.ch = createInput(String(H), 'number').class('num').parent(mid);

  const applyCustom = () => {
    selectSeg(ui.sizeMode, 2);             // ручне введення = custom
    setCanvasSize(Number(ui.cw.value()) || W, Number(ui.ch.value()) || H);
  };
  ui.cw.changed(applyCustom);
  ui.ch.changed(applyCustom);

  // праворуч: збереження
  const right = select('#tbRight');
  createButton('save jpg').class('act').parent(right).mousePressed(() => saveCanvas('contour', 'jpg'));
  ui.rec = createButton('save animation').class('tgl rec').parent(right);
  ui.rec.mousePressed(toggleRec);
}

// змінює розмір полотна в пікселях; під час запису відео заблоковано
function setCanvasSize(w, h) {
  if (recorder) {
    ui.cw.value(W);
    ui.ch.value(H);
    return;
  }
  W = constrain(round(w), SIZE_MIN, SIZE_MAX);
  H = constrain(round(h), SIZE_MIN, SIZE_MAX);
  resizeCanvas(W, H);
  ui.cw.value(W);
  ui.ch.value(H);
}

/* ---------- sound ---------- */

function buildAudioUI() {
  const root = select('#audio');

  const tr = createDiv().class('grp').parent(root);

  // перемикач треків: ‹  1/2  ›
  const rt = row(tr, 'track');
  const nav = createDiv().class('seg').parent(rt);
  nav.style('align-items', 'stretch');

  const prev = createButton('‹').parent(nav);
  ui.trackName = createSpan('…').parent(nav);
  const next = createButton('›').parent(nav);

  prev.style('font-size', '16px');
  next.style('font-size', '16px');
  prev.mousePressed(() => loadTrack(trackIdx - 1, true));
  next.mousePressed(() => loadTrack(trackIdx + 1, true));

  ui.trackName.style('flex', '1');
  ui.trackName.style('display', 'flex');
  ui.trackName.style('align-items', 'center');
  ui.trackName.style('justify-content', 'center');
  ui.trackName.style('font-size', '16px');
  ui.trackName.style('letter-spacing', '.08em');
  ui.trackName.style('font-variant-numeric', 'tabular-nums');

  const rm = row(tr, 'mode');
  ui.mode = segToggle(rm, ['static', 'audio'], audioMode ? 1 : 0, i => { audioMode = i === 1; });

  const rp = row(tr, 'play');
  ui.play = createButton('play').class('tgl').parent(rp);
  ui.play.mousePressed(() => {
    if (!snd) return;
    if (!snd.isPlaying()) setMode(true);   // старт відтворення вмикає audio
    togglePlay();
  });
  ui.clock = createSpan('0:00 / 0:00').class('clock').parent(rp);

  const rs = row(tr, 'seek');
  ui.seek = createSlider(0, 1, 0, 0.001).parent(rs);
  ui.seek.elt.addEventListener('input', () => { seeking = true; });
  ui.seek.elt.addEventListener('change', () => {
    if (!snd) { seeking = false; return; }
    userStartAudio();
    setMode(true);                         // jump() теж запускає відтворення
    snd.jump(min(ui.seek.value(), 0.999) * snd.duration());
    seeking = false;
  });

  // згорнуті групи
  const mo = subgroup(root, 'breath', '01');
  ui.amp    = slider(mo, 'amp x',  0, 200, 60, 1);
  ui.freq   = slider(mo, 'freq',   0.5, 8, 3, 0.1);
  ui.speed  = slider(mo, 'speed',  0, 10, 2, 0.1);
  ui.smooth = slider(mo, 'smooth', 0, 10, 2, 0.5);

  const ga = subgroup(root, 'gain', '02');
  ui.gain = [
    slider(ga, 'low',  0, 60, 1.8, 0.1),
    slider(ga, 'mid',  0, 60, 3.9, 0.1),
    slider(ga, 'high', 0, 60, 35,  0.5),
  ];

  const sh = subgroup(root, 'shift', '03');
  ui.shift = [];
  ui.meter = [];
  ['low', 'mid', 'high'].forEach(name => {
    ui.shift.push(slider(sh, name + ' px', -200, 200, 40, 1));
    const rl = row(sh, '');
    ui.meter.push(createDiv('<i></i>').class('meter').parent(rl).elt.querySelector('i'));
  });
}

// перемикає режим і підсвічує відповідну кнопку
function setMode(isAudio) {
  audioMode = isAudio;
  selectSeg(ui.mode, isAudio ? 1 : 0);
}

/* ---------- cover ---------- */

function buildCoverUI() {
  const root = select('#cover');
  const g = group(root, 'image', '00');

  const rf = row(g, 'file');
  createFileInput(loadCover).parent(rf);

  ui.coverScale = sliderNum(g, 'scale %', 0, 100, 20, 1);
  createDiv('% від ширини полотна, кут — правий нижній').class('note').parent(g);

  const rc = row(g, '');
  createButton('remove').class('tgl').parent(rc).mousePressed(removeCover);
}

/* ---------- text ---------- */

function buildTextUI() {
  buildTopBar();   // верхня панель будується разом із текстовою

  const root = select('#controls');

  const g = group(root, 'layout', '00');

  const r3 = row(g, 'repeat');
  toggleButton(r3, 'repeat', repeatOn, v => { repeatOn = v; });

  const r4 = row(g, 'space ln');
  segToggle(r4, ['0', '1'], spaceLn, i => { spaceLn = i; });

  ui.size    = numField(g, 'size px', 80);
  ui.leading = numField(g, 'leading px', 78);
  ui.top     = sliderNum(g, 'top px', 0, 20, 18, 1);
  createDiv('блоки: 1 = 100%, 2 = 1/2, 3 = 2/3 (кегль, інтерліняж, top)').class('note').parent(g);

  ui.s = FILES.map((f, i) => {
    const d = DEFAULTS[i];
    const box = group(root, 'text ' + (i + 1), '0' + (i + 1));
    const ta = createElement('textarea', d.text).parent(box);
    return {
      box: box,
      text: ta,
      x:   slider(box, 'offset x', -540, 540, d.x, 1),
    };
  });
}

/* ---------- елементи ---------- */

function group(parent, title, n) {
  const box = createDiv().class('grp').parent(parent);
  createElement('h4', title).parent(box).attribute('data-n', n);
  return box;
}

// згортна група: заголовок-перемикач, вміст приховано
function subgroup(parent, title, n) {
  const d = createElement('details').class('sub').parent(parent);
  createElement('summary', title).parent(d).attribute('data-n', n);
  return d;
}

function row(parent, label) {
  const r = createDiv().class('row').parent(parent);
  createSpan(label).class('lbl').parent(r);
  return r;
}

// група кнопок, активна одна; onPick отримує індекс
function segToggle(parent, labels, start, onPick) {
  const seg = createDiv().class('seg').parent(parent);
  const btns = labels.map((l, i) => {
    const b = createButton(l).parent(seg);
    if (i === start) b.addClass('on');
    b.mousePressed(() => {
      selectSeg(btns, i);
      onPick(i);
    });
    return b;
  });
  return btns;
}

// підсвітити кнопку i в групі без виклику onPick
function selectSeg(btns, i) {
  btns.forEach(x => x.removeClass('on'));
  btns[i].addClass('on');
}

// одна кнопка вкл/викл; стартовий стан береться зі змінної
function toggleButton(parent, label, start, onChange) {
  let on = start;
  const b = createButton(label).class('tgl').parent(parent);
  if (on) b.addClass('on');
  b.mousePressed(() => {
    on = !on;
    on ? b.addClass('on') : b.removeClass('on');
    onChange(on);
  });
  return b;
}

function slider(parent, label, min, max, val, step) {
  const r = row(parent, label);
  const s = createSlider(min, max, val, step).parent(r);
  const out = createSpan(String(val)).class('val').parent(r);
  s.input(() => out.html(s.value()));
  return s;
}

// повзунок + поле для ручного вводу
function sliderNum(parent, label, lo, hi, val, step) {
  const r = row(parent, label);
  const s = createSlider(lo, hi, val, step).parent(r);
  const inp = createInput(String(val), 'number').class('num').parent(r);
  inp.attribute('step', step);
  inp.attribute('min', lo);
  inp.attribute('max', hi);
  let current = val;

  s.input(() => { current = Number(s.value()); inp.value(current); });
  inp.input(() => {
    const v = Number(inp.value());
    if (inp.value() === '' || isNaN(v)) return;
    current = constrain(v, lo, hi);
    s.value(current);
  });
  inp.changed(() => inp.value(current));

  return { value: () => current };
}

function numField(parent, label, val) {
  const r = row(parent, label);
  const inp = createInput(String(val), 'number').parent(r);
  return { value: () => Number(inp.value()) || 0 };
}
