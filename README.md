# Media Player

A full-screen "now playing" display and remote for Spotify, built for iPhone.
Album art, playback controls and time-synced lyrics (tap a line to jump to it), in two panes
side by side (landscape) or stacked (portrait). It always opens in landscape. Turning the phone
switches the layout to match (nothing changes if it already matches), and *Portrait* / *Landscape*
in the press-and-hold menu switches it without turning the phone — with rotation lock on, that's
how you get landscape, drawn sideways. (iOS draws its status bar along the phone's top edge and
hides it in true landscape, so the battery only shows the right way up in portrait.)

It's a plain static website — no server, no build step. Login uses Spotify's PKCE flow,
lyrics come from [LRCLIB](https://lrclib.net).

## Run locally

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Open http://127.0.0.1:8080/ (use `127.0.0.1`, not `localhost` — Spotify only accepts the former).
Add `?demo` to the address to preview the layout with fake data and no login.

## Spotify dashboard settings

At https://developer.spotify.com/dashboard, in this app's settings:

- **Redirect URIs** must include every address the app is opened from, exactly, with the trailing slash:
  - `http://127.0.0.1:8080/`
  - `https://<github-username>.github.io/media-player/`
- **User Management**: add each person's Spotify email (5 users max in Development Mode).

The Client ID lives in `js/config.js`.

## Using it on iPhone

1. Open the site in Safari → Share → **Add to Home Screen**.
2. Open **Media Player** from the Home Screen (this hides Safari's bars) and connect Spotify there.
   Home Screen apps keep their own login, separate from Safari.
3. Music plays on another device; this screen controls it.

Long-press the album art to log out. Spotify requires logging in again every 6 months.

## Updates

After a push, open phones pick up the new version the next time the app comes back on screen,
or within 30 minutes if it's left on (never in the middle of editing settings). The **…** menu
shows when the running version was published. `sw.js` makes sure a reload fetches the new files
instead of cached ones.

## Customizing

**Press and hold** a pane for its options: *Edit pane*, *Edit background*, *Hide pane* and
*Swap panes*, plus *Portrait* or *Landscape*. With only one pane showing (the main pane), *Hide* and *Swap* become
*Add left pane* and *Add right pane* (top/bottom in portrait). **Swipe sideways** on a pane to flip it between player and lyrics.

While editing, the pane is a dimmed preview and its settings take over the other side; tap ✓ to
keep the changes or ✕ to discard them. Settings are saved on each device separately.

- **Player panes** show the song title with "Artist · Album · Year" below, an optional
  "date, time, battery" line at the top, elapsed/remaining time under the slider, and optional
  15-second skip buttons that sit next to play/pause; each part (and the album art, slider,
  play/pause and fast-forward/rewind) can be switched off. The album art grows to
  fill the space. *Battery* only works in Chrome-based browsers; iPhones don't share it with websites.
- **Background** can be black, white, any custom colour, or matched to the album art. Text and
  controls switch between light and dark to stay readable.
- **Log out** from the bottom of a player or lyrics pane's settings.

### Older iPhones (iOS 15 and earlier)

- **Spotify's login page may not work.** On the login screen, tap *Spotify login not working? Use
  another device*. On a phone or computer where login works, open the site with `?link` at the end
  and log in; it shows a 6-digit code to type on the older phone. The two devices exchange the login
  through [ntfy.sh](https://ntfy.sh), a free public relay, end-to-end encrypted so the relay can't
  read it.
- **The screen can't be kept awake automatically** (that needs iOS 16.4+). Set
  Settings → Display & Brightness → Auto-Lock → **Never** on a phone used as a dedicated display.
