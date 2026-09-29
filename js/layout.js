// The user's layout (which panes show what, and the background), saved per device,
// plus the colours derived from the background.

const KEY = 'mp.layout';

// Parts of a player pane that can be switched on and off, in settings order:
// [key, label, on by default]
export const PLAYER_PARTS = [
  ['title', 'Song Title', true],
  ['artist', 'Artist', true],
  ['album', 'Album Title', false],
  ['year', 'Year', true],
  ['slider', 'Slider', true],
  ['playPause', 'Play/Pause', true],
  ['skip', 'Fast-Forward/Rewind', true],
  ['art', 'Album Art', true],
];

export function defaultLayout() {
  const show = Object.fromEntries(PLAYER_PARTS.map(([key, , on]) => [key, on]));
  return {
    background: { mode: 'color', color: '#000000' }, // mode: 'color' | 'album'
    panes: [
      { on: true, type: 'player', show: { ...show } },
      { on: true, type: 'lyrics', show: { ...show } },
    ],
  };
}

export function loadLayout() {
  const layout = defaultLayout();
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY));
  } catch {}
  if (!saved) return layout;

  const bg = saved.background ?? {};
  layout.background = {
    mode: bg.mode === 'album' ? 'album' : 'color',
    color: /^#[0-9a-f]{6}$/i.test(bg.color) ? bg.color : '#000000',
  };
  layout.panes.forEach((pane, i) => {
    const s = saved.panes?.[i] ?? {};
    pane.on = s.on !== false;
    if (s.type === 'player' || s.type === 'lyrics') pane.type = s.type;
    for (const key of Object.keys(pane.show)) {
      if (typeof s.show?.[key] === 'boolean') pane.show[key] = s.show[key]; // new parts keep their default
    }
  });
  if (!layout.panes.some((pane) => pane.on)) layout.panes[0].on = true;
  return layout;
}

export function saveLayout(layout) {
  localStorage.setItem(KEY, JSON.stringify(layout));
}

export function copyLayout(layout) {
  return JSON.parse(JSON.stringify(layout));
}

// CSS colours for text and controls that stay readable on the given background colour.
export function themeFor(background) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16));
  const l = luminance(r, g, b);
  const dark = (l + 0.05) / 0.05 > 1.05 / (l + 0.05); // black text contrasts better than white
  const ink = dark ? '0, 0, 0' : '255, 255, 255';
  return {
    '--bg': background,
    '--fg': `rgb(${ink})`,
    '--fg-2': `rgba(${ink}, ${dark ? 0.6 : 0.56})`,  // secondary text, the "…" button
    '--fg-dim': `rgba(${ink}, ${dark ? 0.36 : 0.42})`, // lyrics that aren't playing
    '--track': `rgba(${ink}, ${dark ? 0.16 : 0.22})`,  // slider track, switches that are off
    '--surface': `rgba(${ink}, 0.08)`,
    '--panel': `rgba(${ink}, 0.1)`,  // settings panel
    '--button': `rgba(${ink}, 0.16)`, // save/cancel buttons
    '--line': `rgba(${ink}, 0.14)`,
  };
}

function luminance(r, g, b) {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

// The most prominent colour in an album cover, favouring colourful areas over large grey ones.
const colorCache = new Map();

export function albumColor(url) {
  if (!colorCache.has(url)) {
    const promise = extractColor(url);
    colorCache.set(url, promise);
    promise.catch(() => colorCache.delete(url));
  }
  return colorCache.get(url);
}

async function extractColor(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += data[i];
    bucket.g += data[i + 1];
    bucket.b += data[i + 2];
    buckets.set(key, bucket);
  }
  let best = [0, 0, 0];
  let bestScore = -1;
  for (const { n, r, g, b } of buckets.values()) {
    const rgb = [r / n, g / n, b / n];
    const max = Math.max(...rgb);
    const saturation = max ? (max - Math.min(...rgb)) / max : 0;
    const score = n * (0.35 + saturation);
    if (score > bestScore) {
      bestScore = score;
      best = rgb;
    }
  }
  return '#' + best.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
