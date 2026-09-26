# Media Player

A full-screen, landscape "now playing" display and remote for Spotify, built for iPhone.
Album art, playback controls and time-synced lyrics (tap a line to jump to it).

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
3. Turn the phone sideways. Music plays on another device; this screen controls it.

Long-press the album art to log out. Spotify requires logging in again every 6 months.

### Older iPhones (iOS 15 and earlier)

- **Spotify's login page may not work.** On the login screen, tap *Spotify login not working? Use
  another device*. On a phone or computer where login works, open the site with `?link` at the end,
  log in, tap **Copy code**, and paste the code on the older phone.
- **The screen can't be kept awake automatically** (that needs iOS 16.4+). Set
  Settings → Display & Brightness → Auto-Lock → **Never** on a phone used as a dedicated display.
