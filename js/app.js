import * as auth from './auth.js';
import { spotify, ApiError } from './spotify.js';
import { getLyrics } from './lyrics.js';
import { demoApi, demoLyrics } from './demo.js';

const isDemo = new URLSearchParams(location.search).has('demo');
const api = isDemo ? demoApi : spotify;
const findLyrics = isDemo ? demoLyrics : getLyrics;

const LYRIC_LEAD_MS = 200;     // highlight a line slightly early so it feels on time
const LYRIC_ANCHOR = 0.28;     // the active line sits this far down the lyrics pane
const USER_SCROLL_HOLD_MS = 3000;
const PLACEHOLDER_ART = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1c1c1e"/>' +
  '<circle cx="40" cy="66" r="10" fill="#48484a"/><path d="M44 28h22v11H51v27h-7z" fill="#48484a"/></svg>');

const $ = (id) => document.getElementById(id);
const els = {
  login: $('login'), connect: $('connect'), loginError: $('login-error'), installHint: $('install-hint'),
  player: $('player'), art: $('art'), album: $('album'), artist: $('artist'),
  progress: $('progress'), progressTrack: $('progress-track'), progressFill: $('progress-fill'),
  prev: $('prev'), play: $('play'), next: $('next'),
  lyrics: $('lyrics'), lines: $('lyrics-lines'), empty: $('lyrics-empty'),
  emptyArt: $('lyrics-art'), emptyMessage: $('lyrics-message'), toast: $('toast'),
};

// Latest known playback, or null when nothing is playing. Progress between polls is
// estimated locally from progressMs + time since fetchedAt.
let playback = null;
let lyrics;              // undefined while loading, null when none were found
let activeLine = -1;
let autoScrolledTo = -2; // line the pane was last scrolled to; -2 forces a re-scroll
let userScrollUntil = 0;
let dragPosition = null; // ms under the finger while scrubbing the progress bar

let running = false;
let pollTimer = 0;
let version = 0;         // bumped around each command so stale poll results are dropped

start();

async function start() {
  if (isDemo) return showPlayer();
  try {
    await auth.handleRedirect();
  } catch (err) {
    return showLogin(err.message);
  }
  if (auth.isLoggedIn()) showPlayer();
  else showLogin();
}

function showLogin(error) {
  running = false;
  clearTimeout(pollTimer);
  playback = null;
  document.body.classList.remove('in-player');
  els.player.hidden = true;
  els.login.hidden = false;
  els.loginError.textContent = error || '';
  els.loginError.hidden = !error;
  els.installHint.hidden = !(isIOS() && !navigator.standalone);
}

function showPlayer() {
  els.login.hidden = true;
  els.player.hidden = false;
  document.body.classList.add('in-player');
  running = true;
  renderInfo();
  renderLyrics();
  keepAwake();
  poll();
}

// ---- Polling -------------------------------------------------------------------------------
// Spotify's API has no push updates, so ask for the player state every few seconds.

function schedulePoll(ms) {
  clearTimeout(pollTimer);
  if (running && !document.hidden) pollTimer = setTimeout(poll, ms);
}

async function poll() {
  const startedAt = version;
  let delay;
  try {
    const data = await api.getPlayback();
    if (startedAt !== version) return;
    setPlayback(normalize(data));
    if (!playback) delay = 5000;
    else if (!playback.isPlaying) delay = 4000;
    else delay = Math.min(2500, Math.max(500, playback.durationMs - playback.progressMs + 400));
  } catch (err) {
    if (startedAt !== version) return;
    delay = handleError(err);
    if (delay == null) return;
  }
  schedulePoll(delay);
}

// Returns how long to wait before polling again, or null if the user was sent to the login screen.
function handleError(err) {
  if (err instanceof auth.AuthError || (err instanceof ApiError && err.status === 401)) {
    auth.logout();
    showLogin('Your Spotify login expired. Please connect again.');
    return null;
  }
  if (err instanceof ApiError && err.status === 403) {
    auth.logout();
    showLogin(/not registered/i.test(err.message)
      ? "This Spotify account isn't on the app's user list yet. The app owner can add it under User Management in the Spotify developer dashboard."
      : `Spotify said: ${err.message}`);
    return null;
  }
  if (err instanceof ApiError && err.status === 429) return (err.retryAfter || 30) * 1000;
  return 5000; // network hiccup or Spotify outage: keep showing the last state and retry
}

