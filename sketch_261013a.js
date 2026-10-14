/* ---------- налаштування ---------- */

let W = 1080;                 // розмір полотна, змінюється з верхньої панелі
let H = 1350;
const BASE_W = 1080;          // розмір артборду, в якому намальовані SVG
const BASE_H = 1350;
const SIZE_POST  = [1080, 1350];
const SIZE_STORY = [1080, 1920];
const SIZE_MIN = 100;
const SIZE_MAX = 4000;

const FILES = ['Shape01.svg', 'Shape02.svg', 'Shape03.svg'];
const AUDIO_DIR = 'audio/';
const AUDIO_FALLBACK = 'audio1.mp3';      // якщо жоден трек знайти не вдалося
const STEP = 2;               // крок вибірки контуру, px
const GAP = 20;               // відступ тексту від кривої, px
const REC_FPS = 30;

const BANDS = [[20, 600], [300, 4000], [2000, 14000]];
const SCALE = [1, 1 / 2, 2 / 3];          // кегль, інтерліняж і top кожного блоку від базових

const TONE_DARK  = '#48423e';             // градієнтний мап cover
const TONE_LIGHT = '#fff5ed';
const COVER_SCALE = 20;                   // стартовий розмір cover, % ширини полотна

const DEFAULTS = [
  { text: 'OPEN\nCALL',                                                              col: '#59524d', x: -110 },
  { text: 'For young ukrainian\nartists participate in\n“7 LIVES – ECHOES OF\nBABYN YAR”', col: '#9b9164', x: 225  },
  { text: 'Третій блок\nдо кривої',                                                  col: '#59524d', x: 0    },
];

/* ---------- стан ---------- */

let raw = [];
let baseShapes = [];          // контури в координатах артборду 1080×1350
let shapes = [];              // вони ж, підігнані під поточне полотно
let fitW = 0;
let fitH = 0;
let snd, fft, cnv;                // snd порожній, поки трек не завантажився
let tracks = [];
let trackIdx = 0;
let ui = {};
let count = 2;
let spaceLn = 1;
let showGuides = false;
let audioMode = false;
let lv = [0, 0, 0];
let seeking = false;
let wasPlaying = null;

let recorder = null;
let chunks = [];
let recStart = 0;
let recExt = 'webm';
let audioDest = null;

/* ---------- p5 ---------- */

function preload() {
  raw = FILES.map(f => loadStrings(f));
  fontPreload();                // font.js: локально вантажить .ttf
}

function setup() {
  cnv = createCanvas(W, H);
  cnv.parent('strip');
  pixelDensity(1);

  fontStart();                  // font.js: онлайн чекає rentafont

  baseShapes = raw.map((lines, i) => {
    const ln = parseSVG(lines.join('\n'), FILES[i]);
    return { lines: ln, b: bounds(ln) };
  });
  refit();

  fft = new p5.FFT(0.6, 1024);

  initBoards();                 // boards.js: перше полотно серії

  buildAudioUI();
  buildCoverUI();
  buildTextUI();
  buildBoardNav();
  showBoard();

  // пошук треків іде у фоні, картинка від нього не залежить
  findTracks()
    .catch(e => { console.log('помилка пошуку треків:', e); return { names: [AUDIO_FALLBACK], via: 'error' }; })
    .then(r => {
      tracks = r.names;
      console.log('треки (' + r.via + '):', tracks);
      loadTrack(0);
    });
}

function draw() {
  if (W !== fitW || H !== fitH) refit();     // розмір полотна змінився

  updateLevels();
  syncTransport();

  const b = bandsNow();
  const tm = snd ? snd.currentTime() : 0;

  for (let i = 0; i < 3; i++) {
    ui.s[i].box.style('opacity', i < count ? '1' : '0.35');
    ui.meter[i].style.width = (b[i] * 100) + '%';
  }

  // current — живе полотно; сусіди — мініатюри (boards.js)
  renderBoard(p5.instance, board(), frameGeo(b, tm), showGuides);
  updateThumbs();

  if (recorder) ui.rec.html('stop ' + fmt((millis() - recStart) / 1000));
}

/* ---------- кадр ---------- */

// геометрія контурів на цей кадр; sh — зсув лінії смугою (лише audio)
function frameGeo(b, tm) {
  const geo = [];
  for (let i = 0; i < 3; i++) {
    if (audioMode) geo.push({ lines: deform(shapes[i], b, tm), sh: ui.shift[i].value() * b[i] });
    else geo.push({ lines: shapes[i].lines, sh: 0 });
  }
  return geo;
}

// контури без дихання — для мініатюр
function staticGeo() {
  return shapes.map(s => ({ lines: s.lines, sh: 0 }));
}

// малює полотно bd у g: основне полотно (p5.instance) або буфер createGraphics
function renderBoard(g, bd, geo, guides) {
  g.background(255);

  const baseSize = ui.size.value();
  const baseLead = ui.leading.value();
  const baseTop = ui.top.value();

  /* текст: поки шрифт не готовий, не малюємо, щоб не було кадрів запасним шрифтом */
  if (fontReady) {
    g.noStroke();
    g.textFont(fontFace());
    g.textAlign(LEFT, BASELINE);

    for (let i = 0; i < count; i++) {
      const size = baseSize * SCALE[i];
      const lead = max(1, baseLead * SCALE[i]);
      const dx = bd.x[i] + geo[i].sh;

      g.textSize(size);
      const ascent = g.textAscent();

      const src = bd.text[i].split('\n');
      const seq = bd.repeat ? src.concat(new Array(spaceLn).fill('')) : src;

      let baseline = baseTop * SCALE[i] + ascent;
      let lastX = GAP;
      let idx = 0;

      g.fill(DEFAULTS[i].col);

      while (true) {
        if (!bd.repeat && idx >= seq.length) break;
        if (baseline - ascent > H) break;

        const ln = seq[idx % seq.length];
        const ex = edgeX(geo[i].lines, dx, baseline - size * 0.3);
        const x = ex === null ? lastX : ex + GAP;
        lastX = x;
        if (ln.length) g.text(ln, x, baseline);

        baseline += lead;
        idx++;
      }
    }
  }

  /* cover: правий нижній кут */
  if (bd.cover) {
    const sc = bd.coverScale / 100;
    if (sc > 0) {
      const w = W * sc;
      const h = w * bd.cover.height / bd.cover.width;
      g.image(bd.cover, W - w, H - h, w, h);
    }
  }

  /* контури */
  if (guides) {
    g.noFill();
    g.stroke(255, 92, 0);
    g.strokeWeight(1.5);
    for (let i = 0; i < count; i++) {
      const dx = bd.x[i] + geo[i].sh;
      for (const line of geo[i].lines) {
        g.beginShape();
        for (const p of line) g.vertex(p.x + dx, p.y);
        g.endShape();
      }
    }
  }
}
