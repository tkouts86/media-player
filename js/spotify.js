// Thin wrapper around the Spotify Web API player endpoints.
import { getAccessToken, expireAccessToken } from './auth.js';

export class ApiError extends Error {
  constructor(status, message, reason, retryAfter) {
    super(message);
    this.status = status;
    this.reason = reason;         // e.g. PREMIUM_REQUIRED, NO_ACTIVE_DEVICE
    this.retryAfter = retryAfter; // seconds, for 429 responses
  }
}

async function request(method, path, retry = true) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
  });
  if (res.status === 401 && retry) {
    expireAccessToken();
    return request(method, path, false);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.message || `Spotify error ${res.status}`,
      data?.error?.reason, Number(res.headers.get('Retry-After')) || 0);
  }
  return data;
}

export const spotify = {
  // Resolves to null (HTTP 204) when nothing is playing on any device.
  getPlayback: () => request('GET', '/me/player?additional_types=episode'),
  play: () => request('PUT', '/me/player/play'),
  pause: () => request('PUT', '/me/player/pause'),
  next: () => request('POST', '/me/player/next'),
  previous: () => request('POST', '/me/player/previous'),
  seek: (ms) => request('PUT', `/me/player/seek?position_ms=${Math.round(ms)}`),
};
