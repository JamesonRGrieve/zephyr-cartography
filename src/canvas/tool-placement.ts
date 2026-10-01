// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Where each drawing tool sits among Foundry's scene controls. A tool that
 * makes a native document type lives in that type's own control group, beside
 * Foundry's tools for it: rooms and doors with the Walls tools, stamps with
 * the Tiles tools. Tools with no native home (roads, rivers, terrain, levels,
 * the generator) stay in the module's own group. Editing and erasing also
 * appear in each native group, so what a group draws can be reshaped there.
 * Pure and unit-tested; the entry registers what it describes.
 */

/** Foundry's control groups the module adds tools to. */
export const NATIVE_GROUPS = ['walls', 'tiles', 'lighting', 'regions', 'notes', 'drawings'] as const;

export type NativeGroup = (typeof NATIVE_GROUPS)[number];

/** A module tool that appears in a native group. */
export type NativeTool = 'room' | 'door' | 'materials' | 'stamp' | 'edit' | 'erase' | 'link' | 'effects' | 'pin' | 'label' | 'zone';

/** Tools placed in a native group, in the order they appear after Foundry's own. */
export const NATIVE_TOOLS: Readonly<Record<NativeGroup, readonly NativeTool[]>> = {
    walls: ['room', 'door', 'materials', 'edit', 'erase'],
    tiles: ['stamp', 'erase'],
    // Linking light switches to the lights they control sits with Foundry's light tools.
    lighting: ['link'],
    // Zones are regions in Foundry's own shapes; area effects are the behaviours of the regions areas generate.
    regions: ['zone', 'effects', 'edit', 'erase'],
    // Map pins are Notes, and are placed, moved and erased with Foundry's note tools.
    notes: ['pin', 'edit', 'erase'],
    // Map labels are text Drawings.
    drawings: ['label', 'edit', 'erase'],
};

/** Tools that live only in a native group, and so are left out of the module's own group. */
const NATIVE_ONLY: ReadonlySet<string> = new Set(['room', 'door', 'materials', 'stamp', 'link', 'effects', 'pin', 'label', 'zone']);

/**
 * A tool's name in a native group. Foundry requires tool names to be unique
 * only within a group; the prefix keeps ours apart from Foundry's (Walls has
 * its own `doors`) and from other modules'.
 */
export function nativeToolName(tool: string): string {
    return `zephyr-${tool}`;
}

/** Whether the module's own group shows `tool`. */
export function inOwnGroup(tool: string): boolean {
    return !NATIVE_ONLY.has(tool);
}

function isNativeGroup(group: string): group is NativeGroup {
    return group in NATIVE_TOOLS;
}

/**
 * Which of the module's tools a scene-control selection is: `toolName` in
 * control group `group`, where `ownGroup` is the module's own group. Null
 * for any tool that is not the module's.
 */
export function moduleTool(group: string, toolName: string, ownGroup: string): string | null {
    if (group === ownGroup) {
        return toolName;
    }
    if (!isNativeGroup(group)) {
        return null;
    }
    return NATIVE_TOOLS[group].find((tool) => nativeToolName(tool) === toolName) ?? null;
}
