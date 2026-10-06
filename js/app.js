import * as auth from './auth.js';
import { spotify, ApiError } from './spotify.js';
import { getLyrics } from './lyrics.js';
import { demoApi, demoLyrics } from './demo.js';
import * as link from './link.js';
import { PlayerView, LyricsView } from './views.js';
import { loadLayout, saveLayout, copyLayout, themeFor, albumColor } from './layout.js';
import { paneSettings, backgroundSettings } from './editor.js';

const isDemo = new URLSearchParams(location.search).has('demo');
const api = isDemo ? demoApi : spotify;
const findLyrics = isDemo ? demoLyrics : getLyrics;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const els = {
  login: $('login'), connect: $('connect'), loginError: $('login-error'), installHint: $('install-hint'),
  useOtherDevice: $('use-other-device'),
  linkReceive: $('link-receive'), linkUrl: $('link-url'), linkForm: $('link-form'), linkInput: $('link-input'),
  linkSubmit: $('link-submit'), linkError: $('link-error'), linkBack: $('link-back'),
  linkSend: $('link-send'), linkSendStart: $('link-send-start'), linkSendCode: $('link-send-code'),
  linkLogin: $('link-login'), linkCode: $('link-code'), linkStatus: $('link-status'), linkNew: $('link-new'),
  player: $('player'), panes: $('panes'), paneSlots: [$('pane-0'), $('pane-1')],
  toolbar: $('toolbar'), saveButton: $('save-button'), cancelButton: $('cancel-button'),
  menu: $('menu'), menuItems: $('menu-items'), menuVersion: $('menu-version'), bgFrame: $('bg-frame'), toast: $('toast'),
};
const screens = [els.login, els.linkReceive, els.linkSend, els.player];
const portrait = matchMedia('(orientation: portrait)');

// Latest known playback, or null when nothing is playing. Progress between polls is
// estimated locally from progressMs + time since fetchedAt.
let playback = null;
let lyrics;              // undefined while loading, null when none were found
let views = [];          // what the panes currently show
let albumBackground = '#000000';

let layout = loadLayout();
let draft = null;        // copy of the layout being edited
let editing = null;      // null, a pane index (0/1) or 'background'
let settings = null;     // the open settings panel: { el, refresh }

let running = false;
let pollTimer = 0;
let version = 0;         // bumped around each command so stale poll results are dropped

async function start() {
  renderLayout();
  if (isDemo) return showPlayer();
  let result;
  try {
    result = await auth.handleRedirect();
  } catch (err) {
    return showLogin(err.message);
  }
  if (result?.refreshTokenForAnotherDevice) showLinkSend(result.refreshTokenForAnotherDevice);
  else if (new URLSearchParams(location.search).has('link')) showLinkSend();
  else if (auth.isLoggedIn()) showPlayer();
  else showLogin();
}

function showScreen(screen) {
  for (const s of screens) s.hidden = s !== screen;
  if (screen !== els.player) {
    running = false;
    clearTimeout(pollTimer);
    playback = null;
  }
}

function showLogin(error) {
  showScreen(els.login);
  els.loginError.textContent = error || '';
  els.loginError.hidden = !error;
  els.installHint.hidden = !(isIOS() && !navigator.standalone);
}

