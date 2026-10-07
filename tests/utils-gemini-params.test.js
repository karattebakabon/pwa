import { describe, it, expect } from 'vitest';
import {
    geminiAcceptsSamplingParams,
    geminiAcceptsThinkingBudget,
    sanitizeGeminiGenerationConfig,
} from '../src/utils/gemini-params.js';

describe('Gemini parameter compatibility', () => {
    it('allows sampling parameters only for known supported Gemini families', () => {
        for (const model of [
            'gemini-2.5-pro',
            'gemini-3-flash-preview',
            'gemini-3.1-pro-preview',
            'gemini-3.1-flash-lite',
            'gemini-3.5-flash',
            'gemini-3.5-flash-lite',
        ]) {
            expect(geminiAcceptsSamplingParams(model)).toBe(true);
        }
        for (const model of [
            'gemini-3.6-flash',
            'gemini-3.7-flash',
            'gemini-3.8-flash',
            'gemini-3.9-flash',
            'gemini-3.10-flash',
            'gemini-4-flash',
            'gemini-flash-latest',
        ]) {
            expect(geminiAcceptsSamplingParams(model)).toBe(false);
        }
    });

    it('does not apply Gemini compatibility rules to non-Gemini models', () => {
        expect(geminiAcceptsSamplingParams('gemma-3-27b-it')).toBe(true);
    });

    it('allows thinkingBudget only for Gemini families known at the announcement', () => {
        for (const model of [
            'gemini-2.5-flash',
            'gemini-3-flash-preview',
            'gemini-3.1-pro-preview',
            'gemini-3.5-flash-lite',
            'gemini-3.6-flash',
            'gemini-3.7-flash',
            'gemini-3.8-flash',
        ]) {
            expect(geminiAcceptsThinkingBudget(model)).toBe(true);
        }
        for (const model of ['gemini-3.9-flash', 'gemini-4-flash', 'gemini-flash-latest']) {
            expect(geminiAcceptsThinkingBudget(model)).toBe(false);
        }
    });

    it('removes unsupported fields but preserves supported config and does not mutate input', () => {
        const input = {
            temperature: 0.8,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 4096, includeThoughts: true },
        };
        const result = sanitizeGeminiGenerationConfig('gemini-4-flash', input);
        expect(result).toEqual({
            maxOutputTokens: 2048,
            thinkingConfig: { includeThoughts: true },
        });
        expect(input).toEqual({
            temperature: 0.8,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 4096, includeThoughts: true },
        });
    });

    it('preserves legacy parameters on supported generations', () => {
        const input = {
            temperature: 0.8,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 4096 },
        };
        expect(sanitizeGeminiGenerationConfig('gemini-3.5-flash', input)).toEqual(input);
    });

    it('removes an empty thinkingConfig when its only unsupported field is thinkingBudget', () => {
        expect(sanitizeGeminiGenerationConfig('gemini-flash-latest', {
            temperature: 0.5,
            thinkingConfig: { thinkingBudget: 0 },
        })).toEqual({});
    });

    it('preserves thinkingLevel and safely handles null config', () => {
        expect(sanitizeGeminiGenerationConfig('gemini-4-flash', {
            thinkingConfig: { thinkingLevel: 'HIGH' },
        })).toEqual({ thinkingConfig: { thinkingLevel: 'HIGH' } });
        expect(sanitizeGeminiGenerationConfig('gemini-4-flash', null)).toEqual({});
        expect(sanitizeGeminiGenerationConfig('gemini-4-flash', undefined)).toEqual({});
    });
});
