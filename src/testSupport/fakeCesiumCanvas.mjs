/**
 * A Cesium scene whose canvas only "has pixels" while postRender listeners
 * run, like a WebGL canvas without preserveDrawingBuffer, plus a document
 * whose 2D canvases record whether what they copied was lit.
 */
export function createFakeCesiumScene({
  width = 800,
  height = 600,
  renders = true,
} = {}) {
  const listeners = new Set();
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    hasPixels: false,
  };
  const scene = {
    canvas,
    requests: 0,
    postRender: {
      addEventListener(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    get listenerCount() {
      return listeners.size;
    },
    requestRender() {
      scene.requests += 1;
      if (!renders) return;
      queueMicrotask(() => {
        canvas.hasPixels = true;
        try {
          for (const listener of [...listeners]) listener();
        } finally {
          canvas.hasPixels = false;
        }
      });
    },
  };
  return scene;
}

function isLit(source) {
  return source?.hasPixels === true || source?.lit === true;
}

function createFake2dCanvas(draws) {
  const canvas = {
    width: 0,
    height: 0,
    lit: false,
    toDataURL: (type = 'image/png') => `data:${type};base64,QUJD`,
  };
  const ctx = {
    canvas,
    drawImage(source, ...args) {
      draws.push({ lit: isLit(source), source, args });
      canvas.lit = canvas.lit || isLit(source);
    },
    getImageData(_x, _y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      if (canvas.lit) data.fill(200);
      return { data };
    },
    fillRect() {},
    fillText() {},
    beginPath() {},
    arc() {},
    stroke() {},
  };
  canvas.getContext = () => ctx;
  return canvas;
}

/** A document that creates fake 2D canvases; `draws` records each copy. */
export function createFakeDocument({ hidden = false } = {}) {
  const draws = [];
  return {
    hidden,
    draws,
    documentElement: {},
    createElement(tag) {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      return createFake2dCanvas(draws);
    },
    querySelector: () => null,
  };
}
