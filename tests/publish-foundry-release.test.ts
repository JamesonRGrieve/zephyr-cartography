// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { foundryReleaseBody } from '../scripts/publish-foundry-release.mjs';

const REPO = 'https://github.com/owner/repo';
const MANIFEST = { id: 'zephyr-cartography', version: '0.2.0', compatibility: { minimum: 14, verified: '14' } };

describe('foundryReleaseBody — the Foundry Package Release API request', () => {
    it('points the listing at the tag-pinned manifest and the release notes page', () => {
        expect(foundryReleaseBody(MANIFEST, { repoUrl: REPO, tag: 'v0.2.0', dryRun: false })).toEqual({
            'id': 'zephyr-cartography',
            'dry-run': false,
            'release': {
                version: '0.2.0',
                manifest: `${REPO}/releases/download/v0.2.0/module.json`,
                notes: `${REPO}/releases/tag/v0.2.0`,
                compatibility: { minimum: '14', verified: '14' },
            },
        });
    });

    it('passes the dry-run flag through, so a release can be validated without publishing', () => {
        expect(foundryReleaseBody(MANIFEST, { repoUrl: REPO, tag: 'v0.2.0', dryRun: true })['dry-run']).toBe(true);
    });

    it('refuses a tag that does not match the version being released', () => {
        expect(() => foundryReleaseBody(MANIFEST, { repoUrl: REPO, tag: 'v0.3.0', dryRun: false })).toThrow(/does not match/);
    });

    it('omits unset compatibility bounds rather than sending empty values', () => {
        const body = foundryReleaseBody(
            { id: 'zephyr-cartography', version: '0.2.0', compatibility: { minimum: 14 } },
            { repoUrl: REPO, tag: 'v0.2.0', dryRun: false },
        );
        expect(body.release.compatibility).toEqual({ minimum: '14' });
    });
});
