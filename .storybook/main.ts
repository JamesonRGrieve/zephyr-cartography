// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Storybook for the plugin's DOM views. Stories sit beside the view they
 * render (`src/ui/*.stories.ts`) so a rename keeps them in step. Vite picks up
 * the repo's PostCSS/Tailwind config on its own, so stories render with the
 * same `tw-` utilities as the module. Foundry's own CSS is not redistributable
 * and is not bundled; `.storybook/chrome.css` stands in for its window chrome.
 */
import type { StorybookConfig } from '@storybook/html-vite';
import remarkGfm from 'remark-gfm';

const config: StorybookConfig = {
    // The published Storybook is the module's docs hub (GitHub Pages, see
    // .github/workflows/docs.yml): the user guide (`docs/guide/*.mdx`, `Guide/…`)
    // comes first, then the developer docs (`docs/dev/*.mdx`, `Dev/…`) and the
    // view stories. The stories keep their own titles: their ids name the
    // screenshot baselines.
    stories: ['../docs/guide/*.mdx', '../docs/dev/*.mdx', '../src/**/*.stories.ts'],
    staticDirs: [],
    // MDX compiles CommonMark only; remark-gfm adds the GitHub tables the guide is written in.
    addons: [
        '@storybook/addon-a11y',
        {
            name: '@storybook/addon-docs',
            options: { mdxPluginOptions: { mdxCompileOptions: { remarkPlugins: [remarkGfm] } } },
        },
    ],
    framework: { name: '@storybook/html-vite', options: {} },
    core: { disableTelemetry: true },
};

export default config;
