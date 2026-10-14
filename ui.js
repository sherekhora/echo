/* ---------- верхня панель ---------- */

function buildTopBar() {
  // ліворуч: контури і видимість
  const left = select('#tbLeft');
  createSpan('contours').class('lbl').parent(left);
  segToggle(left, ['2', '3'], count - 2, i => {
    count = i + 2;
    syncText3();
  });
  toggleButton(left, 'visible', showGuides, v => { showGuides = v; });

  // по центру: розмір полотна (один на всю серію)
  const mid = select('#tbCenter');
  createSpan('size').class('lbl').parent(mid);
  const wrap = createDiv().class('sizeseg').parent(mid);
  ui.sizeMode = segToggle(wrap, ['post', 'story', 'custom'], 0, i => {
    if (recorder) return;
    sizeMode = i;
    if (i === 0) setCanvasSize(SIZE_POST[0], SIZE_POST[1]);
    if (i === 1) setCanvasSize(SIZE_STORY[0], SIZE_STORY[1]);
    // custom: розмір лишається, далі міняється полями
  });

  ui.cw = createInput(String(W), 'number').class('num').parent(mid);
  createSpan('×').class('lbl').parent(mid);
  ui.ch = createInput(String(H), 'number').class('num').parent(mid);

  const applyCustom = () => {
    if (!recorder) sizeMode = 2;
    selectSeg(ui.sizeMode, 2);             // ручне введення = custom
    setCanvasSize(Number(ui.cw.value()) || W, Number(ui.ch.value()) || H);
  };
  ui.cw.changed(applyCustom);
  ui.ch.changed(applyCustom);

  // праворуч: збереження. jpg — уся серія, відео — лише current
  const right = select('#tbRight');
  createButton('save jpg').class('act').parent(right).mousePressed(saveAll);
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
  ui.trackName.style('font-size', '15px');
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

  const rs = row(tr, 'seek').addClass('pill');
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

/* ---------- cover (свій у кожного полотна) ---------- */

function buildCoverUI() {
  const root = select('#cover');
  const g = group(root, 'image', '00');

  const rf = row(g, 'file');
  ui.coverFile = createFileInput(loadCover).parent(rf);

  ui.coverScale = sliderNum(g, 'scale %', 0, 100, COVER_SCALE, 1, v => { board().coverScale = v; });
  createDiv('% від ширини полотна, кут — правий нижній').class('note').parent(g);

  const rc = row(g, '');
  createButton('remove').class('tgl').parent(rc).mousePressed(removeCover);
}

/* ---------- text (тексти, repeat, space ln і offset x свої в кожного полотна) ---------- */

function buildTextUI() {
  buildTopBar();   // верхня панель будується разом із текстовою

  const root = select('#controls');

  const g = subgroup(root, 'layout', '00');      // при завантаженні згорнутий

  ui.size    = sliderNum(g, 'size',    10, 400, 80, 1);
  ui.leading = sliderNum(g, 'leading', 10, 400, 78, 1);
  ui.top     = sliderNum(g, 'top',     0, 20, 18, 1);

  ui.s = FILES.map((f, i) => {
    const d = DEFAULTS[i];
    const box = subgroup(root, 'text ' + (i + 1), '0' + (i + 1));
    box.elt.open = i < 2;                         // text 3 — за кількістю контурів

    // repeat і space ln: текстові кнопки, вимкнена — закреслена
    const rf = row(box, '');
    const rep = toggleButton(rf, 'repeat', board().repeat[i], v => {
      board().repeat[i] = v;
      syncSpace(i);
    }, 'flag');
    const sp = toggleButton(rf, 'space ln', board().space[i] === 1, v => {
      board().space[i] = v ? 1 : 0;
    }, 'flag');

    const ta = createElement('textarea', d.text).parent(box);
    ta.input(() => { board().text[i] = ta.value(); });
    return {
      box: box,
      rep: rep,
      sp: sp,
      text: ta,
      x:   slider(box, 'offset x', -540, 540, d.x, 1, v => { board().x[i] = v; }),
    };
  });
  syncText3();
}

// space ln діє лише з repeat, тож без нього кнопка приглушена
function syncSpace(i) {
  ui.s[i].sp.btn.elt.disabled = !board().repeat[i];
}

// text 3 розгорнутий, лише коли вибрано 3 контури
function syncText3() {
  if (ui.s) ui.s[2].box.elt.open = count === 3;
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

// одна кнопка вкл/викл; set(v) ставить стан ззовні (при переході між полотнами);
// cls — вигляд: 'tgl' чип (типово) або 'flag' текст
function toggleButton(parent, label, start, onChange, cls) {
  let on = start;
  const b = createButton(label).class(cls || 'tgl').parent(parent);
  const paint = () => { on ? b.addClass('on') : b.removeClass('on'); };
  paint();
  b.mousePressed(() => {
    on = !on;
    paint();
    onChange(on);
  });
  return { btn: b, set: v => { on = v; paint(); } };
}

// повзунок з підписом у пігулці; onInput (необов'язковий) отримує нове значення;
// setVal ставить значення ззовні разом із підписом
function slider(parent, label, min, max, val, step, onInput) {
  const r = row(parent, label).addClass('pill');
  const s = createSlider(min, max, val, step).parent(r);
  const out = createSpan(String(val)).class('val').parent(r);
  s.input(() => {
    out.html(s.value());
    if (onInput) onInput(Number(s.value()));
  });
  s.setVal = v => { s.value(v); out.html(v); };
  return s;
}

// повзунок + поле для ручного вводу в пігулці; onChange (необов'язковий) отримує нове значення
function sliderNum(parent, label, lo, hi, val, step, onChange) {
  const r = row(parent, label).addClass('pill');
  const s = createSlider(lo, hi, val, step).parent(r);
  const inp = createInput(String(val), 'number').class('num').parent(r);
  inp.attribute('step', step);
  inp.attribute('min', lo);
  inp.attribute('max', hi);
  let current = val;

  s.input(() => {
    current = Number(s.value());
    inp.value(current);
    if (onChange) onChange(current);
  });
  inp.input(() => {
    const v = Number(inp.value());
    if (inp.value() === '' || isNaN(v)) return;
    current = constrain(v, lo, hi);
    s.value(current);
    if (onChange) onChange(current);
  });
  inp.changed(() => inp.value(current));

  return {
    value: () => current,
    set: v => { current = v; s.value(v); inp.value(v); },
  };
}
