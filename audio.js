const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;
const PROBE_EXT = ['mp3', 'wav', 'm4a', 'ogg'];
const PROBE_SEP = ['', ' ', '_', '-'];     // audio1, audio 1, audio_1, audio-1
const PROBE_MAX = 99;
const PROBE_TIMEOUT = 2500;                // мс на один запит
const SEARCH_TIMEOUT = 10000;              // мс на весь пошук

let loadToken = 0;                         // номер останнього запиту на завантаження

/* ---------- список треків ---------- */

// файл існує, якщо сервер віддає його не як html-сторінку
async function probe(name) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT);
  try {
    const r = await fetch(AUDIO_DIR + encodeURIComponent(name), { signal: ctl.signal });
    const type = r.headers.get('content-type') || '';
    const ok = r.ok && type.indexOf('text/html') === -1;
    if (r.body) r.body.cancel();           // сам файл не качаємо
    return ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function searchTracks() {
  const found = [];

  for (let n = 1; n <= PROBE_MAX; n++) {
    const names = [];
    for (const sep of PROBE_SEP) for (const ext of PROBE_EXT) names.push('audio' + sep + n + '.' + ext);

    const res = await Promise.all(names.map(probe));
    const k = res.indexOf(true);
    if (k < 0) break;                      // перша діра в нумерації — кінець
    found.push(names[k]);
  }
  if (found.length) return { names: found, via: 'numbered' };

  try {
    const r = await fetch(AUDIO_DIR);
    if (r.ok) {
      const html = await r.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const names = [...doc.querySelectorAll('a')]
        .map(a => decodeURIComponent((a.getAttribute('href') || '').split('/').pop()))
        .filter(n => AUDIO_EXT.test(n));
      const uniq = [...new Set(names)].sort();
      if (uniq.length) return { names: uniq, via: 'listing' };
    }
  } catch (e) {}

  try {
    const r = await fetch(AUDIO_DIR + 'list.json');
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j) && j.length) return { names: j, via: 'list.json' };
    }
  } catch (e) {}

  return { names: [AUDIO_FALLBACK], via: 'fallback' };
}

// пошук із загальним тайм-аутом
function findTracks() {
  ui.trackName.html('…');
  const timeout = new Promise(res =>
    setTimeout(() => res({ names: [AUDIO_FALLBACK], via: 'timeout' }), SEARCH_TIMEOUT));
  return Promise.race([searchTracks(), timeout]);
}

/* ---------- завантаження і перемикання ---------- */

// autoplay: true — після завантаження одразу грати (кнопки ‹ ›)
function loadTrack(i, autoplay) {
  if (!tracks.length) return;
  if (recorder) return;                       // під час запису не перемикаємо

  trackIdx = (i + tracks.length) % tracks.length;
  const label = (trackIdx + 1) + '/' + tracks.length;
  ui.trackName.html(label);

  // зупинити й прибрати поточний трек
  if (snd) {
    snd.stop();
    snd.dispose();
    snd = null;
  }
  lv = [0, 0, 0];
  wasPlaying = null;
  ui.play.html('play');
  ui.play.removeClass('on');
  ui.clock.html('0:00 / 0:00');
  ui.seek.value(0);

  if (autoplay) setMode(true);

  const token = ++loadToken;
  const url = AUDIO_DIR + encodeURIComponent(tracks[trackIdx]);

  loadSound(url, s => {
    if (token !== loadToken) { s.dispose(); return; }   // за цей час натиснули ще раз
    snd = s;
    fft.setInput(snd);
    if (autoplay) { userStartAudio(); snd.play(); }
  }, err => {
    if (token !== loadToken) return;
    console.log('не вдалося завантажити', url, err);
    ui.trackName.html(label + ' ✕');
  });
}

/* ---------- відтворення ---------- */

function togglePlay() {
  if (!snd) return;
  userStartAudio();
  if (snd.isPlaying()) snd.pause();
  else snd.play();
}

// на паузі рівні не оновлюються, тому кадр замерзає
function updateLevels() {
  if (!snd || !snd.isPlaying()) return;
  fft.analyze();
  const k = 1 / (ui.smooth.value() + 1);
  for (let i = 0; i < 3; i++) {
    const r = fft.getEnergy(BANDS[i][0], BANDS[i][1]) / 255;
    lv[i] = lerp(lv[i], r, k);
  }
}

// підсилені рівні 0..1
function bandsNow() {
  return lv.map((v, i) => min(1, v * ui.gain[i].value()));
}

function syncTransport() {
  if (!snd) return;
  const playing = snd.isPlaying();
  if (playing !== wasPlaying) {
    ui.play.html(playing ? 'pause' : 'play');
    playing ? ui.play.addClass('on') : ui.play.removeClass('on');
    wasPlaying = playing;
  }
  const d = snd.duration();
  if (!seeking && d) ui.seek.value(snd.currentTime() / d);
  ui.clock.html(fmt(snd.currentTime()) + ' / ' + fmt(d));
}

function fmt(sec) {
  return floor(sec / 60) + ':' + nf(floor(sec % 60), 2);
}
