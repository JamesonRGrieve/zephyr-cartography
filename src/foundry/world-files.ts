// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The module's files in the world's data folder (`worlds/<world>/zephyr-cartography/`): splat masks and their bakes,
 * and each scene's features. Written through Foundry's own file picker, which only a user who may upload files can
 * use; served to every client as the world's other data is.
 */
import { MODULE_ID } from '../module-id';

/** The world's folder for the module's files. */
export function worldFolder(): string {
    return `worlds/${game.world?.id ?? 'world'}/${MODULE_ID}`;
}

/** Whether this user may write the module's files. */
export function canWriteWorldFiles(): boolean {
    return game.user?.can('FILES_UPLOAD') === true;
}

/** Make the module's world folder once per session; it already existing is fine. */
let folderReady: Promise<void> | null = null;
async function ensureFolder(): Promise<void> {
    folderReady ??= (async (): Promise<void> => {
        try {
            await foundry.applications.apps.FilePicker.implementation.createDirectory('data', worldFolder());
        } catch {
            // The folder is there already: Foundry refuses to make it twice.
        }
    })();
    await folderReady;
}

/** Save `content` as `fileName` in the module's world folder, replacing any file of that name; returns its path. */
export async function writeWorldFile(fileName: string, content: BlobPart, type: string): Promise<string> {
    await ensureFolder();
    const file = new File([content], fileName, { type });
    await foundry.applications.apps.FilePicker.implementation.upload('data', worldFolder(), file, {}, { notify: false });
    return `${worldFolder()}/${fileName}`;
}
