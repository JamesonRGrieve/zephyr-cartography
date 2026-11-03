// SPDX-License-Identifier: AGPL-3.0-or-later
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng, joinPngs } from './e2e/lib/png-join';

/** The PNG spec's Paeth predictor, written out again so the decoder is checked against the spec, not itself. */
function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    if (pa <= pb && pa <= pc) {
        return a;
    }
    return pb <= pc ? b : c;
}

/** A PNG of `width` by `height` with the given colour type and its rows filtered as `filters` says. */
function png(width: number, height: number, colour: 2 | 6, pixels: number[][], filters: number[]): Buffer {
    const channels = colour === 6 ? 4 : 3;
    const stride = width * channels;
    const rows = pixels.flat();
    const raw: number[] = [];
    for (let y = 0; y < height; y += 1) {
        const filter = filters[y] ?? 0;
        raw.push(filter);
        for (let i = 0; i < stride; i += 1) {
            const value = rows[y * stride + i] ?? 0;
            const left = i >= channels ? rows[y * stride + i - channels] ?? 0 : 0;
            const up = y > 0 ? rows[(y - 1) * stride + i] ?? 0 : 0;
            const upLeft = y > 0 && i >= channels ? rows[(y - 1) * stride + i - channels] ?? 0 : 0;
            const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter] ?? 0;
            raw.push((value - predicted) & 0xff);
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.writeUInt8(8, 8);
    header.writeUInt8(colour, 9);
    return rebuild(header, deflateSync(Buffer.from(raw)));
}

/** A PNG's bytes from its header and compressed rows (CRCs left zero: the decoder does not check them). */
function rebuild(header: Buffer, data: Buffer): Buffer {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const piece = (type: string, body: Buffer): Buffer => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(body.length, 0);
        head.write(type, 4, 'latin1');
        return Buffer.concat([head, body, Buffer.alloc(4)]);
    };
    return Buffer.concat([sig, piece('IHDR', header), piece('IDAT', data), piece('IEND', Buffer.alloc(0))]);
}

describe('png join', () => {
    it('decodes RGB rows under every filter to opaque RGBA', () => {
        const pixels = [
            [10, 20, 30, 40, 50, 60],
            [70, 80, 90, 200, 210, 220],
            [1, 2, 3, 250, 5, 6],
            [9, 9, 9, 100, 150, 200],
            [255, 0, 128, 3, 4, 5],
        ];
        const picture = decodePng(png(2, 5, 2, pixels, [0, 1, 2, 3, 4]));
        expect([...picture.rgba]).toEqual(pixels.flatMap((row) => [...row.slice(0, 3), 255, ...row.slice(3), 255]));
    });

    it('round-trips RGBA through its own encoder', () => {
        const rgba = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        const picture = decodePng(encodePng({ width: 2, height: 2, rgba }));
        expect(picture).toMatchObject({ width: 2, height: 2 });
        expect([...picture.rgba]).toEqual([...rgba]);
    });

    it('lays tiles at their points and crops what runs past the edge', () => {
        const tile = (value: number): Buffer => encodePng({ width: 2, height: 2, rgba: Buffer.alloc(16, value) });
        const joined = decodePng(
            joinPngs(
                [
                    { picture: tile(10), x: 0, y: 0 },
                    { picture: tile(20), x: 2, y: 0 },
                    { picture: tile(30), x: 0, y: 2 },
                ],
                3,
                3,
            ),
        );
        const at = (x: number, y: number): number | undefined => joined.rgba[(y * 3 + x) * 4];
        expect([at(0, 0), at(1, 1), at(2, 0), at(2, 1), at(0, 2), at(1, 2), at(2, 2)]).toEqual([10, 10, 20, 20, 30, 30, 0]);
    });

    it('refuses what is not an 8-bit PNG', () => {
        expect(() => decodePng(Buffer.from('not a png at all'))).toThrow('not a PNG');
        const header = Buffer.alloc(13);
        header.writeUInt32BE(1, 0);
        header.writeUInt32BE(1, 4);
        header.writeUInt8(16, 8);
        header.writeUInt8(2, 9);
        expect(() => decodePng(rebuild(header, deflateSync(Buffer.alloc(7))))).toThrow('unsupported PNG');
    });
});
