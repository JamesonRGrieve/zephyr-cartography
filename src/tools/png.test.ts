// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { crc32, decodePng, encodePng, encodeStoredPng } from './png';

/** A 3×2 image whose alpha runs to 0 with colour still in it: what a canvas would destroy. */
function sample(): { width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> } {
    const pixels = new Uint8ClampedArray([255, 0, 0, 0, 0, 255, 0, 10, 0, 0, 255, 128, 7, 8, 9, 255, 200, 100, 50, 0, 1, 2, 3, 4]);
    return { width: 3, height: 2, pixels };
}

describe('png', () => {
    it('checksums as PNG does', () => {
        expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
    });

    it('round-trips RGBA exactly, colour kept where alpha is zero', async () => {
        const image = sample();
        const file = await encodePng(image);
        expect([...file.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        const decoded = await decodePng(file);
        expect(decoded?.width).toBe(3);
        expect(decoded?.height).toBe(2);
        expect([...(decoded?.pixels ?? [])]).toEqual([...image.pixels]);
    });

    it('encodes at once in stored deflate blocks, decoding exactly, across more than one block', async () => {
        const small = sample();
        expect([...((await decodePng(encodeStoredPng(small)))?.pixels ?? [])]).toEqual([...small.pixels]);
        // 200×100 RGBA scanlines are 80,100 bytes: two stored blocks.
        const pixels = new Uint8ClampedArray(200 * 100 * 4).map((_, i) => (i * 7) % 251);
        const large = { width: 200, height: 100, pixels };
        const decoded = await decodePng(encodeStoredPng(large));
        expect([decoded?.width, decoded?.height]).toEqual([200, 100]);
        expect([...(decoded?.pixels ?? [])]).toEqual([...pixels]);
    });

    it('undoes every PNG scanline filter', async () => {
        // Re-filter the encoded file's scanlines by hand (sub, up, average, paeth) and decode them back.
        const image = sample();
        const file = await encodePng(image);
        /** The image's file with its scanlines filtered by `filter`. */
        const refiled = async (filter: number): Promise<Uint8Array<ArrayBuffer>> => {
            const stride = image.width * 4;
            const raw = new Uint8Array((stride + 1) * image.height);
            for (let y = 0; y < image.height; y += 1) {
                raw[y * (stride + 1)] = filter;
                for (let i = 0; i < stride; i += 1) {
                    const px = image.pixels[y * stride + i] ?? 0;
                    const left = i >= 4 ? image.pixels[y * stride + i - 4] ?? 0 : 0;
                    const up = y > 0 ? image.pixels[(y - 1) * stride + i] ?? 0 : 0;
                    const upLeft = y > 0 && i >= 4 ? image.pixels[(y - 1) * stride + i - 4] ?? 0 : 0;
                    const p = left + up - upLeft;
                    const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
                    const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
                    const predictor = [0, left, up, (left + up) >>> 1, paeth][filter] ?? 0;
                    raw[y * (stride + 1) + 1 + i] = (px - predictor) & 0xff;
                }
            }
            const deflated = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
            return withIdat(file, deflated);
        };
        const unfiltered = await Promise.all([1, 2, 3, 4].map(async (filter) => decodePng(await refiled(filter))));
        for (const each of unfiltered) {
            expect([...(each?.pixels ?? [])]).toEqual([...image.pixels]);
        }
    });

    it('reads an RGB PNG as RGBA whose fourth channel weights nothing, with a filter across its three-byte pixels', async () => {
        // A 2×1 RGB image, its one scanline filtered "sub" (each byte less the one three before it).
        const rgb = [10, 20, 30, 40, 60, 90];
        const sub = rgb.map((byte, i) => (byte - (i >= 3 ? rgb[i - 3] ?? 0 : 0)) & 0xff);
        const deflated = new Uint8Array(
            await new Response(new Blob([new Uint8Array([1, ...sub])]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer(),
        );
        const file = await encodePng({ width: 2, height: 1, pixels: new Uint8ClampedArray(8) });
        file[8 + 8 + 9] = 2; // IHDR colour type: RGB
        const decoded = await decodePng(await withIdat(file, deflated));
        expect([...(decoded?.pixels ?? [])]).toEqual([10, 20, 30, 0, 40, 60, 90, 0]);
    });

    it('refuses what is not an 8-bit RGBA or RGB PNG', async () => {
        expect(await decodePng(new Uint8Array([1, 2, 3]))).toBeNull();
        const file = await encodePng(sample());
        const grey = file.slice();
        grey[8 + 8 + 9] = 0; // IHDR colour type: greyscale
        expect(await decodePng(grey)).toBeNull();
    });
});

/** `file` with its IDAT data replaced (CRCs are not checked on decode). */
async function withIdat(file: Uint8Array<ArrayBuffer>, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const view = new DataView(file.buffer);
    const ihdrEnd = 8 + 4 + 4 + 13 + 4;
    const oldLength = view.getUint32(ihdrEnd);
    const tail = file.subarray(ihdrEnd + 4 + 4 + oldLength + 4);
    const out = new Uint8Array(ihdrEnd + 4 + 4 + data.length + 4 + tail.length);
    out.set(file.subarray(0, ihdrEnd));
    new DataView(out.buffer).setUint32(ihdrEnd, data.length);
    out.set(new TextEncoder().encode('IDAT'), ihdrEnd + 4);
    out.set(data, ihdrEnd + 8);
    out.set(tail, ihdrEnd + 8 + data.length + 4);
    await Promise.resolve();
    return out;
}
