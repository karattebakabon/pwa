// 無料枠モデル（:free）まわりの回帰テスト。
//
// 背景: OpenRouter の無料バリアントは共有エンドポイントで余力が少なく、Function Calling の
// ツール定義をまとめて送ると応答が返らず固まる。実測（2026-09・実エンドポイント）:
//   google/gemma-4-31b-it:free … tools（18個）付き → 180秒以上無応答
//                                tools 無し → 数秒で正常応答（PC・スマホ両方で再現）
// そのため無料モデルにはツール定義を送らない方針を固定する。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isFreeVariantModel } from '../src/utils/model-select.js';

const read = (relPath) => readFileSync(resolve(process.cwd(), relPath), 'utf8');

describe('isFreeVariantModel', () => {
    it(':free で終わるモデルを無料枠と判定する', () => {
        expect(isFreeVariantModel('google/gemma-4-31b-it:free')).toBe(true);
        expect(isFreeVariantModel('nex-agi/nex-n2.5-mini:free')).toBe(true);
        expect(isFreeVariantModel('meta-llama/llama-3.1-8b-instruct:free')).toBe(true);
        expect(isFreeVariantModel('google/gemma-4-31b-it:free ')).toBe(true); // 末尾空白
    });

    it('有料モデル・ルーター・空値は無料枠ではない', () => {
        expect(isFreeVariantModel('google/gemma-4-31b-it')).toBe(false);
        expect(isFreeVariantModel('openrouter/free')).toBe(false); // ルーターはツール可
        expect(isFreeVariantModel('anthropic/claude-opus-4.6')).toBe(false);
        expect(isFreeVariantModel('')).toBe(false);
        expect(isFreeVariantModel(undefined)).toBe(false);
    });
});

describe('配線（回帰防止）', () => {
    const apiJs = read('src/api.js');

    it('無料モデルには Function Calling ツールを送らない', () => {
        expect(apiJs).toContain('isFreeVariantModel(model)');
        // 送信条件から無料モデルを除外している
        expect(apiJs).toContain('window.functionDeclarations && !isFreeVariantModel(model)');
        // スキップしたことをログに残す（黙って機能が消えないように）
        expect(apiJs).toContain('Function Callingツールの送信をスキップします');
    });
});
