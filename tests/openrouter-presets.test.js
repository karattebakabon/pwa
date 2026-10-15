import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OPENROUTER_PRESETS } from '../src/constants.js';

const read = (p) => readFileSync(resolve(p), 'utf8');

// OpenRouter のプリセットは「仮想モデル」で、model フィールドに "@preset/<slug>" を
// そのまま送るだけでよい（アカウント限定のため /v1/models の公開一覧には出てこない）。
// そのためアプリ側からは「選択肢として見える」ことが要件になる。
describe('OpenRouter presets (@preset/<slug>)', () => {
    it('declares preset ids in the @preset/<slug> shape', () => {
        expect(OPENROUTER_PRESETS.length).toBeGreaterThan(0);
        OPENROUTER_PRESETS.forEach((preset) => {
            expect(preset.value.startsWith('@preset/')).toBe(true);
            expect(typeof preset.label).toBe('string');
            expect(preset.label.length).toBeGreaterThan(0);
        });
        expect(OPENROUTER_PRESETS.some((p) => p.value === '@preset/argon-flex')).toBe(true);
    });

    it('surfaces presets in the custom-model dropdown (header model select mirrors it)', () => {
        const app = read('src/app.js');
        expect(app).toContain("import { OPENROUTER_PRESETS } from './constants.js'");
        expect(app).toContain('OPENROUTER_PRESETS.forEach');
        expect(app).toContain("opt.dataset.provider = 'openrouter'");
        expect(app).toContain("opt.dataset.userDefined = 'true'");
    });

    it('surfaces presets in the OpenRouter model-name input datalist', () => {
        const lifecycle = read('src/app-logic/lifecycle.js');
        expect(lifecycle).toContain('OPENROUTER_PRESETS.forEach');
    });

    it('sends the preset id verbatim (no model-name rewriting on the wire)', () => {
        const api = read('src/api.js');
        expect(api).toContain('const model = state.settings.modelName || cfg.defaultModel;');
        expect(api).toContain('model: model,');
    });

    // OpenRouter 経由の Gemini 系は reasoning_details を毎回のリクエストで戻す必要がある
    // （400 "Gemini models require OpenRouter reasoning details to be preserved..."）。
    it('passes reasoning_details back for the OpenRouter provider only', () => {
        const api = read('src/api.js');
        expect(api).toContain('passthroughReasoningDetails: true');
        expect(api).toContain('message.reasoning_details = geminiMsg._reasoningDetails;');
        // Gemini ネイティブ送信では内部メタデータを除去する（未知フィールドで400になるため）
        expect(api).toContain('const contentsForGemini = messagesForApi.map((msg) => {');
        // 履歴再構築（次ターン）でも復元する
        const attachment = read('src/app-logic/attachment.js');
        expect(attachment).toContain('msg._reasoningDetails = msg.reasoningDetails;');
        // 応答解析側で構造を保持する
        const message = read('src/app-logic/message.js');
        expect(message).toContain('reasoningDetails:');
    });

    it('surfaces the provider raw error so 400s are diagnosable', () => {
        const api = read('src/api.js');
        expect(api).toContain('errorData.error.metadata?.raw');
    });

    // ダミープロンプトを履歴の末尾に追加すると「最後が model ターン」になり、Gemini・
    // OpenRouter が "Requests ending with a model turn are not supported." (400) で拒否する
    // （新規チャットの1通目から失敗する）。先頭に置くことを固定する。
    it('places dummy prompts at the head so history never ends with a model turn', () => {
        const attachment = read('src/app-logic/attachment.js');
        expect(attachment).toContain('historyToProcess.unshift(...dummyMessages);');
        expect(attachment).not.toContain(
            "historyToProcess.push({ role: 'model', content: state.settings.dummyModel"
        );
        // 先頭は常に user から始める（reverseDummyOrder で model 先頭にしない）
        expect(attachment).not.toContain('if (state.settings.reverseDummyOrder)');
    });

    // プロバイダ失敗が「200 OK + error のみ + choices なし」で返るケースを検出して
    // 詳細（metadata.raw など）を画面に出す（「ブロックされた可能性」の誤案内を防ぐ）。
    it('detects a provider failure returned as 200 + error + no choices', () => {
        const api = read('src/api.js');
        expect(api).toContain('openAIResponse.error &&');
        expect(api).toContain('プロバイダエラー:');
    });
});
