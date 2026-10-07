import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Gemini thinking-level settings wiring', () => {
    it('starts at model default and exposes the four levels in settings', () => {
        expect(read('src/state.js')).toContain("geminiThinkingLevel: '',");
        const doc = new JSDOM(read('index.html')).window.document;
        const select = doc.getElementById('gemini-thinking-level');
        expect(select).not.toBeNull();
        expect(Array.from(select.options, (option) => option.value))
            .toEqual(['', 'minimal', 'low', 'medium', 'high']);
        expect(read('src/dom-elements.js')).toContain(
            "geminiThinkingLevelSelect: document.getElementById('gemini-thinking-level')",
        );
    });

    it('saves and restores the selection in the active profile', () => {
        const lifecycle = read('src/app-logic/lifecycle.js');
        const profile = read('src/app-logic/profile.js');
        const ui = read('src/ui.js');
        expect(lifecycle).toContain(
            "geminiThinkingLevel: { element: elements.geminiThinkingLevelSelect, event: 'change' }",
        );
        expect(profile).toContain("'geminiThinkingLevel'");
        expect(ui).toContain("elements.geminiThinkingLevelSelect.value = state.settings.geminiThinkingLevel || ''");
    });

    it('refreshes supported levels on model changes and clears a now-unsupported saved choice', () => {
        const ui = read('src/ui.js');
        expect(ui).toContain('updateGeminiThinkingLevelOptions() {');
        expect(ui).toMatch(/updateAnthropicEffortOptions\(\);\s*\n\s*this\.updateGeminiThinkingLevelOptions\(\);/);
        expect(ui).toContain("state.settings.geminiThinkingLevel = ''");
    });

    it('preserves Gemini preference when a non-Gemini model is selected', () => {
        const ui = read('src/ui.js');
        const start = ui.indexOf('updateGeminiThinkingLevelOptions() {');
        const end = ui.indexOf('updateAnthropicEffortOptions() {', start);
        const method = ui.slice(start, end);
        const preserveBranch = method.indexOf('if (!isGeminiModel)');
        const clearSetting = method.indexOf("state.settings.geminiThinkingLevel = ''");
        expect(preserveBranch).toBeGreaterThan(-1);
        expect(clearSetting).toBeGreaterThan(preserveBranch);
        expect(method.slice(preserveBranch, clearSetting)).toContain('return;');
    });
});

describe('Gemini parameter-safety wiring', () => {
    it('builds thinking config in both normal send and regenerate paths', () => {
        const message = read('src/app-logic/message.js');
        expect((message.match(/buildGeminiThinkingConfig\(\{/g) || []).length).toBe(2);
        expect(message).toContain('sanitizeGeminiGenerationConfig(proofreadingModelName, generationConfig)');
        expect(message).not.toMatch(/\(state\.settings\.thinkingBudget > 0\) \|\| state\.settings\.includeThoughts/);
    });

    it('sanitizes main Gemini requests and translation requests at the API boundary', () => {
        const api = read('src/api.js');
        expect(api).toContain("import { sanitizeGeminiGenerationConfig } from './utils/gemini-params.js'");
        expect(api).toContain('sanitizeGeminiGenerationConfig(model, finalGenerationConfig)');
        expect(api).toContain('buildGeminiLightThinkingConfig(modelToUse)');
        expect(api).toContain('sanitizeGeminiGenerationConfig(modelToUse, {');
        expect(api).not.toContain('generationConfig.thinkingConfig = {};');
    });

    it('sanitizes other direct Gemini auxiliary routes', () => {
        const memory = read('src/app-logic/memory.js');
        const media = read('src/app-logic/media.js');
        expect(memory).toContain('sanitizeGeminiGenerationConfig(model, { temperature, maxOutputTokens: maxTokens })');
        expect(media).toContain('sanitizeGeminiGenerationConfig(model, { temperature: 0.5 })');
        expect(media).toContain('sanitizeGeminiGenerationConfig(qcModel, { temperature: 0.1 })');
    });
});

describe('Gemini update version/cache wiring', () => {
    it('uses one new version across app, HTML cache-buster, service worker, and release note', () => {
        expect(read('src/constants.js')).toContain("export const APP_VERSION = '1.25.68'");
        expect(read('src/constants.js')).toContain("'1.68': [");
        expect(read('index.html')).toContain('app.js?v=1.25.68');
        expect(read('sw.js')).toContain("gemini-pwa-cache-v1.25.68");
    });
});
