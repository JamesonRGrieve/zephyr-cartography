// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Join PNG pictures into one PNG, in Node. A large map is exported as tiles (software GL draws no more than 4096 px a
 * side) and joined; joined on a 2D canvas in the browser, a map 9000 px square crashed the browser itself. Reads the
 * 8-bit, non-interlaced RGB and RGBA pictures Playwright screenshots are; writes RGBA.
 */
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RGB = 2;
const RGBA = 6;
const CHANNELS: Readonly<Record<number, number>> = { [RGB]: 3, [RGBA]: 4 };
const OPAQUE = 255;

export type Picture = { readonly width: number; readonly height: number; readonly rgba: Buffer };
export type Placed = { readonly picture: Buffer; readonly x: number; readonly y: number };

/** The CRC-32 PNG chunks carry (ISO 3309), table built once. */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
});

function crc32(bytes: Buffer): number {
    let c = 0xffffffff;
    for (const byte of bytes) {
        c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

/** The Paeth predictor of the PNG spec: whichever of left, up and up-left is nearest left + up - up-left. */
function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) {
        return a;
    }
    return pb <= pc ? b : c;
}

/** A PNG decoded to RGBA. */
export function decodePng(png: Buffer): Picture {
    if (!png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
        throw new Error('not a PNG');
    }
    let at = SIGNATURE.length;
    let width = 0;
    let height = 0;
    let colour = 0;
    const data: Buffer[] = [];
    while (at < png.length) {
        const size = png.readUInt32BE(at);
        const type = png.toString('latin1', at + 4, at + 8);
        const body = png.subarray(at + 8, at + 8 + size);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            const depth = body.readUInt8(8);
            colour = body.readUInt8(9);
            const interlace = body.readUInt8(12);
            if (depth !== 8 || CHANNELS[colour] === undefined || interlace !== 0) {
                throw new Error(`unsupported PNG: depth ${String(depth)}, colour type ${String(colour)}, interlace ${String(interlace)}`);
            }
        } else if (type === 'IDAT') {
            data.push(body);
        } else if (type === 'IEND') {
            break;
        }
        at += 12 + size;
    }
    const channels = CHANNELS[colour] ?? 4;
    const stride = width * channels;
    const raw = inflateSync(Buffer.concat(data));
    const rows = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y += 1) {
        const filter = raw[y * (stride + 1)] ?? 0;
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const out = y * stride;
        const above = out - stride;
        for (let i = 0; i < stride; i += 1) {
            const left = i >= channels ? rows[out + i - channels] ?? 0 : 0;
            const up = y > 0 ? rows[above + i] ?? 0 : 0;
            const upLeft = y > 0 && i >= channels ? rows[above + i - channels] ?? 0 : 0;
            const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
            if (predicted === undefined) {
                throw new Error(`unknown PNG row filter ${String(filter)}`);
            }
            rows[out + i] = ((line[i] ?? 0) + predicted) & 0xff;
        }
    }
    if (channels === 4) {
        return { width, height, rgba: rows };
    }
    const rgba = Buffer.alloc(width * height * 4, OPAQUE);
    for (let p = 0; p < width * height; p += 1) {
        rows.copy(rgba, p * 4, p * 3, p * 3 + 3);
    }
    return { width, height, rgba };
}

function chunk(type: string, body: Buffer): Buffer {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
}

/** An RGBA picture encoded as a PNG (every row unfiltered). */
export function encodePng(picture: Picture): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(picture.width, 0);
    header.writeUInt32BE(picture.height, 4);
    header.writeUInt8(8, 8);
    header.writeUInt8(RGBA, 9);
    const stride = picture.width * 4;
    const raw = Buffer.alloc((stride + 1) * picture.height);
    for (let y = 0; y < picture.height; y += 1) {
        picture.rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** PNG pictures laid at their points on one transparent PNG `width` by `height`, cropped to it. */
export function joinPngs(placed: readonly Placed[], width: number, height: number): Buffer {
    const rgba = Buffer.alloc(width * height * 4);
    for (const { picture, x, y } of placed) {
        const tile = decodePng(picture);
        const across = Math.min(tile.width, width - x);
        for (let row = 0; row < tile.height && y + row < height; row += 1) {
            tile.rgba.copy(rgba, ((y + row) * width + x) * 4, row * tile.width * 4, (row * tile.width + across) * 4);
        }
    }
    return encodePng({ width, height, rgba });
}
