// The settings panels shown while editing. Each edits the draft layout in place, calls
// onChange() after every edit, and returns { el, refresh } so the panel can be re-synced.
import { PLAYER_PARTS } from './layout.js';
import { setImage } from './views.js';

const STANDARD_COLORS = { '#000000': 'Black', '#ffffff': 'White' };

export function paneSettings(draft, index, paneName, onChange) {
  const el = document.createElement('div');
  el.className = 'settings';
  el.innerHTML = `
    <label class="setting-row">
      <span class="pane-name"></span>
      <input type="checkbox" class="switch" data-key="on" aria-label="Show this pane">
    </label>
    <p class="setting-note" hidden>The other pane is off, so this one has to stay on.</p>
    <div class="setting-row type-row">
      <span>Pane Type</span>
      <div class="segmented">
        <label><input type="radio" name="pane-type-${index}" value="player"><span>Player</span></label>
        <label><input type="radio" name="pane-type-${index}" value="lyrics"><span>Lyrics</span></label>
      </div>
    </div>
    <div class="options">
      ${PLAYER_PARTS.map(([key, label]) => `
        <label class="setting-row"><span>${label}</span><input type="checkbox" class="switch" data-part="${key}"></label>
      `).join('')}
    </div>`;

  const pane = () => draft.panes[index];
  el.addEventListener('change', (e) => {
    const input = e.target;
    if (input.dataset.key === 'on') pane().on = input.checked;
    else if (input.type === 'radio') pane().type = input.value;
    else if (input.dataset.part) pane().show[input.dataset.part] = input.checked;
    refresh();
    onChange();
  });

  function refresh() {
    const p = pane();
    el.querySelector('.pane-name').textContent = paneName(index);
    const onSwitch = el.querySelector('[data-key="on"]');
    onSwitch.checked = p.on;
    onSwitch.disabled = p.on && !draft.panes[1 - index].on; // at least one pane stays on
    el.querySelector('.setting-note').hidden = !onSwitch.disabled;
    el.querySelector('.type-row').hidden = !p.on;
    for (const radio of el.querySelectorAll('input[type="radio"]')) radio.checked = radio.value === p.type;
    el.querySelector('.options').hidden = !p.on || p.type !== 'player';
    for (const toggle of el.querySelectorAll('[data-part]')) toggle.checked = p.show[toggle.dataset.part];
  }

  refresh();
  return { el, refresh };
}

// getArtUrl() returns the current album art, shown on the "Album art" choice.
export function backgroundSettings(draft, getArtUrl, onChange) {
  const el = document.createElement('div');
  el.className = 'settings-card';
  el.innerHTML = `
    <div class="settings-list">
      <span class="card-title">Background</span>
      <div class="swatches">
        ${Object.entries(STANDARD_COLORS).map(([color, name]) => `
          <button class="swatch" data-color="${color}"><span class="dot" style="background:${color}"></span>${name}</button>
        `).join('')}
        <label class="swatch" data-custom><input type="color" class="dot color-input" aria-label="Custom color">Custom</label>
        <button class="swatch" data-album><span class="dot"><img alt=""></span>Album Art</button>
      </div>
    </div>`;

  const colorInput = el.querySelector('.color-input');
  const pick = (background) => {
    draft.background = background;
    refresh();
    onChange();
  };
  el.addEventListener('click', (e) => {
    const swatch = e.target.closest('button.swatch');
    if (!swatch) return;
    if (swatch.dataset.color) pick({ mode: 'color', color: swatch.dataset.color });
    else pick({ ...draft.background, mode: 'album' });
  });
  // Opening the picker also counts as choosing "Custom", even before the colour is changed.
  colorInput.addEventListener('click', () => pick({ mode: 'color', color: colorInput.value }));
  colorInput.addEventListener('input', () => pick({ mode: 'color', color: colorInput.value }));

  function refresh() {
    const { mode, color } = draft.background;
    const custom = mode === 'color' && !STANDARD_COLORS[color];
    for (const swatch of el.querySelectorAll('.swatch')) {
      const selected = swatch.dataset.color ? mode === 'color' && swatch.dataset.color === color
        : 'custom' in swatch.dataset ? custom
        : mode === 'album';
      swatch.classList.toggle('selected', selected);
    }
    if (custom && colorInput.value !== color) colorInput.value = color;
    setImage(el.querySelector('[data-album] img'), getArtUrl());
  }

  colorInput.value = STANDARD_COLORS[draft.background.color] ? '#3a5a8c' : draft.background.color;
  refresh();
  return { el, refresh };
}
