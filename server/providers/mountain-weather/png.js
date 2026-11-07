import { inflateSync } from 'node:zlib';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_SIDE = 1024;

/**
 * Read one palette index from an 8-bit, non-interlaced, indexed-colour PNG
 * (colour type 3). Returns the index and that palette entry's RGB. Any other
 * PNG layout is rejected rather than approximated.
 */
export function readPaletteIndex(bytes, x, y) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (SIGNATURE.some((value, i) => data[i] !== value))
    throw new Error('Not a PNG');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8,
    header = null,
    palette = null;
  const idat = [];
  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    if (start + length + 4 > data.length) throw new Error('Truncated PNG');
    const chunk = data.subarray(start, start + length);
    if (type === 'IHDR') {
      const h = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      header = {
        width: h.getUint32(0),
        height: h.getUint32(4),
        depth: chunk[8],
        colour: chunk[9],
        interlace: chunk[12],
      };
    } else if (type === 'PLTE') palette = chunk;
    else if (type === 'IDAT') idat.push(chunk);
    else if (type === 'IEND') break;
    offset = start + length + 4;
  }
  if (
    !header ||
    !palette ||
    header.depth !== 8 ||
    header.colour !== 3 ||
    header.interlace !== 0 ||
    header.width < 1 ||
    header.height < 1 ||
    header.width > MAX_SIDE ||
    header.height > MAX_SIDE
  )
    throw new Error('Unsupported PNG layout');
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= header.width ||
    y >= header.height
  )
    throw new Error('Pixel outside image');
  const raw = inflateSync(Buffer.concat(idat), {
    maxOutputLength: (header.width + 1) * header.height,
  });
  const stride = header.width + 1;
  if (raw.length !== stride * header.height) throw new Error('Bad PNG data');
  let previous = new Uint8Array(header.width);
  let line = previous;
  for (let row = 0; row <= y; row++) {
    const filter = raw[row * stride];
    const source = raw.subarray(row * stride + 1, (row + 1) * stride);
    if (filter === 0) {
      previous = line = source;
      continue;
    }
    line = new Uint8Array(source);
    for (let i = 0; i < line.length; i++) {
      const left = i ? line[i - 1] : 0,
        up = previous[i],
        corner = i ? previous[i - 1] : 0;
      if (filter === 1) line[i] = (line[i] + left) & 255;
      else if (filter === 2) line[i] = (line[i] + up) & 255;
      else if (filter === 3) line[i] = (line[i] + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left),
          pb = Math.abs(p - up),
          pc = Math.abs(p - corner);
        line[i] =
          (line[i] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner)) &
          255;
      } else if (filter !== 0) throw new Error('Bad PNG filter');
    }
    previous = line;
  }
  const index = line[x];
  if (index * 3 + 2 >= palette.length) throw new Error('Index outside palette');
  return {
    index,
    rgb: [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2]],
  };
}
