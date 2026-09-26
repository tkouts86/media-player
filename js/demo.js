// A fake player used when the page is opened with ?demo, so the layout can be previewed
// without logging in to Spotify. It mimics the shape of Spotify's /me/player response.

const art = (from, to) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g" x2="1" y2="1">` +
  `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
  `<rect width="10" height="10" fill="url(#g)"/></svg>`);

const tracks = [
  {
    id: 'demo-1', name: 'Demo Song', album: 'Album Name', artists: ['Artist'],
    art: art('#f2994a', '#eb5757'), durationMs: 66000,
    lyrics: {
      synced: true,
      lines: [
        [4000, 'This is a demo of Media Player'],
        [8000, 'The line playing right now turns white'],
        [12500, 'Everything before and after stays gray'],
        [17000, 'Tap any line to jump straight to it'],
        [22000, 'Long lines wrap onto a second row, just like this one does on a phone'],
        [28000, ''],
        [32000, 'Drag the progress bar to scrub'],
        [37000, 'Or scroll the lyrics yourself for a moment'],
        [41500, 'They snap back into place when you let go'],
        [46000, 'Real songs pull synced lyrics from LRCLIB'],
        [51000, 'When none exist you see the album art instead'],
        [56000, 'Skip ahead to see that screen next'],
        [61000, ''],
      ].map(([time, text]) => ({ time, text })),
    },
  },
  {
    id: 'demo-2', name: 'Second Song', album: 'A Much Longer Album Name That Will Not Fit', artists: ['Another Artist', 'Featured Guest'],
    art: art('#56ccf2', '#2f80ed'), durationMs: 40000, lyrics: null,
  },
  {
    id: 'demo-3', name: 'Quiet Song', album: 'Instrumentals', artists: ['Artist'],
    art: art('#6fcf97', '#219653'), durationMs: 30000, lyrics: { instrumental: true, synced: false, lines: [] },
  },
];

let index = 0;
let playing = true;
let position = 0;
let since = Date.now();

const now = () => position + (playing ? Date.now() - since : 0);

function jump(i, ms) {
  index = i;
  position = ms;
  since = Date.now();
}

export const demoApi = {
  async getPlayback() {
    while (now() >= tracks[index].durationMs) jump((index + 1) % tracks.length, now() - tracks[index].durationMs);
    const t = tracks[index];
    return {
      is_playing: playing,
      progress_ms: now(),
      currently_playing_type: 'track',
      item: {
        id: t.id, name: t.name, duration_ms: t.durationMs,
        album: { name: t.album, images: [{ url: t.art }] },
        artists: t.artists.map((name) => ({ name })),
      },
    };
  },
  async play() { jump(index, now()); playing = true; },
  async pause() { jump(index, now()); playing = false; },
  async next() { jump((index + 1) % tracks.length, 0); },
  async previous() { jump((index + tracks.length - 1) % tracks.length, 0); },
  async seek(ms) { jump(index, ms); },
};

export async function demoLyrics(track) {
  return tracks.find((t) => t.id === track.id)?.lyrics ?? null;
}
