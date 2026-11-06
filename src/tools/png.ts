// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A minimal, exact RGBA PNG codec for splat masks. A browser canvas
 * premultiplies alpha, so a mask round-tripped through one loses its fourth
 * channel wherever alpha is low (and all colour where it is zero); a splat
 * mask's alpha is a texture weight like the others, so it must survive
 * exactly. Encoding writes 8-bit RGBA, unfiltered scanlines, deflated with
 * the platform's `CompressionStream` (zlib, which PNG's IDAT requires).
 * Decoding reads 8-bit RGBA or RGB with any of PNG's five scanline filters.
 */

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const RGBA_BYTES = 4;
const BIT_DEPTH = 8;
const COLOUR_TYPE_RGBA = 6;
const COLOUR_TYPE_RGB = 2;
const RGB_BYTES = 3;

/** The colour types decoded, by their bytes per pixel. */
const BYTES_PER_PIXEL: ReadonlyMap<number, number> = new Map([
    [COLOUR_TYPE_RGBA, RGBA_BYTES],
    [COLOUR_TYPE_RGB, RGB_BYTES],
]);
const HEADER_BYTES = 13;
const LENGTH_BYTES = 4;
const TYPE_BYTES = 4;
const CRC_BYTES = 4;

/** Decoded RGBA pixels, row by row. */
export interface RgbaImage {
    readonly width: number;
    readonly height: number;
    readonly pixels: Uint8ClampedArray<ArrayBuffer>;
}

const CRC_TABLE = ((): Uint32Array => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
            c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

/** PNG's CRC-32 over `bytes`. */
export function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

async function transform(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(LENGTH_BYTES + TYPE_BYTES + data.length + CRC_BYTES);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    const typed = new TextEncoder().encode(type);
    out.set(typed, LENGTH_BYTES);
    out.set(data, LENGTH_BYTES + TYPE_BYTES);
    view.setUint32(LENGTH_BYTES + TYPE_BYTES + data.length, crc32(out.subarray(LENGTH_BYTES, LENGTH_BYTES + TYPE_BYTES + data.length)));
    return out;
}

/** The IHDR of an 8-bit RGBA image and its unfiltered scanlines, each led by filter type 0 (none). */
function scanlines(image: RgbaImage): { header: Uint8Array; raw: Uint8Array<ArrayBuffer> } {
    const { width, height, pixels } = image;
    const header = new Uint8Array(HEADER_BYTES);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, width);
    headerView.setUint32(4, height);
    header[8] = BIT_DEPTH;
    header[9] = COLOUR_TYPE_RGBA;
    // Compression, filter and interlace methods: all the standard 0.
    const stride = width * RGBA_BYTES;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
        raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    return { header, raw };
}

