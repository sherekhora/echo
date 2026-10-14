/* ---------- шрифт Skema Pro Omni ----------
   Локально (Processing: localhost / 127.0.0.1 / file) шрифт береться з файлу
   в папці скетча. Онлайн (github.io, iframe у Webflow) його підключає
   rentafont за кодом із ліцензії. Файл .ttf у репозиторій не потрапляє. */

const FONT_FILE = 'SkemaProOmni-Regular.ttf';   // лише для локального запуску
const FONT_FAMILY = 'SkemaProOmni';             // назва шрифта в онлайн-режимі
const FONT_TIMEOUT = 10000;                     // мс чекати rentafont, далі запасний шрифт

const FONT_LOCAL =
  ['localhost', '127.0.0.1', '[::1]', ''].indexOf(location.hostname) >= 0 ||
  location.protocol === 'file:';

let fontObj = null;           // p5.Font, лише локально
let fontReady = false;        // true, коли шрифт можна малювати

// онлайн: код із ліцензії rentafont (WebFontConfig + webfonts.js), підключений з JS
if (!FONT_LOCAL) {
  window.WebFontConfig = {id: 'MTIwMTM0b3JkZXIzMzM5MjY=', fonts: [/*'Skema Pro Omni Regular'*/'16177596'], by_style: 1};
  const s = document.createElement('script');
  s.type = 'text/javascript';
  s.async = true;
  s.src = 'https://rentafont.com/javascripts/webfonts.js';
  document.head.appendChild(s);
}

// викликається з preload()
function fontPreload() {
  if (!FONT_LOCAL) return;
  fontObj = loadFont(FONT_FILE, () => { fontReady = true; });
}

// викликається з setup()
function fontStart() {
  if (!FONT_LOCAL) waitFont();
}

// що передавати в textFont()
function fontFace() {
  return FONT_LOCAL ? fontObj : FONT_FAMILY;
}

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
