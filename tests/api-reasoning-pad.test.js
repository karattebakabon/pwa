// reasoning_content パディング（DeepSeek/Kimi/MiMo thinking モード対策）の回帰テスト。
// - 実思考があるターン: thought:true パート → reasoning_content に復元
// - 実思考が無いターン: reasoningEchoPad 有効時のみ半角スペースでパディング
// - パディングは OpenAI 互換のツール付き変換（_callOpenAICompatibleWithTools 相当）で使われる
import { describe, it, expect } from 'vitest';
import { apiUtils } from '../src/api.js';

const toolHistory = () => [
    { role: 'user', parts: [{ text: 'hi' }] },
    { role: 'model', parts: [{ functionCall: { name: 'noop', args: {}, _toolCallId: 'call_1' } }] },
    { role: 'tool', parts: [{ functionResponse: { name: 'noop', response: 'ok', _toolCallId: 'call_1' } }] },
    { role: 'user', parts: [{ text: 'thanks' }] },
];

describe('reasoning_content パディング', () => {
    it('実思考が無い assistant ターンは半角スペースでパディングされる（echoPad有効）', () => {
        const out = apiUtils.convertGeminiToOpenAIFormat(toolHistory(), {
            passthroughReasoning: true,
            reasoningEchoPad: true,
        });
        const assistant = out.find((m) => m.role === 'assistant');
        expect(assistant).toBeTruthy();
        expect(assistant.reasoning_content).toBe(' ');
        expect(assistant.tool_calls).toHaveLength(1);
    });

    it('思考パートがある場合は実テキストが reasoning_content になる', () => {
        const msgs = [
            { role: 'user', parts: [{ text: 'hi' }] },
            {
                role: 'model',
                parts: [
                    { text: '深く考えた', thought: true },
                    { text: 'こんにちは！' },
                ],
            },
            { role: 'user', parts: [{ text: 'again' }] },
        ];
        const out = apiUtils.convertGeminiToOpenAIFormat(msgs, {
            passthroughReasoning: true,
            reasoningEchoPad: true,
        });
        const assistant = out.find((m) => m.role === 'assistant');
        expect(assistant.reasoning_content).toBe('深く考えた');
    });

    it('echoPad 無効時（他プロバイダー相当）は reasoning_content を付けない', () => {
        const msgs = [
            { role: 'user', parts: [{ text: 'hi' }] },
            { role: 'model', parts: [{ text: 'hello' }] },
            { role: 'user', parts: [{ text: 'again' }] },
        ];
        const out = apiUtils.convertGeminiToOpenAIFormat(msgs, {
            passthroughReasoning: true,
        });
        const assistant = out.find((m) => m.role === 'assistant');
        expect('reasoning_content' in assistant).toBe(false);
    });

    it('passthroughReasoning 無効時（OpenCode以外）は何も変わらない', () => {
        const out = apiUtils.convertGeminiToOpenAIFormat(toolHistory(), {});
        const assistant = out.find((m) => m.role === 'assistant');
        expect('reasoning_content' in assistant).toBe(false);
    });

    // OpenRouter の Gemini 系は、応答の reasoning_details（thought_signature を含む構造化
    // 思考）を毎回のリクエストでそのまま返さないと 400
    // "Gemini models require OpenRouter reasoning details to be preserved in each request"
    // になる。テキスト（thoughtSummary）だけでは復元できないため配列を丸ごと往復させる。
    it('passthroughReasoningDetails 有効時は assistant の _reasoningDetails を reasoning_details に戻す', () => {
        const details = [
            { type: 'thinking', summary: [{ type: 'summary_text', text: '考えた' }], signature: 'sig_1' },
        ];
        const msgs = [
            { role: 'user', parts: [{ text: 'hi' }] },
            { role: 'model', parts: [{ text: 'こんにちは！' }], _reasoningDetails: details },
            { role: 'user', parts: [{ text: 'again' }] },
        ];
        const out = apiUtils.convertGeminiToOpenAIFormat(msgs, {
            passthroughReasoningDetails: true,
        });
        const assistant = out.find((m) => m.role === 'assistant');
        expect(assistant.reasoning_details).toEqual(details);
    });

    it('passthroughReasoningDetails 無効時（他プロバイダー）は reasoning_details を付けない', () => {
        const msgs = [
            { role: 'user', parts: [{ text: 'hi' }] },
            {
                role: 'model',
                parts: [{ text: 'hello' }],
                _reasoningDetails: [{ type: 'thinking', summary: 'x' }],
            },
        ];
        const out = apiUtils.convertGeminiToOpenAIFormat(msgs, {});
        const assistant = out.find((m) => m.role === 'assistant');
        expect('reasoning_details' in assistant).toBe(false);
    });

    it('user メッセージの _reasoningDetails は reasoning_details にしない（assistant のみ）', () => {
        const msgs = [
            {
                role: 'user',
                parts: [{ text: 'hi' }],
                _reasoningDetails: [{ type: 'thinking', summary: 'x' }],
            },
        ];
        const out = apiUtils.convertGeminiToOpenAIFormat(msgs, {
            passthroughReasoningDetails: true,
        });
        expect('reasoning_details' in out[0]).toBe(false);
    });
});
