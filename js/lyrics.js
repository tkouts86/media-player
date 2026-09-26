// Lyrics come from LRCLIB (https://lrclib.net), a free, open database of time-synced lyrics.
// Spotify's API doesn't provide lyrics.
//
// Result shape: null when nothing was found, otherwise
//   { synced: true,  lines: [{ time: ms, text }] }   lines light up in time with the song
//   { synced: false, lines: [{ time: null, text }] } plain lyrics, no timing
//   { instrumental: true, synced: false, lines: [] }

const cache = new Map();

export function getLyrics(track) {
  if (!cache.has(track.id)) {
    const promise = withRetry(() => fetchLyrics(track));
    cache.set(track.id, promise);
    promise.catch(() => cache.delete(track.id)); // try again next time the song comes up
  }
  return cache.get(track.id);
}

// LRCLIB occasionally answers 503 for a moment; try a couple more times before giving up.
async function withRetry(fn, delays = [2000, 5000]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= delays.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

async function fetchLyrics({ name, firstArtist, album, durationMs }) {
  const seconds = durationMs / 1000;
  const exact = await lrclib('get', {
    track_name: name, artist_name: firstArtist, album_name: album, duration: Math.round(seconds),
  });
  if (exact && hasLyrics(exact)) return parse(exact);

  // Fall back to a looser search, e.g. when the album or a " - Remastered" suffix differs.
  const results = (await lrclib('search', { track_name: cleanTitle(name), artist_name: firstArtist })) || [];
  const close = results.filter((r) => Math.abs(r.duration - seconds) <= 3);
  const best = close.find((r) => r.syncedLyrics) || close.find((r) => r.plainLyrics) || close.find((r) => r.instrumental);
  return best ? parse(best) : null;
}

async function lrclib(endpoint, params) {
  const res = await fetch(`https://lrclib.net/api/${endpoint}?${new URLSearchParams(params)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB error ${res.status}`);
  return res.json();
}

function hasLyrics(r) {
  return r.instrumental || r.syncedLyrics || r.plainLyrics;
}

function parse(r) {
  if (r.syncedLyrics) return { synced: true, lines: parseLrc(r.syncedLyrics) };
  if (r.plainLyrics) return { synced: false, lines: r.plainLyrics.split('\n').map((text) => ({ time: null, text: text.trim() })) };
  return { instrumental: true, synced: false, lines: [] };
}

// "[01:23.45] some words" -> { time: 83450, text: "some words" }
function parseLrc(lrc) {
  const lines = [];
  for (const raw of lrc.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const [, min, sec] of stamps) lines.push({ time: (Number(min) * 60 + Number(sec)) * 1000, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

// "Song - Remastered 2011" / "Song (feat. Someone)" -> "Song"
function cleanTitle(name) {
  return name
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s*[([](feat\.?|ft\.?|with)\s[^)\]]*[)\]]/gi, '')
    .trim();
}
