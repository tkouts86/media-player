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

// actions: { togglePlay, previous, next, seek(ms), logout }
export class PlayerView {
  constructor(show, actions) {
    this.el = fromTemplate('tpl-player');
    this.show = show;
    this.playback = null;
    this.dragPosition = null; // ms under the finger while scrubbing
    this.lastFill = -1;

    const $ = (selector) => this.el.querySelector(selector);
    this.artBox = $('.art-box');
    this.art = $('.art');
    this.title = $('.title');
    this.subtitle = $('.subtitle');
    this.artist = $('.artist');
    this.year = $('.year');
    this.progress = $('.progress');
    this.progressTrack = $('.progress-track');
    this.progressFill = $('.progress-fill');
    this.controls = $('.controls');
    this.buttons = { prev: $('.prev'), play: $('.play'), next: $('.next') };

    this.artBox.hidden = !show.art;
    this.title.hidden = !show.title;
    this.progress.hidden = !show.slider;
    this.buttons.play.hidden = !show.playPause;
    this.buttons.prev.hidden = this.buttons.next.hidden = !show.skip;
    this.controls.hidden = !show.playPause && !show.skip;
    this.controls.classList.toggle('no-play', !show.playPause);
    this.controls.classList.toggle('no-skip', !show.skip);

    this.buttons.play.addEventListener('click', actions.togglePlay);
    this.buttons.prev.addEventListener('click', actions.previous);
    this.buttons.next.addEventListener('click', actions.next);

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

    // Long-press the album art to log out (kept hidden so the screen stays uncluttered).
    let pressTimer = 0;
    this.art.addEventListener('pointerdown', () => {
      clearTimeout(pressTimer);
      pressTimer = setTimeout(actions.logout, 800);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
      this.art.addEventListener(type, () => clearTimeout(pressTimer));
    }
    this.art.addEventListener('contextmenu', (e) => e.preventDefault());

    // The art is square and as big as the space the other parts leave free.
    this.resizer = new ResizeObserver(() => {
      const size = Math.floor(Math.min(this.artBox.clientWidth, this.artBox.clientHeight));
      this.art.style.width = this.art.style.height = `${size}px`;
    });
    this.resizer.observe(this.artBox);
  }

  positionFromPointer(e) {
    const rect = this.progressTrack.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * this.playback.durationMs;
  }

  update(playback) {
    this.playback = playback;
    const artist = this.show.artist ? (playback ? playback.subtitle : 'Start playing on any device') : '';
    const year = this.show.year && playback?.year ? playback.year : '';
    setText(this.title, playback ? playback.title : 'Nothing playing');
    setText(this.artist, artist);
    setText(this.year, artist && year ? ` · ${year}` : year);
    this.subtitle.hidden = !artist && !year;
    setImage(this.art, playback?.art);

    const { prev, play, next } = this.buttons;
    play.classList.toggle('playing', !!playback?.isPlaying);
    play.setAttribute('aria-label', playback?.isPlaying ? 'Pause' : 'Play');
    for (const button of [prev, play, next]) button.disabled = !playback;
  }

  tick(position) {
    const fraction = this.playback ? (this.dragPosition ?? position) / this.playback.durationMs : 0;
    const rounded = Math.round(fraction * 2000) / 2000;
    if (rounded !== this.lastFill) {
      this.progressFill.style.transform = `scaleX(${rounded})`;
      this.lastFill = rounded;
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