function normalize(data) {
  const item = data?.item;
  if (!item) return null;
  const artists = item.artists?.map((a) => a.name) ?? [];
  return {
    id: item.id ?? item.uri,
    name: item.name,
    album: item.album?.name ?? item.show?.name ?? '',
    artist: artists.length ? artists.join(', ') : item.name,
    firstArtist: artists[0] ?? '',
    art: (item.album?.images ?? item.images)?.[0]?.url ?? null,
    durationMs: item.duration_ms,
    progressMs: data.progress_ms ?? 0,
    isPlaying: data.is_playing,
    isEpisode: data.currently_playing_type === 'episode',
    fetchedAt: performance.now(),
  };
}

function currentProgress() {
  if (!playback) return 0;
  const elapsed = playback.isPlaying ? performance.now() - playback.fetchedAt : 0;
  return Math.min(playback.progressMs + elapsed, playback.durationMs);
}

function setPlayback(next) {
  const trackChanged = next?.id !== playback?.id;
  playback = next;
  renderInfo();
  if (trackChanged) loadLyrics(next);
}

// ---- Controls ------------------------------------------------------------------------------

async function command(action, optimisticUpdate) {
  if (!playback) return;
  version++;
  optimisticUpdate?.();
  renderInfo();
  try {
    await action();
  } catch (err) {
    if (err instanceof auth.AuthError || err.status === 401) handleError(err);
    else toast(commandErrorMessage(err));
  } finally {
    version++;
    schedulePoll(700); // give Spotify a moment to apply the change, then confirm it
  }
}

function commandErrorMessage(err) {
  if (!(err instanceof ApiError)) return "Couldn't reach Spotify";
  if (err.status === 404) return 'No active device. Start playing in Spotify first.';
  if (err.reason === 'PREMIUM_REQUIRED') return 'Playback controls need Spotify Premium';
  if (err.status === 429) return 'Spotify is busy. Try again in a moment.';
  return err.message;
}

function seekTo(ms) {
  command(() => api.seek(ms), () => {
    playback.progressMs = ms;
    playback.fetchedAt = performance.now();
  });
}

els.play.addEventListener('click', () => {
  if (!playback) return;
  const wasPlaying = playback.isPlaying;
  command(() => (wasPlaying ? api.pause() : api.play()), () => {
    playback.progressMs = currentProgress();
    playback.fetchedAt = performance.now();
    playback.isPlaying = !wasPlaying;
  });
});

els.next.addEventListener('click', () => command(() => api.next()));

// Like Spotify's own apps: restart the song unless it only just started.
els.prev.addEventListener('click', () => {
  if (currentProgress() > 3000) seekTo(0);
  else command(() => api.previous());
});

els.progress.addEventListener('pointerdown', (e) => {
  if (!playback) return;
  els.progress.setPointerCapture(e.pointerId);
  dragPosition = positionFromPointer(e);
});
els.progress.addEventListener('pointermove', (e) => {
  if (dragPosition != null) dragPosition = positionFromPointer(e);
});
els.progress.addEventListener('pointerup', () => {
  if (dragPosition == null) return;
  const target = dragPosition;
  dragPosition = null;
  seekTo(target);
});
els.progress.addEventListener('pointercancel', () => { dragPosition = null; });

function positionFromPointer(e) {
  const rect = els.progressTrack.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  return fraction * playback.durationMs;
}

// Long-press the album art to log out (kept hidden so the screen stays uncluttered).
let pressTimer = 0;
els.art.addEventListener('pointerdown', () => {
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    if (!isDemo && confirm('Log out of Spotify?')) {
      auth.logout();
      showLogin();
    }
  }, 800);
});
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
  els.art.addEventListener(type, () => clearTimeout(pressTimer));
}
els.art.addEventListener('contextmenu', (e) => e.preventDefault());

els.connect.addEventListener('click', () => auth.login());

// ---- Rendering -----------------------------------------------------------------------------

