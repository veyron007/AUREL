/**
 * Callout cards of the screen annotation board: their size, measured once
 * from the rendered text, and their placement each frame (spread apart when
 * clustered, lifted above an open Voice Preview). Placement only sets the
 * plain callout record; screenAnnotationDom.js writes it onto the elements.
 */

export function makeCallout(text, c) {
  if (!text) return null;
  return {
    text,
    fill: c,
    element: null,
    transform: null,
    width: 0,
    height: 26,
    sized: false,
  };
}

/** Size a callout to its rendered text; false until the text is laid out. */
export function sizeCallout(callout) {
  try {
    const bbox = callout.element.getBBox();
    const w = Math.max(24, bbox.width + 18);
    const h = Math.max(22, bbox.height + 10);
    callout.width = w;
    callout.height = h;
    callout.sized = true;
    return true;
  } catch {
    /* not laid out yet */
    return false;
  }
}

export function positionCallout(callout, x, y, center) {
  if (!callout.sized) sizeCallout(callout);
  const tx = center ? x - callout.width / 2 : x;
  callout._x = tx;
  callout._y = y;
  callout.transform = `translate(${tx.toFixed(1)}, ${y.toFixed(1)})`;
}

/**
 * Nudge overlapping callout cards apart so labels stay readable when several
 * marks cluster on screen. Simple top-down sweep: each card that overlaps an
 * earlier one is pushed just below it. O(n²) but n is small.
 */
export function decollideCallouts(callouts) {
  callouts.sort((a, b) => a._y - b._y);
  for (let i = 0; i < callouts.length; i++) {
    const a = callouts[i];
    for (let j = 0; j < i; j++) {
      const b = callouts[j];
      const overlapX = a._x < b._x + b.width + 6 && a._x + a.width + 6 > b._x;
      const overlapY = a._y < b._y + b.height && a._y + a.height > b._y;
      if (overlapX && overlapY) {
        a._y = b._y + b.height + 5;
        a.transform = `translate(${a._x.toFixed(1)}, ${a._y.toFixed(1)})`;
        if (a._leader) {
          a._leader.set.x2 = a._x.toFixed(1);
          a._leader.set.y2 = a._y.toFixed(1);
        }
      }
    }
  }
}

/** Keep an overlapping callout above the actual open Voice Preview, when it fits. */
export function placeCalloutsAboveVoicePreview(callouts, width, height) {
  if (!callouts.length) return;
  const panel = document.getElementById('gev-voice-panel');
  const svg = document.querySelector('.gev-screen-whiteboard-svg');
  if (
    !panel ||
    !svg ||
    panel.hidden ||
    panel.dataset.view !== 'preview' ||
    panel.checkVisibility?.({
      opacityProperty: true,
      visibilityProperty: true,
    }) === false
  )
    return;
  const rect = panel.getBoundingClientRect(),
    bounds = svg.getBoundingClientRect();
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    return;
  // The overlay uses preserveAspectRatio="none": each axis scales independently.
  const sx = width / bounds.width,
    sy = height / bounds.height;
  const blocked = {
    _x: (rect.left - bounds.left) * sx,
    _y: (rect.top - bounds.top) * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  };
  const intersects = (a, b) =>
    a._x < b._x + b.width &&
    a._x + a.width > b._x &&
    a._y < b._y + b.height &&
    a._y + a.height > b._y;
  for (const callout of callouts) {
    if (!intersects(callout, blocked) || callout.width > width - 16) continue;
    const candidate = {
      _x: Math.max(8, Math.min(callout._x, width - callout.width - 8)),
      _y: blocked._y - callout.height - 8,
      width: callout.width,
      height: callout.height,
    };
    if (
      candidate._y < 8 ||
      candidate._y + candidate.height > height - 8 ||
      callouts.some(
        (other) => other !== callout && intersects(candidate, other),
      )
    )
      continue;
    positionCallout(callout, candidate._x, candidate._y, false);
    if (callout._leader) {
      callout._leader.set.x2 = candidate._x.toFixed(1);
      callout._leader.set.y2 = (candidate._y + candidate.height).toFixed(1);
    }
  }
}
