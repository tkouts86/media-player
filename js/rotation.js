// The player is always horizontal: when the screen is upright (or the phone has rotation lock on),
// app.js turns it 90° sideways, and "Rotate" turns it the other way round. Finger positions arrive
// in screen coordinates; these helpers convert them to the player's own, unturned coordinates.

let turn = 0; // degrees: 0, 90, -90 or 180

export function setTurn(degrees) {
  turn = degrees;
}

export function toLocal(x, y) {
  const w = innerWidth;
  const h = innerHeight;
  switch (turn) {
    case 90: return { x: y, y: w - x };
    case -90: return { x: h - y, y: x };
    case 180: return { x: w - x, y: h - y };
    default: return { x, y };
  }
}

// An element's box in the player's coordinates.
export function localRect(el) {
  const r = el.getBoundingClientRect();
  const a = toLocal(r.left, r.top);
  const b = toLocal(r.right, r.bottom);
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