function renderInfo() {
  const p = playback;
  setText(els.album, p ? p.album : 'Nothing playing');
  setText(els.artist, p ? p.artist : 'Start playing on any device');
  setImage(els.art, p?.art);
  setImage(els.emptyArt, p?.art);
  els.play.classList.toggle('playing', !!p?.isPlaying);
  els.play.setAttribute('aria-label', p?.isPlaying ? 'Pause' : 'Play');
  for (const button of [els.prev, els.play, els.next]) button.disabled = !p;
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function setImage(img, url) {
  const src = url || PLACEHOLDER_ART;
  if (img.getAttribute('src') !== src) img.src = src;
}

async function loadLyrics(track) {
  lyrics = undefined;
  renderLyrics();
  if (!track) return;
  let result = null;
  if (!track.isEpisode) {
    try {
      result = await findLyrics(track);
    } catch {}
  }
  if (playback?.id !== track.id) return; // the song changed while we were waiting
  lyrics = result;
  renderLyrics();
}

function renderLyrics() {
  activeLine = -1;
  autoScrolledTo = -2;
  els.lines.replaceChildren();
  els.lyrics.scrollTop = 0;

  const showEmpty = !!playback && lyrics !== undefined && !lyrics?.lines.length;
  els.empty.hidden = !showEmpty;
  els.lines.hidden = showEmpty;
  els.lyrics.classList.toggle('empty', showEmpty);
  if (showEmpty) {
    els.emptyMessage.textContent = lyrics?.instrumental ? 'Instrumental' : 'No lyrics available';
    return;
  }
  if (!playback || !lyrics) return;

  els.lines.classList.toggle('synced', lyrics.synced);
  els.lines.append(...lyrics.lines.map((line, i) => {
    const el = document.createElement('div');
    if (!lyrics.synced && !line.text) {
      el.className = 'gap'; // blank line between verses
      return el;
    }
    el.className = 'line';
    el.textContent = line.text || '♪';
    el.dataset.index = i;
    return el;
  }));
}

// Tap a line to jump to that point in the song.
els.lyrics.addEventListener('click', (e) => {
  const el = e.target.closest('.line');
  if (!el || !lyrics?.synced) return;
  userScrollUntil = 0;
  autoScrolledTo = -2;
  seekTo(lyrics.lines[el.dataset.index].time);
});

// While the user scrolls the lyrics, pause auto-scrolling; snap back shortly after.
els.lyrics.addEventListener('touchstart', () => { userScrollUntil = Infinity; }, { passive: true });
for (const type of ['touchend', 'touchcancel', 'wheel']) {
  els.lyrics.addEventListener(type, () => {
    userScrollUntil = performance.now() + USER_SCROLL_HOLD_MS;
    autoScrolledTo = -2;
  }, { passive: true });
}

function syncLyrics(position) {
  const lines = lyrics.lines;
  let lo = 0;
  let hi = lines.length - 1;
  let index = -1;
  while (lo <= hi) { // last line whose time has been reached
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= position + LYRIC_LEAD_MS) {
      index = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (index !== activeLine) {
    els.lines.children[activeLine]?.classList.remove('active');
    els.lines.children[index]?.classList.add('active');
    activeLine = index;
  }
  if (autoScrolledTo !== activeLine && performance.now() > userScrollUntil) {
    const el = els.lines.children[activeLine];
    const top = el ? el.offsetTop - els.lyrics.clientHeight * LYRIC_ANCHOR : 0;
    els.lyrics.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    autoScrolledTo = activeLine;
  }
}

let lastFill = -1;
function frame() {
  requestAnimationFrame(frame);
  if (!running) return;
  const fraction = playback ? (dragPosition ?? currentProgress()) / playback.durationMs : 0;
  const rounded = Math.round(fraction * 2000) / 2000;
  if (rounded !== lastFill) {
    els.progressFill.style.transform = `scaleX(${rounded})`;
    lastFill = rounded;
  }
  if (playback && lyrics?.synced) syncLyrics(currentProgress());
}
requestAnimationFrame(frame);

// ---- Screen, visibility, messages ----------------------------------------------------------

let wakeLock = null;
async function keepAwake() {
  if (!('wakeLock' in navigator) || document.hidden || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {}
}
document.addEventListener('pointerdown', () => { if (running) keepAwake(); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !running) return;
  keepAwake();
  poll();
});

let toastTimer = 0;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3000);
}

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
