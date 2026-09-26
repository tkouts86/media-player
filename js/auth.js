// Spotify login using the Authorization Code + PKCE flow, which needs no client secret or server.
import { CLIENT_ID } from './config.js';

const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
// Spotify sends the user back to the folder this page is served from, e.g. http://127.0.0.1:8080/
// or https://<username>.github.io/media-player/. Each one must be listed as a Redirect URI
// in the Spotify dashboard, character for character (including the trailing slash).
export const REDIRECT_URI = new URL('.', location.href).href;
const TOKEN_KEY = 'mp.token';
const PKCE_KEY = 'mp.pkce';

// The saved login is missing or no longer valid; the user has to connect again.
export class AuthError extends Error {}

// With forAnotherDevice, the login isn't kept here: handleRedirect() instead returns it so it can
// be handed to a device where Spotify's login page doesn't work (e.g. an iPhone on iOS 15).
export async function login({ forAnotherDevice = false } = {}) {
  const verifier = randomString(64);
  const state = randomString(16);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, forAnotherDevice }));
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    show_dialog: 'true', // lets people switch Spotify accounts
  });
  // Same-window navigation keeps an iPhone Home Screen app in its own window and storage.
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

// Finishes a login if Spotify just redirected back here with ?code=… (or ?error=…).
// Resolves to { refreshTokenForAnotherDevice } when the login was started for another device.
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return;

  history.replaceState(null, '', REDIRECT_URI);
  const pkce = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null');
  localStorage.removeItem(PKCE_KEY);

  if (error) throw new AuthError(error === 'access_denied' ? 'Spotify login was cancelled.' : `Spotify login failed: ${error}`);
  if (!pkce || params.get('state') !== pkce.state) throw new AuthError('That login link expired. Please try again.');
  const fields = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: pkce.verifier };
  if (!pkce.forAnotherDevice) return void (await requestToken(fields));
  // This is a separate login from this device's own, which stays untouched.
  const token = await requestToken(fields, { save: false });
  return { refreshTokenForAnotherDevice: token.refreshToken };
}

// Logs in with a login made by login({ forAnotherDevice: true }) on another device.
export async function loginWithRefreshToken(refreshToken) {
  await requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

export function isLoggedIn() {
  return !!loadToken();
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}

// Forces the next getAccessToken() to refresh, e.g. after Spotify rejects the current token.
export function expireAccessToken() {
  const token = loadToken();
  if (token) saveToken({ ...token, expiresAt: 0 });
}

let refreshing = null;

export async function getAccessToken() {
  const token = loadToken();
  if (!token) throw new AuthError('Not logged in');
  if (Date.now() < token.expiresAt) return token.accessToken;
  refreshing ??= requestToken({ grant_type: 'refresh_token', refresh_token: token.refreshToken })
    .finally(() => { refreshing = null; });
  return (await refreshing).accessToken;
}

async function requestToken(fields, { save = true } = {}) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...fields }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error_description || data.error || `Spotify login failed (${res.status})`;
    // 400/401 mean the login itself is bad (e.g. the 6-month refresh token expired); anything
    // else is a temporary Spotify problem and the saved login should be kept.
    throw res.status === 400 || res.status === 401 ? new AuthError(message) : new Error(message);
  }
  const token = {
    accessToken: data.access_token,
    // Spotify may rotate the refresh token; keep the old one if it doesn't send a new one.
    refreshToken: data.refresh_token || fields.refresh_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  if (save) saveToken(token);
  return token;
}

function loadToken() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY));
  } catch {
    return null;
  }
}

function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

function randomString(byteCount) {
  return base64url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
