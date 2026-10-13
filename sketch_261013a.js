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
const FONT_FAMILY = 'SkemaProOmni';       // підключає rentafont з index.html
const FONT_TIMEOUT = 10000;               // мс чекати шрифт, далі малюємо запасним
const AUDIO_DIR = 'audio/';
const AUDIO_FALLBACK = 'audio1.mp3';      // якщо жоден трек знайти не вдалося
const STEP = 2;               // крок вибірки контуру, px
const GAP = 20;               // відступ тексту від кривої, px
const REC_FPS = 30;

const BANDS = [[20, 600], [300, 4000], [2000, 14000]];
const SCALE = [1, 1 / 2, 2 / 3];          // кегль, інтерліняж і top кожного блоку від базових

const TONE_DARK  = '#48423e';             // градієнтний мап cover
const TONE_LIGHT = '#fff5ed';

const DEFAULTS = [
  { text: 'OPEN\nCALL',                                                              col: '#59524d', x: -190 },
  { text: 'For young ukrainian artists\nparticipate in\n“7 LIVES – ECHOES OF\nBABYN YAR”', col: '#9b9164', x: 145  },
  { text: 'Третій блок\nдо кривої',                                                  col: '#59524d', x: 0    },
];

/* ---------- стан ---------- */

let raw = [];
let baseShapes = [];          // контури в координатах артборду 1080×1350
let shapes = [];              // вони ж, підігнані під поточне полотно
let fitW = 0;
let fitH = 0;
let snd, fft, cnv;                // snd порожній, поки трек не завантажився
let fontReady = false;            // true, коли шрифт rentafont завантажений
let tracks = [];
let trackIdx = 0;
let coverSrc = null;
let cover = null;
let ui = {};
let count = 2;
let spaceLn = 1;
let showGuides = false;
let repeatOn = true;
let audioMode = false;
let lv = [0, 0, 0];
let seeking = false;
let wasPlaying = null;

let recorder = null;
let chunks = [];
let recStart = 0;
let recExt = 'webm';
let audioDest = null;

/* ---------- шрифт ---------- */

// rentafont підставляє @font-face асинхронно, тому чекаємо, поки face
// з'явиться в document.fonts, і вантажимо його. Далі text() малює вже ним.
function waitFont() {
  const t0 = Date.now();

  const tick = () => {
    let face = null;
    document.fonts.forEach(f => {
      if (f.family.replace(/['"]/g, '') === FONT_FAMILY) face = f;
    });

    if (face) {
      face.load().then(() => {
        fontReady = true;
        console.log('шрифт готовий:', FONT_FAMILY);
      }).catch(e => {
        console.log('шрифт не завантажився:', e);
        fontReady = true;                   // малюємо запасним, але не висимо
      });
      return;
    }

    if (Date.now() - t0 > FONT_TIMEOUT) {
      console.log('шрифт', FONT_FAMILY, 'не з\'явився за', FONT_TIMEOUT, 'мс. Домен у замовленні rentafont?');
      fontReady = true;                     // малюємо запасним
      return;
    }
    setTimeout(tick, 100);
  };

  tick();
}

/* ---------- p5 ---------- */

function preload() {
  raw = FILES.map(f => loadStrings(f));
}

function setup() {
  cnv = createCanvas(W, H);
  cnv.parent('stage');
  pixelDensity(1);

  waitFont();

  baseShapes = raw.map((lines, i) => {
    const ln = parseSVG(lines.join('\n'), FILES[i]);
    return { lines: ln, b: bounds(ln) };
  });
  refit();

  fft = new p5.FFT(0.6, 1024);

  buildAudioUI();
  buildCoverUI();
  buildTextUI();

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
  background(255);

  if (W !== fitW || H !== fitH) refit();     // розмір полотна змінився

  updateLevels();
  syncTransport();

  const b = bandsNow();
  const tm = snd ? snd.currentTime() : 0;

  const baseSize = ui.size.value();
  const baseLead = ui.leading.value();
  const baseTop = ui.top.value();

  /* геометрія контурів на цей кадр */
  const geo = [];
  for (let i = 0; i < 3; i++) {
    const s = ui.s[i];
    s.box.style('opacity', i < count ? '1' : '0.35');
    ui.meter[i].style.width = (b[i] * 100) + '%';

    if (audioMode) {
      geo.push({ lines: deform(shapes[i], b, tm), dx: s.x.value() + ui.shift[i].value() * b[i] });
    } else {
      geo.push({ lines: shapes[i].lines, dx: s.x.value() });
    }
  }

  /* текст: поки шрифт не готовий, не малюємо, щоб не було кадрів запасним шрифтом */
  if (fontReady) {
    noStroke();
    textFont(FONT_FAMILY);
    textAlign(LEFT, BASELINE);

    for (let i = 0; i < count; i++) {
      const s = ui.s[i];
      const size = baseSize * SCALE[i];
      const lead = max(1, baseLead * SCALE[i]);

      textSize(size);
      const ascent = textAscent();

      const src = s.text.value().split('\n');
      const seq = repeatOn ? src.concat(new Array(spaceLn).fill('')) : src;

      let baseline = baseTop * SCALE[i] + ascent;
      let lastX = GAP;
      let idx = 0;

      fill(DEFAULTS[i].col);

      while (true) {
        if (!repeatOn && idx >= seq.length) break;
        if (baseline - ascent > H) break;

        const ln = seq[idx % seq.length];
        const ex = edgeX(geo[i].lines, geo[i].dx, baseline - size * 0.3);
        const x = ex === null ? lastX : ex + GAP;
        lastX = x;
        if (ln.length) text(ln, x, baseline);

        baseline += lead;
        idx++;
      }
    }
  }

  /* cover: правий нижній кут */
  if (cover) {
    const sc = ui.coverScale.value() / 100;
    if (sc > 0) {
      const w = W * sc;
      const h = w * cover.height / cover.width;
      image(cover, W - w, H - h, w, h);
    }
  }

  /* контури */
  if (showGuides) {
    noFill();
    stroke(255, 92, 0);
    strokeWeight(1.5);
    for (let i = 0; i < count; i++) {
      for (const line of geo[i].lines) {
        beginShape();
        for (const p of line) vertex(p.x + geo[i].dx, p.y);
        endShape();
      }
    }
  }

  if (recorder) ui.rec.html('stop ' + fmt((millis() - recStart) / 1000));
}