function showPlayer() {
  showScreen(els.player);
  running = true;
  updateViews();
  keepAwake();
  poll();
  checkForUpdate();
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
  const isEpisode = data.currently_playing_type === 'episode' || item.type === 'episode';
  const artists = item.artists?.map((a) => a.name) ?? [];
  const year = (isEpisode ? item.release_date : item.album?.release_date)?.slice(0, 4);
  return {
    id: item.id ?? item.uri,
    name: item.name,
    album: item.album?.name ?? '',
    firstArtist: artists[0] ?? '',
    // Main text: the song or episode title. Secondary text: the artists, or the podcast's name.
    title: item.name,
    subtitle: isEpisode ? item.show?.name ?? '' : artists.join(', '),
    year: year && year !== '0000' ? year : '',
    art: (item.album?.images ?? item.images ?? item.show?.images)?.[0]?.url ?? null,
    durationMs: item.duration_ms,
    progressMs: data.progress_ms ?? 0,
    isPlaying: data.is_playing,
    isEpisode,
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
  const artChanged = next?.art !== playback?.art;
  playback = next;
  updateViews();
  if (trackChanged) loadLyrics(next);
  if (artChanged) updateAlbumBackground();
}

async function loadLyrics(track) {
  lyrics = undefined;
  updateViews();
  if (!track) return;
  let result = null;
  if (!track.isEpisode) {
    try {
      result = await findLyrics(track);
    } catch {}
  }
  if (playback?.id !== track.id) return; // the song changed while we were waiting
  lyrics = result;
  updateViews();
}

function updateViews() {
  for (const view of views) view.update(playback, lyrics);
  settings?.refresh();
}

// ---- Controls ------------------------------------------------------------------------------

async function command(action, optimisticUpdate) {
  if (!playback) return;
  version++;
  optimisticUpdate?.();
  updateViews();
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

const actions = {
  togglePlay() {
    if (!playback) return;
    const wasPlaying = playback.isPlaying;
    command(() => (wasPlaying ? api.pause() : api.play()), () => {
      playback.progressMs = currentProgress();
      playback.fetchedAt = performance.now();
      playback.isPlaying = !wasPlaying;
    });
  },
  next: () => command(() => api.next()),
  // Like Spotify's own apps: restart the song unless it only just started.
  previous() {
    if (currentProgress() > 3000) seekTo(0);
    else command(() => api.previous());
  },
  // The 15-second skip buttons.
  jump(deltaMs) {
    if (!playback) return;
    seekTo(Math.min(Math.max(0, currentProgress() + deltaMs), playback.durationMs - 1000));
  },
  seek: seekTo,
};

els.connect.addEventListener('click', () => auth.login());

// ---- Panes and background ------------------------------------------------------------------

// Sizes inside a pane are in units of its height (capped for narrow panes), set as --u.
// contentRect leaves out the pane's padding for the notch and home indicator.
const paneSizer = new ResizeObserver((entries) => {
  for (const { target, contentRect } of entries) {
    target.style.setProperty('--u', `${Math.min(contentRect.height, contentRect.width * 1.2) / 100}px`);
  }
});
els.paneSlots.forEach((slot) => paneSizer.observe(slot));

function sideName(index) {
  return (portrait.matches ? ['top', 'bottom'] : ['left', 'right'])[index];
}

const slotViews = [null, null]; // the view shown in each pane slot, if any

// Fills each pane slot from the layout being shown (the draft while editing). A slot whose
// content hasn't changed is left alone, so the other pane doesn't flicker or lose its scroll.
function renderLayout() {
  const shown = draft ?? layout;
  els.player.dataset.editing = editing ?? ''; // the save/cancel buttons sit over the pane being edited
  els.paneSlots.forEach((slot, i) => {
    const pane = shown.panes[i];
    const hostsSettings = editing === 1 - i; // settings take over the other pane
    const content = editing === 'background' ? 'empty' // panes hide while picking a colour
      : hostsSettings ? 'settings'
      : pane.on ? `${pane.type}:${JSON.stringify(pane.show)}`
      : 'hidden';
    slot.hidden = content === 'hidden';
    slot.classList.toggle('hosts-settings', hostsSettings);
    slot.classList.toggle('locked', editing === i); // the pane being edited is a preview only
    if (content === slot.dataset.content && (content !== 'settings' || slot.firstChild === settings.el)) return;

    slot.dataset.content = content;
    slotViews[i]?.destroy();
    slotViews[i] = null;
    if (content === 'settings') {
      slot.replaceChildren(settings.el);
    } else if (content === 'empty' || content === 'hidden') {
      slot.replaceChildren();
    } else {
      const view = pane.type === 'player' ? new PlayerView(pane.show, actions) : new LyricsView(actions);
      slot.replaceChildren(view.el);
      view.update(playback, lyrics);
      slotViews[i] = view;
    }
  });
  views = slotViews.filter(Boolean);
  // With one pane showing, it's the main pane, centred on the screen.
  els.panes.classList.toggle('single', els.paneSlots.filter((slot) => !slot.hidden).length === 1);
  applyTheme();
}

function applyTheme() {
  const { mode, color } = (draft ?? layout).background;
  const theme = themeFor(mode === 'album' ? albumBackground : color);
  for (const [name, value] of Object.entries(theme)) els.player.style.setProperty(name, value);
}

async function updateAlbumBackground() {
  const url = playback?.art;
  let color = '#000000';
  if (url) {
    try {
      color = await albumColor(url);
    } catch {}
  }
  if (playback?.art !== url) return;
  albumBackground = color;
  applyTheme();
}

portrait.addEventListener('change', () => settings?.refresh());

function changeLayout(change) {
  change(layout);
  saveLayout(layout);
  renderLayout();
}

function hidePane(index) {
  changeLayout((l) => { l.panes[index].on = false; });
}

function swapPanes() {
  changeLayout((l) => l.panes.reverse());
}

// With only one pane showing: bring the hidden one back on the chosen side (0 = left/top).
function addPane(mainIndex, side) {
  changeLayout((l) => {
    const main = l.panes[mainIndex];
    const added = l.panes[1 - mainIndex];
    added.on = true;
    l.panes = side === 0 ? [added, main] : [main, added];
  });
}

// Swiping sideways flips a pane between player and lyrics.
function switchPaneType(index, towardLeft) {
  changeLayout((l) => {
    l.panes[index].type = l.panes[index].type === 'player' ? 'lyrics' : 'player';
  });
  slotViews[index]?.el.classList.add(towardLeft ? 'enter-from-right' : 'enter-from-left');
}

// ---- Pressing and holding a pane, swiping a pane -------------------------------------------

const LONG_PRESS_MS = 550;
const SWIPE_MIN_PX = 60;

els.paneSlots.forEach((slot, index) => {
  let start = null;
  let timer = 0;
  let suppressClick = false;

  slot.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || editing !== null || e.target.closest('.progress')) return; // the slider drags
    start = { x: e.clientX, y: e.clientY, at: performance.now() };
    suppressClick = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      suppressClick = true; // lifting the finger shouldn't also tap whatever is underneath
      openPaneMenu(index, start.x, start.y);
      start = null;
    }, LONG_PRESS_MS);
  });
  slot.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clearTimeout(timer);
  });
  slot.addEventListener('pointerup', (e) => {
    clearTimeout(timer);
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const quick = performance.now() - start.at < 800;
    start = null;
    if (quick && Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > 2 * Math.abs(dy)) {
      suppressClick = true;
      switchPaneType(index, dx < 0);
    }
  });
  slot.addEventListener('pointercancel', () => {
    clearTimeout(timer);
    start = null;
  });
  slot.addEventListener('click', (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  slot.addEventListener('contextmenu', (e) => e.preventDefault());
});