/** The PNG file of `header` and its zlib-wrapped image `data`. */
function assemble(header: Uint8Array, data: Uint8Array): Uint8Array<ArrayBuffer> {
    const parts = [SIGNATURE, chunk('IHDR', header), chunk('IDAT', data), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    parts.reduce((at, part) => {
        out.set(part, at);
        return at + part.length;
    }, 0);
    return out;
}

/** Encode RGBA pixels as a PNG file. */
export async function encodePng(image: RgbaImage): Promise<Uint8Array<ArrayBuffer>> {
    const { header, raw } = scanlines(image);
    return assemble(header, await transform(raw, new CompressionStream('deflate')));
}

/** The largest deflate stored block. */
const STORED_BLOCK = 0xffff;
const ADLER_MOD = 65521;

/** zlib's Adler-32 over `bytes`. */
function adler32(bytes: Uint8Array): number {
    let a = 1;
    let b = 0;
    for (const byte of bytes) {
        a = (a + byte) % ADLER_MOD;
        b = (b + a) % ADLER_MOD;
    }
    return ((b << 16) | a) >>> 0;
}

/**
 * Encode RGBA pixels as a PNG file at once, its scanlines in deflate's stored (uncompressed) blocks: for a composer,
 * which is synchronous, to hand a mask it painted to a scene spec. Larger than `encodePng`'s, as exact.
 */
export function encodeStoredPng(image: RgbaImage): Uint8Array<ArrayBuffer> {
    const { header, raw } = scanlines(image);
    const blocks = Math.max(1, Math.ceil(raw.length / STORED_BLOCK));
    // zlib: CMF 0x78 (deflate, 32K window), FLG 0x01 (no dictionary, fastest; 0x7801 a multiple of 31).
    const data = new Uint8Array(2 + blocks * 5 + raw.length + 4);
    const view = new DataView(data.buffer);
    data[0] = 0x78;
    data[1] = 0x01;
    let at = 2;
    for (let i = 0; i < blocks; i += 1) {
        const part = raw.subarray(i * STORED_BLOCK, (i + 1) * STORED_BLOCK);
        // BFINAL on the last block, BTYPE 00 (stored); then LEN and its one's complement, little-endian.
        data[at] = i === blocks - 1 ? 1 : 0;
        view.setUint16(at + 1, part.length, true);
        view.setUint16(at + 3, ~part.length & 0xffff, true);
        data.set(part, at + 5);
        at += 5 + part.length;
    }
    view.setUint32(at, adler32(raw));
    return assemble(header, data);
}

function paeth(left: number, up: number, upLeft: number): number {
    const p = left + up - upLeft;
    const pa = Math.abs(p - left);
    const pb = Math.abs(p - up);
    const pc = Math.abs(p - upLeft);
    if (pa <= pb && pa <= pc) {
        return left;
    }
    return pb <= pc ? up : upLeft;
}

/** Undo one scanline's filter in place, given the previous (already unfiltered) line and the bytes per pixel. */
function unfilter(filter: number, line: Uint8Array, previous: Uint8Array | null, bytesPerPixel: number): void {
    for (let i = 0; i < line.length; i += 1) {
        const left = i >= bytesPerPixel ? line[i - bytesPerPixel] ?? 0 : 0;
        const up = previous?.[i] ?? 0;
        const upLeft = i >= bytesPerPixel ? previous?.[i - bytesPerPixel] ?? 0 : 0;
        const predictors = [0, left, up, (left + up) >>> 1, paeth(left, up, upLeft)];
        line[i] = ((line[i] ?? 0) + (predictors[filter] ?? 0)) & 0xff;
    }
}

/**
 * Decode an 8-bit RGBA or RGB PNG; null for anything else (another colour
 * type, depth, interlacing, or a corrupt file). An RGB image's fourth channel
 * comes out 0: as a mask, it weights nothing.
 */
export async function decodePng(file: Uint8Array<ArrayBuffer>): Promise<RgbaImage | null> {
    if (file.length < SIGNATURE.length || SIGNATURE.some((byte, i) => file[i] !== byte)) {
        return null;
    }
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    let at = SIGNATURE.length;
    let width = 0;
    let height = 0;
    let bytesPerPixel = 0;
    const idat: Uint8Array[] = [];
    while (at + LENGTH_BYTES + TYPE_BYTES <= file.length) {
        const size = view.getUint32(at);
        const type = new TextDecoder().decode(file.subarray(at + LENGTH_BYTES, at + LENGTH_BYTES + TYPE_BYTES));
        const data = file.subarray(at + LENGTH_BYTES + TYPE_BYTES, at + LENGTH_BYTES + TYPE_BYTES + size);
        if (type === 'IHDR') {
            const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
            width = header.getUint32(0);
            height = header.getUint32(4);
            bytesPerPixel = BYTES_PER_PIXEL.get(data[9] ?? -1) ?? 0;
            if (data[8] !== BIT_DEPTH || bytesPerPixel === 0 || data[12] !== 0) {
                return null;
            }
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        at += LENGTH_BYTES + TYPE_BYTES + size + CRC_BYTES;
    }
    const compressed = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
    idat.reduce((offset, part) => {
        compressed.set(part, offset);
        return offset + part.length;
    }, 0);
    let raw: Uint8Array;
    try {
        raw = await transform(compressed, new DecompressionStream('deflate'));
    } catch {
        return null;
    }
    const stride = width * bytesPerPixel;
    if (width === 0 || height === 0 || raw.length < (stride + 1) * height) {
        return null;
    }
    const pixels = new Uint8ClampedArray(width * RGBA_BYTES * height);
    let previous: Uint8Array | null = null;
    for (let y = 0; y < height; y += 1) {
        const start = y * (stride + 1);
        const line = raw.slice(start + 1, start + 1 + stride);
        unfilter(raw[start] ?? 0, line, previous, bytesPerPixel);
        for (let x = 0; x < width; x += 1) {
            // RGB carries three of the four channels; the fourth stays 0.
            pixels.set(line.subarray(x * bytesPerPixel, (x + 1) * bytesPerPixel), (y * width + x) * RGBA_BYTES);
        }
        previous = line;
    }
    return { width, height, pixels };
}
