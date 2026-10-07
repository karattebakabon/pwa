import { describe, it, expect } from 'vitest';
import {
    GEMINI_THINKING_LEVELS,
    getGeminiThinkingLevels,
    buildGeminiThinkingConfig,
    buildGeminiLightThinkingConfig,
} from '../src/utils/gemini-thinking.js';

describe('getGeminiThinkingLevels', () => {
    it('allows minimal on models confirmed to support it', () => {
        for (const model of [
            'gemini-3.6-flash',
            'gemini-3.5-flash',
            'gemini-3.5-flash-lite',
            'gemini-3-flash-preview',
            'gemini-3.1-flash-lite',
        ]) {
            expect(getGeminiThinkingLevels(model)).toEqual(['minimal', 'low', 'medium', 'high']);
        }
    });

    it('offers common levels on other 3.x and 2.5 models, including future and latest aliases', () => {
        for (const model of [
            'gemini-3.8-flash',
            'gemini-3.7-flash',
            'gemini-3.1-pro-preview',
            'gemini-2.5-pro',
            'gemini-4.1-pro',
            'gemini-flash-latest',
        ]) {
            expect(getGeminiThinkingLevels(model)).toEqual(['low', 'medium', 'high']);
        }
    });

    it('uses the exact low/high support table for Gemini 3 Pro preview', () => {
        expect(getGeminiThinkingLevels('gemini-3-pro-preview')).toEqual(['low', 'high']);
    });

    it('does not offer thinking levels for old, image, embedding, or non-Gemini models', () => {
        for (const model of [
            'gemini-2.0-flash',
            'gemini-3.1-flash-image',
            'gemini-embedding-001',
            'gemini-live-2.5-flash',
            'claude-opus-5-5',
            '',
            undefined,
        ]) {
            expect(getGeminiThinkingLevels(model)).toBeNull();
        }
    });

    it('exports levels in UI order', () => {
        expect(GEMINI_THINKING_LEVELS).toEqual(['minimal', 'low', 'medium', 'high']);
    });
});

describe('buildGeminiThinkingConfig', () => {
    it('serializes selected levels in the uppercase REST enum form', () => {
        expect(buildGeminiThinkingConfig({ model: 'gemini-3.8-flash', thinkingLevel: 'low' }))
            .toEqual({ thinkingLevel: 'LOW' });
        expect(buildGeminiThinkingConfig({ model: 'gemini-3.8-flash', thinkingLevel: 'High' }))
            .toEqual({ thinkingLevel: 'HIGH' });
    });

    it('never sends thinkingLevel and thinkingBudget together', () => {
        expect(buildGeminiThinkingConfig({
            model: 'gemini-3.8-flash',
            thinkingLevel: 'medium',
            thinkingBudget: 5000,
        })).toEqual({ thinkingLevel: 'MEDIUM' });
    });

    it('falls back to supported thinkingBudget when no valid level is selected', () => {
        expect(buildGeminiThinkingConfig({
            model: 'gemini-3.8-flash',
            thinkingLevel: 'minimal',
            thinkingBudget: 2000,
        })).toEqual({ thinkingBudget: 2000 });
        expect(buildGeminiThinkingConfig({
            model: 'gemini-2.0-flash',
            thinkingLevel: 'high',
            thinkingBudget: 1000,
        })).toBeNull();
    });

    it('does not send legacy thinkingBudget for unknown future models or latest aliases', () => {
        for (const model of ['gemini-3.9-flash', 'gemini-4-flash', 'gemini-flash-latest']) {
            expect(buildGeminiThinkingConfig({ model, thinkingBudget: 5000 })).toBeNull();
        }
    });

    it('preserves includeThoughts independently', () => {
        expect(buildGeminiThinkingConfig({
            model: 'gemini-4-flash',
            thinkingLevel: 'high',
            thinkingBudget: 2000,
            includeThoughts: true,
        })).toEqual({ thinkingLevel: 'HIGH', includeThoughts: true });
        expect(buildGeminiThinkingConfig({
            model: 'gemini-4-flash',
            includeThoughts: true,
        })).toEqual({ includeThoughts: true });
    });

    it('omits empty configurations', () => {
        expect(buildGeminiThinkingConfig({ model: 'gemini-3.8-flash', thinkingBudget: 0 })).toBeNull();
        expect(buildGeminiThinkingConfig({ model: 'gemini-4-flash' })).toBeNull();
    });
});

describe('buildGeminiLightThinkingConfig', () => {
    it('uses old zero budget for known models', () => {
        expect(buildGeminiLightThinkingConfig('gemini-3.8-flash')).toEqual({ thinkingBudget: 0 });
        expect(buildGeminiLightThinkingConfig('gemini-2.5-flash-lite')).toEqual({ thinkingBudget: 0 });
    });

    it('uses the lightest level on unknown future models', () => {
        expect(buildGeminiLightThinkingConfig('gemini-4-flash')).toEqual({ thinkingLevel: 'LOW' });
    });

    it('returns null when neither thinking API is supported', () => {
        expect(buildGeminiLightThinkingConfig('gemini-2.0-flash')).toBeNull();
    });
});