function openPaneMenu(index, x, y) {
  const both = layout.panes.every((pane) => pane.on);
  const items = [
    ['Edit pane', () => startEditing(index)],
    ['Edit background', () => startEditing('background')],
    ...(both
      ? [['Hide pane', () => hidePane(index)], ['Swap panes', swapPanes]]
      : [0, 1].map((side) => [`Add ${sideName(side)} pane`, () => addPane(index, side)])),
  ];
  els.menuItems.replaceChildren(...items.map(([label, run]) => {
    const button = document.createElement('button');
    button.setAttribute('role', 'menuitem');
    button.textContent = label;
    button.addEventListener('click', () => {
      closeMenu();
      run();
    });
    return button;
  }));
  // Shows which version is running, to check that an update arrived.
  els.menuVersion.textContent = Number.isNaN(loadedVersion) ? '' : `Updated ${new Date(loadedVersion)
    .toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;

  // Open next to the finger, kept on screen.
  els.menu.hidden = false;
  const { width, height } = els.menu.getBoundingClientRect();
  els.menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
  els.menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
}

function closeMenu() {
  els.menu.hidden = true;
}

document.addEventListener('pointerdown', (e) => {
  if (!els.menu.hidden && !els.menu.contains(e.target)) closeMenu();
});

// ---- Editing -------------------------------------------------------------------------------

function startEditing(target) {
  editing = target;
  draft = copyLayout(layout);
  if (target === 'background') {
    settings = backgroundSettings(draft, () => playback?.art, renderLayout);
    els.bgFrame.replaceChildren(settings.el);
    els.bgFrame.hidden = false;
  } else {
    settings = paneSettings(draft, target, renderLayout, isDemo ? null : logOutFromSettings);
  }
  els.toolbar.hidden = false;
  renderLayout();
}

function finishEditing(save) {
  if (save) {
    layout = draft;
    saveLayout(layout);
  } else if (JSON.stringify(draft) !== JSON.stringify(layout) && !confirm('Discard your changes?')) {
    return;
  }
  closeEditor();
}

function closeEditor() {
  draft = null;
  editing = null;
  settings = null;
  els.bgFrame.hidden = true;
  els.bgFrame.replaceChildren();
  els.toolbar.hidden = true;
  renderLayout();
}

function logOutFromSettings() {
  if (!confirm('Log out of Spotify?')) return;
  closeEditor();
  auth.logout();
  showLogin();
}

els.saveButton.addEventListener('click', () => finishEditing(true));
els.cancelButton.addEventListener('click', () => finishEditing(false));

// ---- Logging in via another device ---------------------------------------------------------
// For phones where Spotify's own login page doesn't work (e.g. an iPhone 7 on iOS 15): log in
// on a device where it does, which shows a 6-digit code to type in here.

els.useOtherDevice.addEventListener('click', () => {
  showScreen(els.linkReceive);
  els.linkUrl.textContent = `${auth.REDIRECT_URI.replace(/^https?:\/\//, '')}?link`;
  els.linkError.hidden = true;
});
els.linkBack.addEventListener('click', () => showLogin());

els.linkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = els.linkInput.value.replace(/\D/g, '');
  if (code.length !== 6) return showLinkError('Enter the 6-digit code shown on your other device.');
  els.linkError.hidden = true;
  els.linkSubmit.disabled = true;
  els.linkSubmit.textContent = 'Connecting…';
  try {
    await auth.loginWithRefreshToken(await link.receiveLogin(code));
  } catch (err) {
    return showLinkError(
      err instanceof link.NoAnswerError ? 'No device answered. Check the code, and make sure the other device is still showing it.'
        : err instanceof auth.AuthError ? "Spotify didn't accept that login. Make a new code on the other device and try again."
        : "Couldn't connect. Check the internet connection and try again.");
  } finally {
    els.linkSubmit.disabled = false;
    els.linkSubmit.textContent = 'Connect';
  }
  els.linkInput.value = '';
  showPlayer();
});

