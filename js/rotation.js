// The player may be drawn turned 90° (see "Orientation" in app.js and style.css). Finger positions
// arrive in screen coordinates; these helpers convert them to the player's own, unturned ones.
// The turn is read from the player's actual transform, so it's always in step with the screen.

function playerTurn() {
  const player = document.getElementById('player');
  const transform = getComputedStyle(player).transform;
  const b = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).b; // sin of the angle
  return { box: player.getBoundingClientRect(), turn: b > 0.5 ? 90 : b < -0.5 ? -90 : 0 };
}

export function toLocal(x, y) {
  const { box, turn } = playerTurn();
  if (turn === 90) return { x: y - box.top, y: box.right - x };
  if (turn === -90) return { x: box.bottom - y, y: x - box.left };
  return { x: x - box.left, y: y - box.top };
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
