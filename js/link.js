// Moves a Spotify login from one device to another using a 6-digit code.
//
// The two devices find each other on ntfy.sh, a free public message relay, under a topic derived
// from the code. They then do an ECDH key exchange, so the relay only ever sees public keys and
// encrypted data: the login itself can only be read by the device that typed the code.

const RELAY = 'https://ntfy.sh';
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

export class NoAnswerError extends Error {}

// On the device that can log in. Shows `code` until stop() is called; onSent() runs each time a
// device has been sent the login.
export async function offerLogin(refreshToken, onSent) {
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  const topic = await topicFor(code);
  const answered = new Set();
  const stop = listen(topic, async (msg) => {
    if (msg.type !== 'hello' || typeof msg.key !== 'string' || answered.has(msg.key)) return;
    answered.add(msg.key);
    const mine = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
    const key = await sharedKey(mine.privateKey, msg.key);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(refreshToken));
    await publish(topic, { type: 'login', to: msg.key, key: await exportKey(mine.publicKey), iv: toBase64(iv), data: toBase64(data) });
    onSent();
  });
  return { code, stop };
}

// On the device that can't log in. Resolves to the login (a Spotify refresh token).
export async function receiveLogin(code, timeoutMs = 45000) {
  const topic = await topicFor(code);
  const mine = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  const myKey = await exportKey(mine.publicKey);

  return new Promise((resolve, reject) => {
    let resend = 0;
    let stop = () => {};
    const finish = (settle, value) => {
      clearInterval(resend);
      clearTimeout(timer);
      stop();
      settle(value);
    };
    const timer = setTimeout(() => finish(reject, new NoAnswerError('No device answered')), timeoutMs);
    const hello = () => publish(topic, { type: 'hello', key: myKey }).catch(() => {});

    stop = listen(topic, async (msg) => {
      if (msg.type !== 'login' || msg.to !== myKey) return;
      try {
        const key = await sharedKey(mine.privateKey, msg.key);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(msg.iv) }, key, fromBase64(msg.data));
        finish(resolve, new TextDecoder().decode(plain));
      } catch {}
    }, () => {
      // Say hello once we're listening, so the reply can't be missed. The relay takes a few
      // seconds to store messages, so repeat in case the other device only just connected.
      if (resend) return;
      hello();
      resend = setInterval(hello, 5000);
    });
  });
}

async function topicFor(code) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`media-player-link:${code}`));
  return 'mpl' + [...new Uint8Array(hash).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Calls onMessage for each message on the topic, including ones sent in the last 10 minutes.
function listen(topic, onMessage, onOpen) {
  const source = new EventSource(`${RELAY}/${topic}/sse?since=10m`);
  if (onOpen) source.addEventListener('open', onOpen);
  source.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(JSON.parse(e.data).message);
    } catch {
      return;
    }
    onMessage(msg);
  });
  return () => source.close();
}

async function publish(topic, msg) {
  const res = await fetch(`${RELAY}/${topic}`, { method: 'POST', body: JSON.stringify(msg) });
  if (!res.ok) throw new Error(`Relay error ${res.status}`);
}

async function sharedKey(privateKey, theirKey) {
  const publicKey = await crypto.subtle.importKey('raw', fromBase64(theirKey), ECDH, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: publicKey }, privateKey,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function exportKey(publicKey) {
  return toBase64(await crypto.subtle.exportKey('raw', publicKey));
}

function toBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
