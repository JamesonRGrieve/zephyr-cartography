// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Preview } from '@storybook/html-vite';
import '../src/styles/entry.css';
import './chrome.css';

const preview: Preview = {
    parameters: {
        layout: 'fullscreen',
        // Accessibility violations fail the a11y panel's checks rather than only warning.
        a11y: { test: 'error' },
        // The user guide leads the sidebar, in reading order; developer docs and stories follow.
        options: {
            storySort: {
                order: [
                    'Guide',
                    [
                        'Introduction',
                        'Installation',
                        'The Toolbar',
                        'Terrain Roads and Rivers',
                        'Rooms Doors and Lighting',
                        'Stamps',
                        'Levels',
                        'Regions Pins Labels and Zones',
                        'Map Builder',
                        'Asset Packs',
                        'Settings',
                        'Troubleshooting',
                    ],
                    'Dev',
                    '*',
                ],
            },
        },
    },
};

export default preview;
