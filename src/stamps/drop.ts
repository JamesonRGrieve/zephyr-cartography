// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The drag payload a browser card carries onto the canvas. Foundry hands the
 * drop handler the parsed JSON, which is untyped. This validates it before
 * any placement happens.
 */
import { z } from 'zod';

/** Foundry's canvas drop `type` for a dragged stamp. */
const STAMP_DROP_TYPE = 'ZephyrStamp';

const stampDropSchema = z.object({
    type: z.literal(STAMP_DROP_TYPE),
    stamp: z.string().min(1),
    variant: z.number().int().min(0),
    rotation: z.number(),
});

export type StampDrop = z.infer<typeof stampDropSchema>;

/** The JSON a card writes to the drag's `text/plain` data. */
export function stampDropPayload(stamp: string, variant: number, rotation: number): string {
    const drop: StampDrop = { type: STAMP_DROP_TYPE, stamp, variant, rotation };
    return JSON.stringify(drop);
}

// eslint-disable-next-line no-restricted-syntax -- boundary: Foundry's parsed canvas drop data is untyped; validated here
export function parseStampDrop(data: unknown): StampDrop | null {
    const result = stampDropSchema.safeParse(data);
    return result.success ? result.data : null;
}
