#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stamp the published version + manifest/download URLs onto the staged
 * release/module.json. Driven by .github/workflows/release.yml (both channels).
 *
 * Channels:
 *   nightly — the rolling prerelease under the fixed `nightly` tag. Version is
 *             the committed version + the workflow run number. A prerelease is
 *             never the "latest" release alias, so both URLs use
 *             /releases/download/nightly/.
 *   release — an official versioned release cut from a `v<semver>` tag, which
 *             must equal module.json's committed version. `manifest` is the
 *             /releases/latest/ alias (so installs follow future releases);
 *             `download` is pinned to this tag, so each version's manifest on the
 *             Foundry package listing fetches its own zip.
 *
 * Env:
 *   CHANNEL        — `nightly` (default) or `release`.
 *   RUN            — nightly: the build counter (release.yml's run_number).
 *   TAG            — the release tag; nightly defaults to `nightly`, release requires `v<semver>`.
 *   REPO_URL       — https://github.com/<owner>/<repo>.
 *   MANIFEST_FILE  — file to rewrite (default release/module.json).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ZIP_NAME = 'zephyr-cartography.zip';
const MANIFEST_NAME = 'module.json';
const RELEASE_TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * The version + URL fields a channel publishes. Pure.
 * @param {string} committedVersion module.json's committed version
 * @param {{channel: string, run?: string, tag?: string, repoUrl: string}} opts
 * @returns {{version: string, manifest: string, download: string}}
 */
export function releaseFields(committedVersion, { channel, run, tag, repoUrl }) {
    if (!repoUrl) throw new Error('REPO_URL is required (https://github.com/<owner>/<repo>).');
    const assets = (t) => `${repoUrl}/releases/download/${t}`;

    if (channel === 'release') {
        const match = RELEASE_TAG.exec(tag ?? '');
        if (!match) throw new Error(`release tag must be v<semver> (e.g. v1.0.0), got "${tag ?? ''}".`);
        // The tagged commit must carry the version it releases, so the repo — not
        // just the release page — records what shipped.
        if (match[1] !== committedVersion) {
            throw new Error(`tag ${tag} does not match module.json version ${committedVersion}; bump it before tagging.`);
        }
        return {
            version: match[1],
            manifest: `${repoUrl}/releases/latest/download/${MANIFEST_NAME}`,
            download: `${assets(tag)}/${ZIP_NAME}`,
        };
    }

    if (channel !== 'nightly') throw new Error(`unknown CHANNEL "${channel}" (expected nightly or release).`);
    const nightlyTag = tag ?? 'nightly';
    // Drop a trailing numeric counter so re-runs don't stack (0.3.0-alpha.1 → base
    // 0.3.0-alpha). Only when a prerelease label is present, so a plain base isn't mangled.
    const base = committedVersion.includes('-') ? committedVersion.replace(/\.\d+$/, '') : committedVersion;
    return {
        version: `${base}.${run ?? '0'}`,
        manifest: `${assets(nightlyTag)}/${MANIFEST_NAME}`,
        download: `${assets(nightlyTag)}/${ZIP_NAME}`,
    };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const file = process.env.MANIFEST_FILE ?? 'release/module.json';
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    try {
        Object.assign(
            manifest,
            releaseFields(String(manifest.version), {
                channel: process.env.CHANNEL ?? 'nightly',
                run: process.env.RUN,
                tag: process.env.TAG,
                repoUrl: process.env.REPO_URL,
            }),
        );
    } catch (err) {
        console.error(`prepare-release-manifest: ${err.message}`);
        process.exit(1);
    }
    writeFileSync(file, `${JSON.stringify(manifest, null, 4)}\n`);
    console.log(`release manifest → version=${manifest.version} manifest=${manifest.manifest} download=${manifest.download}`);
}
