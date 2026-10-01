// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
        exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
        environment: 'happy-dom',
        globals: true,
        testTimeout: 30000,
        // Unit coverage measures the pure core. The Foundry boundary (foundry/ and
        // the entry) is exercised by the e2e suite, which records its own source
        // coverage against the real Foundry.
        coverage: {
            provider: 'v8',
            reporter: ['text-summary', 'json-summary', 'html'],
            reportsDirectory: '.coverage',
            include: ['src/**/*.ts'],
            exclude: ['**/*.test.ts', '**/*.stories.ts', '**/*.d.ts', 'src/foundry/**', 'src/zephyr-cartography.ts', 'src/canvas/test-fakes.ts'],
        },
    },
});
