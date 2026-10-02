// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Foundry document ids derived from a seed: the same seed always gives the
 * same id. A document that something else names before it exists (a way to
 * another map, a linked stamp's further entrances) is made under one. Pure
 * and unit-tested.
 */

/** The letters and digits of a Foundry id, and its length. */
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 16;

/** FNV-1a's 32-bit offset basis and prime. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Characters one round of hashing gives. */
const CHARS_PER_ROUND = 4;

/** A Foundry document id derived from `seed`: the same seed always gives the same id. */
export function stableId(seed: string): string {
    let id = '';
    for (let round = 0; id.length < ID_LENGTH; round++) {
        let hash = FNV_OFFSET;
        const text = `${String(round)}:${seed}`;
        for (let i = 0; i < text.length; i++) {
            hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME) >>> 0;
        }
        for (let k = 0; k < CHARS_PER_ROUND && id.length < ID_LENGTH; k++) {
            id += ID_ALPHABET.charAt(hash % ID_ALPHABET.length);
            hash = Math.floor(hash / ID_ALPHABET.length);
        }
    }
    return id;
}
