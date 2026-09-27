// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The AI-assisted mode's model, reached from the GM's browser through an
 * OpenAI-compatible chat completions API (a gateway such as Bifrost, or a
 * model server). Its endpoint and model are world settings, shared by the
 * world's GMs; its key, when the endpoint needs one, is a client setting, so
 * it stays in the browser it was typed into and never reaches players. The
 * endpoint must allow the world's origin (CORS) and be served over HTTPS
 * when Foundry is.
 */
import type { Ask, AdviceMessage } from '../compose/assist';
import { I18N } from '../i18n';
import { MODULE_ID } from '../module-id';

const ENDPOINT_SETTING = 'assistEndpoint';
const MODEL_SETTING = 'assistModel';
const KEY_SETTING = 'assistKey';

declare global {
    interface SettingConfig {
        'zephyrex-cartography.assistEndpoint': string;
        'zephyrex-cartography.assistModel': string;
        'zephyrex-cartography.assistKey': string;
    }
}

/** How long one question may take: a large model answers a whole map's question slowly (about a minute and a half measured on Qwen3.8 27B). */
const ANSWER_TIMEOUT_MS = 300_000;

/** Tokens a reply may run to, its thinking included. */
const MAX_REPLY_TOKENS = 8000;

export function registerAdvisorSettings(): void {
    Hooks.once('init', () => {
        game.settings?.register(MODULE_ID, ENDPOINT_SETTING, {
            name: I18N.settings.assistEndpointName,
            hint: I18N.settings.assistEndpointHint,
            scope: 'world',
            config: true,
            type: String,
            default: '',
        });
        game.settings?.register(MODULE_ID, MODEL_SETTING, {
            name: I18N.settings.assistModelName,
            hint: I18N.settings.assistModelHint,
            scope: 'world',
            config: true,
            type: String,
            default: '',
        });
        game.settings?.register(MODULE_ID, KEY_SETTING, {
            name: I18N.settings.assistKeyName,
            hint: I18N.settings.assistKeyHint,
            scope: 'client',
            config: true,
            type: String,
            default: '',
        });
    });
}

const setting = (key: typeof ENDPOINT_SETTING | typeof MODEL_SETTING | typeof KEY_SETTING): string => {
    const value = game.settings?.get(MODULE_ID, key);
    return typeof value === 'string' ? value.trim() : '';
};

/** Whether a model is set up: an endpoint and a model named. */
export function advisorAvailable(): boolean {
    return setting(ENDPOINT_SETTING) !== '' && setting(MODEL_SETTING) !== '';
}

/** The text of a chat completion's first choice, or null when the reply has none. */
// eslint-disable-next-line no-restricted-syntax -- boundary: the endpoint's reply is untyped JSON
function replyText(body: unknown): string | null {
    if (typeof body !== 'object' || body === null || !('choices' in body) || !Array.isArray(body.choices)) {
        return null;
    }
    // eslint-disable-next-line no-restricted-syntax -- boundary: one choice of the untyped reply
    const [first]: unknown[] = body.choices;
    if (typeof first !== 'object' || first === null || !('message' in first) || typeof first.message !== 'object' || first.message === null) {
        return null;
    }
    return 'content' in first.message && typeof first.message.content === 'string' ? first.message.content : null;
}

/** Ask the set-up model: its reply's text; rejects when it cannot be reached, fails, or says nothing. */
export const askAdvisor: Ask = async (messages: readonly AdviceMessage[]) => {
    const endpoint = setting(ENDPOINT_SETTING).replace(/\/+$/u, '');
    const key = setting(KEY_SETTING);
    const abort = new AbortController();
    const timer = setTimeout(() => {
        abort.abort();
    }, ANSWER_TIMEOUT_MS);
    try {
        const response = await fetch(`${endpoint}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(key === '' ? {} : { Authorization: `Bearer ${key}` }) },
            // Thinking aloud first (Qwen's and like models' default) takes minutes on a whole map; the questions need only the answer.
            body: JSON.stringify({ model: setting(MODEL_SETTING), messages, max_tokens: MAX_REPLY_TOKENS, chat_template_kwargs: { enable_thinking: false } }),
            signal: abort.signal,
        });
        if (!response.ok) {
            throw new Error(`the model answered ${response.status}`);
        }
        const text = replyText(await response.json());
        if (text === null) {
            throw new Error('the model gave no answer');
        }
        return text;
    } finally {
        clearTimeout(timer);
    }
};
