// cover належить current-полотну, на яке його завантажили
function loadCover(f) {
  if (f.type !== 'image') { console.log('це не зображення:', f.name); return; }
  const bd = board();
  loadImage(f.data, img => {
    if (img.width > W) img.resize(W, 0);   // більше за ширину полотна не знадобиться
    bd.coverSrc = img;
    bd.cover = toneMap(img, TONE_DARK, TONE_LIGHT);
    thumbsDirty = true;
  });
}

function removeCover() {
  const bd = board();
  bd.coverSrc = null;
  bd.cover = null;
  ui.coverFile.elt.value = '';
}

function hexRGB(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// градієнтний мап: яскравість пікселя 0..1 -> колір між dark і light
function toneMap(src, darkHex, lightHex) {
  const d = hexRGB(darkHex);
  const l = hexRGB(lightHex);

  const img = src.get();
  img.loadPixels();
  const px = img.pixels;
  for (let i = 0; i < px.length; i += 4) {
    const y = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    px[i]     = d[0] + (l[0] - d[0]) * y;
    px[i + 1] = d[1] + (l[1] - d[1]) * y;
    px[i + 2] = d[2] + (l[2] - d[2]) * y;
  }
  img.updatePixels();
  return img;
}
