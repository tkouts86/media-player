import { toLocal, localRect } from './rotation.js';

// What a pane can show. Each pane gets its own instance, so both panes can show the same kind.
// Every view has update(playback, lyrics) for new data, tick(positionMs) every frame, and destroy().

const LYRIC_LEAD_MS = 200;  // highlight a line slightly early so it feels on time
const LYRIC_ANCHOR = 0.28;  // the active line sits this far down the lyrics pane
const USER_SCROLL_HOLD_MS = 3000;
export const PLACEHOLDER_ART = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1c1c1e"/>' +
  '<circle cx="40" cy="66" r="10" fill="#48484a"/><path d="M44 28h22v11H51v27h-7z" fill="#48484a"/></svg>');

function fromTemplate(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

export function setImage(img, url) {
  const src = url || PLACEHOLDER_ART;
  if (img.getAttribute('src') !== src) img.src = src;
}

// Battery level, where the browser shares it. iPhones never do (Safari has no Battery API).
const battery = { supported: 'getBattery' in navigator, level: null };
if (battery.supported) {
  navigator.getBattery().then((b) => {
    const read = () => { battery.level = b.level; };
    read();
    b.addEventListener('levelchange', read);
  }).catch(() => { battery.supported = false; });
}
export const batterySupported = () => battery.supported;

const hour12 = new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hour12;

// "12:25", like the iPhone status bar (no AM/PM).
function formatTime(date) {
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return hour12 ? `${date.getHours() % 12 || 12}:${minutes}` : `${String(date.getHours()).padStart(2, '0')}:${minutes}`;
}

// "3:20", or "1:02:03" for long podcasts.
function formatDuration(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// actions: { togglePlay, previous, next, jump(deltaMs), seek(ms) }
export class PlayerView {
  constructor(show, actions) {
    this.el = fromTemplate('tpl-player');
    this.show = show;
    this.playback = null;
    this.dragPosition = null; // ms under the finger while scrubbing
    this.lastFill = -1;
    this.lastSecond = null;
    this.lastStatusAt = 0;

    const $ = (selector) => this.el.querySelector(selector);
    this.status = { date: $('.date'), time: $('.time'), battery: $('.battery') };
    this.artBox = $('.art-box');
    this.art = $('.art');
    this.title = $('.title');
    this.subtitle = $('.subtitle');
    this.artist = $('.artist');
    this.albumName = $('.album-name');
    this.year = $('.year');
    this.progressRow = $('.progress-row');
    this.elapsed = $('.elapsed');
    this.remaining = $('.remaining');
    this.progress = $('.progress');
    this.progressTrack = $('.progress-track');
    this.progressFill = $('.progress-fill');
    this.controls = $('.controls');
    this.buttons = {
      back15: $('.back15'), prev: $('.prev'), play: $('.play'), next: $('.next'), fwd15: $('.fwd15'),
    };

    const hasStatus = show.date || show.time || (show.battery && battery.supported);
    this.el.classList.toggle('has-status', hasStatus);
    this.el.classList.toggle('has-art', show.art);
    $('.status').hidden = !hasStatus;
    this.artBox.hidden = !show.art;
    this.title.hidden = !show.title;
    this.progressRow.hidden = !show.slider;
    const { back15, prev, play, next, fwd15 } = this.buttons;
    prev.hidden = next.hidden = !show.skip;
    back15.hidden = fwd15.hidden = !show.jump;
    this.controls.hidden = !show.playPause && !show.skip && !show.jump;
    this.controls.classList.toggle('with-jump', show.jump);
    // Without play/pause, the other buttons keep their places around an empty middle.
    this.controls.classList.toggle('no-play', !show.playPause);

    play.addEventListener('click', actions.togglePlay);
    prev.addEventListener('click', actions.previous);
    next.addEventListener('click', actions.next);
    back15.addEventListener('click', () => actions.jump(-15000));
    fwd15.addEventListener('click', () => actions.jump(15000));

    this.progress.addEventListener('pointerdown', (e) => {
      if (!this.playback) return;
      this.progress.setPointerCapture(e.pointerId);
      this.dragPosition = this.positionFromPointer(e);
    });
    this.progress.addEventListener('pointermove', (e) => {
      if (this.dragPosition != null) this.dragPosition = this.positionFromPointer(e);
    });
    this.progress.addEventListener('pointerup', () => {
      if (this.dragPosition == null) return;
      const target = this.dragPosition;
      this.dragPosition = null;
      actions.seek(target);
    });
    this.progress.addEventListener('pointercancel', () => { this.dragPosition = null; });

    // The art is square and as big as the space the other parts leave free.
    this.resizer = new ResizeObserver(() => {
      const size = Math.floor(Math.min(this.artBox.clientWidth, this.artBox.clientHeight));
      this.art.style.width = this.art.style.height = `${size}px`;
    });
    this.resizer.observe(this.artBox);
    this.renderStatus();
  }

  positionFromPointer(e) {
    const rect = localRect(this.progressTrack); // the player may be turned sideways
    const { x } = toLocal(e.clientX, e.clientY);
    return Math.min(1, Math.max(0, (x - rect.left) / rect.width)) * this.playback.durationMs;
  }

  update(playback) {
    this.playback = playback;
    setText(this.title, playback ? playback.title : 'Nothing playing');

    // Secondary line: "Artist · Album · Year", with whichever parts are switched on.
    const parts = [
      [this.artist, this.show.artist ? (playback ? playback.subtitle : 'Start playing on any device') : ''],
      [this.albumName, this.show.album ? playback?.album ?? '' : ''],
      [this.year, this.show.year ? playback?.year ?? '' : ''],
    ];
    let first = true;
    for (const [el, text] of parts) {
      setText(el, text && !first ? ` · ${text}` : text);
      el.hidden = !text;
      if (text) first = false;
    }
    this.subtitle.hidden = first;
    setImage(this.art, playback?.art);

    const { play } = this.buttons;
    play.classList.toggle('playing', !!playback?.isPlaying);
    play.setAttribute('aria-label', playback?.isPlaying ? 'Pause' : 'Play');
    for (const button of Object.values(this.buttons)) button.disabled = !playback;
  }

  // Date, time and battery, e.g. "Oct 6   12:25   87%".
  renderStatus() {
    const now = new Date();
    const values = {
      date: this.show.date ? now.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '',
      time: this.show.time ? formatTime(now) : '',
      battery: this.show.battery && battery.level != null ? `${Math.round(battery.level * 100)}%` : '',
    };
    for (const [key, text] of Object.entries(values)) {
      setText(this.status[key], text);
      this.status[key].hidden = !text;
    }
  }

  tick(position) {
    const shown = this.playback ? this.dragPosition ?? position : 0; // follows the finger while scrubbing
    const fraction = this.playback ? shown / this.playback.durationMs : 0;
    const rounded = Math.round(fraction * 2000) / 2000;
    if (rounded !== this.lastFill) {
      this.progressFill.style.transform = `scaleX(${rounded})`;
      this.lastFill = rounded;
    }

    // Elapsed and remaining time, e.g. "0:11" and "-3:20"; they always add up to the length.
    const second = this.playback ? Math.floor(shown / 1000) : null;
    if (second !== this.lastSecond) {
      this.lastSecond = second;
      const total = this.playback ? Math.round(this.playback.durationMs / 1000) : 0;
      setText(this.elapsed, this.playback ? formatDuration(second) : '');
      setText(this.remaining, this.playback ? `-${formatDuration(total - second)}` : '');
    }

    const now = performance.now();
    if (now - this.lastStatusAt > 1000) {
      this.lastStatusAt = now;
      this.renderStatus();
    }
  }

  destroy() {
    this.resizer.disconnect();
  }
}

export class LyricsView {
  constructor(actions) {
    this.el = fromTemplate('tpl-lyrics');
    this.lines = this.el.querySelector('.lyrics-lines');
    this.empty = this.el.querySelector('.lyrics-empty');
    this.emptyArt = this.el.querySelector('.lyrics-art');
    this.emptyMessage = this.el.querySelector('.lyrics-message');
    this.trackId = undefined;
    this.lyrics = undefined; // undefined while loading, null when none were found
    this.activeLine = -1;
    this.autoScrolledTo = -2; // line the view was last scrolled to; -2 forces a re-scroll
    this.userScrollUntil = 0;

    // Tap a line to jump to that point in the song.
    this.el.addEventListener('click', (e) => {
      const line = e.target.closest('.line');
      if (!line || !this.lyrics?.synced) return;
      this.userScrollUntil = 0;
      this.autoScrolledTo = -2;
      actions.seek(this.lyrics.lines[line.dataset.index].time);
    });

    // While the user scrolls the lyrics, pause auto-scrolling; snap back shortly after.
    this.el.addEventListener('touchstart', () => { this.userScrollUntil = Infinity; }, { passive: true });
    for (const type of ['touchend', 'touchcancel', 'wheel']) {
      this.el.addEventListener(type, () => {
        this.userScrollUntil = performance.now() + USER_SCROLL_HOLD_MS;
        this.autoScrolledTo = -2;
      }, { passive: true });
    }
  }

  update(playback, lyrics) {
    setImage(this.emptyArt, playback?.art);
    const trackId = playback?.id ?? null;
    if (trackId === this.trackId && lyrics === this.lyrics) return;
    this.trackId = trackId;
    this.lyrics = lyrics;
    this.render(!!playback);
  }

  render(hasPlayback) {
    this.activeLine = -1;
    this.autoScrolledTo = -2;
    this.lines.replaceChildren();
    this.el.scrollTop = 0;

    const lyrics = this.lyrics;
    const showEmpty = hasPlayback && lyrics !== undefined && !lyrics?.lines.length;
    this.empty.hidden = !showEmpty;
    this.lines.hidden = showEmpty;
    this.el.classList.toggle('empty', showEmpty);
    if (showEmpty) {
      this.emptyMessage.textContent = lyrics?.instrumental ? 'Instrumental' : 'No lyrics available';
      return;
    }
    if (!hasPlayback || !lyrics) return;

    this.lines.classList.toggle('synced', lyrics.synced);
    this.lines.append(...lyrics.lines.map((line, i) => {
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

  tick(position) {
    if (!this.lyrics?.synced) return;
    const lines = this.lyrics.lines;
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
    if (index !== this.activeLine) {
      this.lines.children[this.activeLine]?.classList.remove('active');
      this.lines.children[index]?.classList.add('active');
      this.activeLine = index;
    }
    if (this.autoScrolledTo !== this.activeLine && performance.now() > this.userScrollUntil) {
      const el = this.lines.children[this.activeLine];
      const top = el ? el.offsetTop - this.el.clientHeight * LYRIC_ANCHOR : 0;
      this.el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      this.autoScrolledTo = this.activeLine;
    }
  }

  destroy() {}
}
