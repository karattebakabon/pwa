// reasoning（思考の要求）まわりの回帰テスト。
//
// 背景: OpenRouter へ reasoning を付けて投げると、非推論モデル（Gemma 等）は
// 本文を返さず思考だけでトークンを使い切り、content: null になる。
// 実測（2026-09）: google/gemma-4-31b-it:free
//   reasoning なし → 本文あり（約2秒） / reasoning あり → content null・finish_reason=length
// そのため「送らない」判定と「思考だけ返ったら外して再送」の保険を固定する。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isReasoningOnlyCompletion, shouldRequestReasoning } from '../src/utils/reasoning.js';

const read = (relPath) => readFileSync(resolve(process.cwd(), relPath), 'utf8');

describe('shouldRequestReasoning', () => {
    it('非推論モデル（Gemma・Llama・Phi など）には送らない', () => {
        expect(shouldRequestReasoning('google/gemma-4-31b-it:free')).toBe(false);
        expect(shouldRequestReasoning('gemma-4-31b-it')).toBe(false);
        expect(shouldRequestReasoning('meta-llama/llama-3.1-8b-instruct')).toBe(false);
        expect(shouldRequestReasoning('microsoft/phi-4')).toBe(false);
        expect(shouldRequestReasoning('dots-studio/dots-3-note-preview:free')).toBe(false);
    });

    it('推論モデルには送る', () => {
        expect(shouldRequestReasoning('deepseek/deepseek-r1')).toBe(true);
        expect(shouldRequestReasoning('z-ai/glm-5.3-flash')).toBe(true);
        expect(shouldRequestReasoning('anthropic/claude-opus-4.6')).toBe(true);
        expect(shouldRequestReasoning('x-ai/grok-4.6')).toBe(true);
        expect(shouldRequestReasoning('mistralai/magistral-medium')).toBe(true);
    });

    it('モデル未指定は送る（判定できないときは従来どおり）', () => {
        expect(shouldRequestReasoning('')).toBe(true);
        expect(shouldRequestReasoning(undefined)).toBe(true);
    });
});

describe('isReasoningOnlyCompletion', () => {
    it('思考だけで本文が無いレスポンスを検出する', () => {
        expect(
            isReasoningOnlyCompletion({ choices: [{ message: { content: null, reasoning: '考え中…' } }] })
        ).toBe(true);
        expect(
            isReasoningOnlyCompletion({ choices: [{ message: { content: '', reasoning_content: 'x' } }] })
        ).toBe(true);
    });

    it('本文があるもの・ツール呼び出し・空データは対象外', () => {
        expect(
            isReasoningOnlyCompletion({ choices: [{ message: { content: 'こんにちは', reasoning: 'x' } }] })
        ).toBe(false);
        expect(
            isReasoningOnlyCompletion({ choices: [{ message: { content: null, tool_calls: [{ id: 'a' }] } }] })
        ).toBe(false);
        expect(isReasoningOnlyCompletion({ choices: [] })).toBe(false);
        expect(isReasoningOnlyCompletion(null)).toBe(false);
    });
});

describe('配線（回帰防止）', () => {
    const apiJs = read('src/api.js');

    it('非推論モデルには reasoning を送らない', () => {
        expect(apiJs).toContain('shouldRequestReasoning(model)');
    });

    it('思考だけで本文が空なら reasoning を外して自動再送する', () => {
        expect(apiJs).toContain('isReasoningOnlyCompletion(openAIResponse)');
        expect(apiJs).toContain('delete requestBody.reasoning');
        expect(apiJs).toContain('reasoning を外して再送します');
    });
});
