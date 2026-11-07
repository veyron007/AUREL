/**
 * Minimal ESRI shapefile + dBASE reader for the HydroSHEDS build scripts.
 * Reads PolyLine (3) and Polygon (5) geometry and numeric/character DBF
 * fields. Input files are untrusted: every offset and length is bounded.
 */
import fs from 'node:fs';

export function readDbf(file) {
  const bytes = fs.readFileSync(file);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records = view.getUint32(4, true),
    headerLength = view.getUint16(8, true),
    recordLength = view.getUint16(10, true);
  if (headerLength + records * recordLength > bytes.byteLength + 1)
    throw new RangeError('DBF is truncated');
  const fields = [];
  for (
    let at = 32, offset = 1;
    bytes[at] !== 0x0d && at < headerLength;
    at += 32
  ) {
    const name = bytes
      .subarray(at, at + 11)
      .toString('latin1')
      .replace(/\0.*$/s, '');
    const length = bytes[at + 16];
    fields.push({
      name,
      type: String.fromCharCode(bytes[at + 11]),
      offset,
      length,
    });
    offset += length;
  }
  return {
    records,
    fields: fields.map((f) => f.name),
    /** Column reader: numeric fields as Float64Array, others as strings. */
    column(name) {
      const field = fields.find((f) => f.name === name);
      if (!field) throw new Error(`No DBF field ${name}`);
      const numeric = 'NF'.includes(field.type);
      const out = numeric ? new Float64Array(records) : new Array(records);
      for (let i = 0; i < records; i++) {
        const start = headerLength + i * recordLength + field.offset;
        const text = bytes
          .toString('latin1', start, start + field.length)
          .trim();
        out[i] = numeric ? (text === '' ? NaN : Number(text)) : text;
      }
      return out;
    },
  };
}

/** Sequential shapefile reader yielding {index, bbox, parts?} per record. */
export function readShp(file) {
  const bytes = fs.readFileSync(file);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getInt32(0, false) !== 9994) throw new TypeError('Not a shapefile');
  return {
    *records({ geometry = () => true } = {}) {
      let at = 100,
        index = 0;
      while (at + 8 <= bytes.byteLength) {
        const length = view.getInt32(at + 4, false) * 2;
        const start = at + 8;
        if (length < 4 || start + length > bytes.byteLength)
          throw new RangeError('Shapefile record out of bounds');
        const type = view.getInt32(start, true);
        if (type === 3 || type === 5) {
          const bbox = [0, 1, 2, 3].map((k) =>
            view.getFloat64(start + 4 + k * 8, true),
          );
          let parts = null;
          if (geometry(index, bbox)) {
            const numParts = view.getInt32(start + 36, true),
              numPoints = view.getInt32(start + 40, true);
            if (
              numParts < 1 ||
              numPoints < 2 ||
              44 + numParts * 4 + numPoints * 16 > length
            )
              throw new RangeError('Shapefile geometry out of bounds');
            const starts = Array.from({ length: numParts }, (_, p) =>
              view.getInt32(start + 44 + p * 4, true),
            );
            const base = start + 44 + numParts * 4;
            parts = starts.map((first, p) => {
              const last = p + 1 < numParts ? starts[p + 1] : numPoints;
              const line = [];
              for (let q = first; q < last; q++)
                line.push([
                  view.getFloat64(base + q * 16, true),
                  view.getFloat64(base + q * 16 + 8, true),
                ]);
              return line;
            });
          }
          yield { index, type, bbox, parts };
        } else yield { index, type, bbox: null, parts: null };
        at = start + length;
        index++;
      }
    },
  };
}

/** Douglas–Peucker simplification in degrees, keeping both ends. */
export function simplify(line, tolerance) {
  if (line.length <= 2) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x1, y1] = line[a],
      [x2, y2] = line[b];
    const dx = x2 - x1,
      dy = y2 - y1,
      len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1,
      index = -1;
    for (let i = a + 1; i < b; i++) {
      const d =
        Math.abs(dy * line[i][0] - dx * line[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/** Simplify a closed ring: split at the vertex farthest from the first, simplify both halves. */
export function simplifyRing(ring, tolerance) {
  const open =
    ring.length > 1 &&
    ring[0][0] === ring.at(-1)[0] &&
    ring[0][1] === ring.at(-1)[1]
      ? ring.slice(0, -1)
      : ring;
  if (open.length < 4) return [...open, open[0]];
  let far = 1,
    best = -1;
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const first = simplify(open.slice(0, far + 1), tolerance);
  const second = simplify([...open.slice(far), open[0]], tolerance);
  return [...first, ...second.slice(1)];
}
