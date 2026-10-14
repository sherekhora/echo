/* ---------- серія полотен ----------
   До BOARD_MAX полотен. Редагується лише current (по центру). Тексти, offset x
   і cover у кожного полотна свої; size, layout, контури і звук спільні.
   Сусіди показуються статичними мініатюрами (без дихання). */

const BOARD_MAX = 10;
const THUMB_SCALE = 0.25;       // роздільність мініатюр від розміру полотна
const THUMB_EVERY = 10;         // оновлювати мініатюри не частіше, ніж раз на N кадрів
const SAVE_DELAY = 300;         // мс між завантаженнями файлів серії
const SWITCH_MS = 400;          // тривалість анімації переходу
const SWITCH_SHIFT = 100;       // на скільки px current в'їжджає під час переходу
const SIZE_TAGS = ['post', 'story', 'custom'];

let boards = [];
let cur = 0;
let sizeMode = 0;               // 0 post, 1 story, 2 custom — для назв файлів
let pg = null;                  // буфер W×H для мініатюр і збереження
let thumbsDirty = true;
let thumbsNow = false;          // оновити мініатюри в цьому кадрі, не чекаючи черги
let thumbFont = false;

// нове полотно: копія from або стартові значення
function newBoard(from) {
  if (from) {
    return {
      text: from.text.slice(),
      x: from.x.slice(),
      repeat: from.repeat,
      coverSrc: from.coverSrc,
      cover: from.cover,
      coverScale: from.coverScale,
    };
  }
  return {
    text: DEFAULTS.map(d => d.text),
    x: DEFAULTS.map(d => d.x),
    repeat: true,
    coverSrc: null,
    cover: null,
    coverScale: COVER_SCALE,
  };
}

function board() {
  return boards[cur];
}

function initBoards() {
  boards = [newBoard()];
  cur = 0;
  // будь-яка зміна в інтерфейсі може змінити вигляд сусідів
  ['input', 'change', 'click'].forEach(t =>
    document.addEventListener(t, () => { thumbsDirty = true; }));
}

/* ---------- навігація ---------- */

function buildBoardNav() {
  const mid = select('#bnCenter');
  ui.bPrev = createButton('‹').class('tgl').parent(mid);
  ui.bCount = createSpan('01 / 01').class('bcount').parent(mid);
  ui.bNext = createButton('›').class('tgl').parent(mid);
  ui.bPrev.mousePressed(() => goBoard(cur - 1));
  ui.bNext.mousePressed(() => goBoard(cur + 1));

  const right = select('#bnRight');
  ui.bAdd = createButton('+ add').class('tgl').parent(right);
  ui.bDel = createButton('× delete').class('tgl').parent(right);
  ui.bAdd.mousePressed(addBoard);
  ui.bDel.mousePressed(delBoard);

  ui.thumb = { prev: select('#thPrev'), next: select('#thNext') };
  ui.thumb.prev.mousePressed(() => goBoard(cur - 1));
  ui.thumb.next.mousePressed(() => goBoard(cur + 1));
}

// під час запису відео серію не змінюємо: пишеться лише current
function goBoard(i) {
  if (recorder) return;
  if (i < 0 || i >= boards.length || i === cur) return;
  const dir = i > cur ? 1 : -1;
  cur = i;
  showBoard();
  thumbsNow = true;               // мініатюри оновлюємо одразу, без очікування
  animateSwitch(dir);
}

// перехід: current в'їжджає з того боку, куди перейшли, і проявляється;
// мініатюри сусідів проявляються. Лише відображення, на jpg і відео не впливає.
function animateSwitch(dir) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const main = cnv.elt;
  main.getAnimations().forEach(a => a.cancel());
  main.animate([
    { transform: 'translateX(' + (dir * SWITCH_SHIFT) + 'px)', opacity: 0 },
    { transform: 'translateX(0)', opacity: 1 },
  ], { duration: SWITCH_MS, easing: 'cubic-bezier(.2,.7,.2,1)' });

  [ui.thumb.prev.elt, ui.thumb.next.elt].forEach(el => {
    el.getAnimations().forEach(a => a.cancel());
    el.animate([
      { opacity: 0 },
      { opacity: getComputedStyle(el).opacity },
    ], { duration: SWITCH_MS, easing: 'ease-out' });
  });
}

// нове полотно — копія current, стає одразу після нього; current не змінюється
function addBoard() {
  if (recorder || boards.length >= BOARD_MAX) return;
  boards.splice(cur + 1, 0, newBoard(board()));
  showBoard();
}

function delBoard() {
  if (recorder || boards.length <= 1) return;
  boards.splice(cur, 1);
  cur = min(cur, boards.length - 1);
  showBoard();
}

// переносить вміст current у панелі text і cover
function showBoard() {
  const bd = board();
  for (let i = 0; i < 3; i++) {
    ui.s[i].text.value(bd.text[i]);
    ui.s[i].x.setVal(bd.x[i]);
  }
  ui.repeat.set(bd.repeat);
  ui.coverScale.set(bd.coverScale);
  ui.coverFile.elt.value = '';

  ui.bCount.html(nf(cur + 1, 2) + ' / ' + nf(boards.length, 2));
  ui.bPrev.elt.disabled = cur === 0;
  ui.bNext.elt.disabled = cur === boards.length - 1;
  ui.bAdd.elt.disabled = boards.length >= BOARD_MAX;
  ui.bDel.elt.disabled = boards.length <= 1;

  thumbsDirty = true;
}

/* ---------- мініатюри сусідів ---------- */

function buffer() {
  if (!pg || pg.width !== W || pg.height !== H) {
    if (pg) pg.remove();
    pg = createGraphics(W, H);
    pg.pixelDensity(1);
  }
  return pg;
}

function updateThumbs() {
  if (fontReady !== thumbFont) { thumbFont = fontReady; thumbsDirty = true; }
  if (!thumbsDirty || (frameCount % THUMB_EVERY && !thumbsNow)) return;
  thumbsDirty = false;
  thumbsNow = false;
  drawThumb(ui.thumb.prev, cur - 1);
  drawThumb(ui.thumb.next, cur + 1);
}

function drawThumb(el, i) {
  if (i < 0 || i >= boards.length) { el.addClass('off'); return; }
  el.removeClass('off');

  const g = buffer();
  renderBoard(g, boards[i], staticGeo(), false);

  const c = el.elt.querySelector('canvas');
  const w = max(1, round(W * THUMB_SCALE));
  const h = max(1, round(H * THUMB_SCALE));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(g.elt, 0, 0, w, h);
}

/* ---------- save jpg: уся серія ---------- */

// усі полотна в одному моменті звуку; файли: echo post 01.jpg, echo post 02.jpg…
function saveAll() {
  const tag = SIZE_TAGS[sizeMode];
  const geo = frameGeo(bandsNow(), snd ? snd.currentTime() : 0);
  const g = buffer();

  const files = boards.map((bd, k) => {
    renderBoard(g, bd, geo, showGuides);
    return { name: 'echo ' + tag + ' ' + nf(k + 1, 2) + '.jpg', url: g.elt.toDataURL('image/jpeg', 0.95) };
  });

  files.forEach((f, k) => setTimeout(() => {
    const a = document.createElement('a');
    a.href = f.url;
    a.download = f.name;
    a.click();
  }, k * SAVE_DELAY));

  thumbsDirty = true;
}