function showLinkError(message) {
  els.linkError.textContent = message;
  els.linkError.hidden = false;
}

// On the device where login works: after logging in "for another device", show a code.
let offer = null;
let offerTimer = 0;
let offerToken = null;

function showLinkSend(refreshToken) {
  showScreen(els.linkSend);
  els.linkSendStart.hidden = !!refreshToken;
  els.linkSendCode.hidden = !refreshToken;
  if (refreshToken) {
    offerToken = refreshToken;
    startOffer();
  }
}

async function startOffer() {
  offer?.stop();
  clearTimeout(offerTimer);
  let sent = false;
  els.linkStatus.textContent = 'Waiting for your other device…';
  els.linkNew.hidden = true;
  offer = await link.offerLogin(offerToken, () => {
    sent = true;
    els.linkStatus.textContent = 'Sent! Your other device is logging in.';
  });
  els.linkCode.textContent = `${offer.code.slice(0, 3)} ${offer.code.slice(3)}`;
  offerTimer = setTimeout(() => {
    offer.stop();
    if (sent) return;
    els.linkCode.textContent = '––– –––';
    els.linkStatus.textContent = 'This code expired.';
    els.linkNew.hidden = false;
  }, LINK_CODE_TTL_MS);
}

els.linkLogin.addEventListener('click', () => auth.login({ forAnotherDevice: true }));
els.linkNew.addEventListener('click', startOffer);

// ---- Every frame ---------------------------------------------------------------------------

function frame() {
  requestAnimationFrame(frame);
  if (!running) return;
  const position = currentProgress();
  for (const view of views) view.tick(position);
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
  checkForUpdate();
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

// ---- Updates -------------------------------------------------------------------------------
// Reopening a Home Screen app (on iOS 15 especially) resumes the old page instead of reloading
// it, so a new version never shows up. GitHub Pages stamps every file of a deploy with the same
// Last-Modified time: when the server's is newer than this page's, reload. The service worker
// (sw.js) makes that reload fetch the new files rather than cached ones.

const UPDATE_CHECK_MS = 30 * 60 * 1000;
let loadedVersion = Date.parse(document.lastModified); // NaN if the browser can't tell

async function checkForUpdate() {
  if (!running || editing !== null || document.hidden) return; // never lose unsaved edits
  let serverVersion;
  try {
    const res = await fetch('./', { method: 'HEAD', cache: 'no-store' });
    serverVersion = Date.parse(res.headers.get('Last-Modified'));
  } catch {
    return;
  }
  if (Number.isNaN(serverVersion)) return;
  if (Number.isNaN(loadedVersion) || serverVersion <= loadedVersion) {
    loadedVersion = serverVersion; // up to date (this also corrects an odd document.lastModified)
    return;
  }
  // Reload once per new version, so a clock or parsing quirk can't cause a reload loop.
  try {
    if (sessionStorage.getItem('mp.reloadedFor') === String(serverVersion)) return;
    sessionStorage.setItem('mp.reloadedFor', String(serverVersion));
  } catch {}
  location.reload();
}

setInterval(checkForUpdate, UPDATE_CHECK_MS); // for a screen that's left on all day
navigator.serviceWorker?.register('sw.js').catch(() => {});

start(); // last, so everything above is set up first
