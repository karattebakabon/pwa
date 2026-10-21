// OpenRouter のプロバイダー設定（リクエストボディの provider オブジェクト）の回帰テスト。
//
// 背景: OpenRouter は既定で価格ベースの負荷分散を行うため、同じモデルでも量子化が粗い
// 提供元（fp4 / int4）に当たると出力品質が揺れる。DeepSeek のようなオープンウェイト系は
// 提供元ごとに fp8 / fp4 が混在しているため、order / quantizations で制御する。
//
// 検証する契約:
//   1. 設定の JSON は provider にそのまま入る（未知キーは弾く＝タイポで無効化されない）
//   2. order / only / quantizations の違い（優先順 vs 絞り込み）を警告として画面に出す
//   3. OFF / 空欄 / 壊れた JSON のときは provider を送らない（リクエストを壊さない）
//   4. 実際の送信経路（api.js の callApi）で body.provider に入る／入らない
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    DEFAULT_OPENROUTER_PROVIDER_PREFS,
    DEFAULT_OPENROUTER_PROVIDER_PREFS_ENABLED,
    OPENROUTER_PROVIDER_PREFS_PRESETS,
    buildOpenRouterProviderField,
    parseOpenRouterProviderPrefs,
} from '../src/utils/openrouter-provider.js';
import { apiUtils } from '../src/api.js';
import { state } from '../src/state.js';

const read = (relPath) => readFileSync(resolve(process.cwd(), relPath), 'utf8');

describe('parseOpenRouterProviderPrefs（純粋関数）', () => {
    it('ユーザーが指定した形（quantizations + order）をそのまま通す', () => {
        const parsed = parseOpenRouterProviderPrefs(
            JSON.stringify({
                quantizations: ['fp8', 'fp16', 'bf16', 'fp32'],
                order: ['deepseek', 'novita', 'deepinfra'],
            })
        );
        expect(parsed.ok).toBe(true);
        expect(parsed.value).toEqual({
            quantizations: ['fp8', 'fp16', 'bf16', 'fp32'],
            order: ['deepseek', 'novita', 'deepinfra'],
        });
        // 送るが、絞り込みであることは警告として出す
        expect(parsed.warnings.join(' ')).toContain('quantizations');
    });

    it('only（許可リスト）と allow_fallbacks を通す', () => {
        const parsed = parseOpenRouterProviderPrefs(
            '{"only": ["deepseek", "novita"], "allow_fallbacks": false}'
        );
        expect(parsed.ok).toBe(true);
        expect(parsed.value.only).toEqual(['deepseek', 'novita']);
        expect(parsed.value.allow_fallbacks).toBe(false);
        expect(parsed.warnings.join(' ')).toContain('only');
    });

    it('空欄・空白・null は「送らない」と判定する（ok:true / empty:true）', () => {
        for (const text of ['', '   ', '\n', null, undefined, 'null', '{}']) {
            const parsed = parseOpenRouterProviderPrefs(text);
            expect(parsed.ok).toBe(true);
            expect(parsed.empty).toBe(true);
            expect(parsed.value).toBeNull();
        }
    });

    it('壊れた JSON はエラーにして送らない', () => {
        const parsed = parseOpenRouterProviderPrefs('{"order": ["deepseek",');
        expect(parsed.ok).toBe(false);
        expect(parsed.value).toBeNull();
        expect(parsed.error).toContain('JSON');
    });

    it('オブジェクト以外（配列・数値・文字列）はエラー', () => {
        expect(parseOpenRouterProviderPrefs('["deepseek"]').ok).toBe(false);
        expect(parseOpenRouterProviderPrefs('123').ok).toBe(false);
        expect(parseOpenRouterProviderPrefs('"deepseek"').ok).toBe(false);
    });

    it('未知のキーは弾く（タイポが黙って無視されない）', () => {
        const parsed = parseOpenRouterProviderPrefs('{"quantization": ["fp8"]}');
        expect(parsed.ok).toBe(false);
        expect(parsed.error).toContain('quantization');
        // 正しいキーは通る
        expect(parseOpenRouterProviderPrefs('{"quantizations": ["fp8"]}').ok).toBe(true);
    });

    it('量子化レベルは既知の値だけ受け付ける', () => {
        expect(parseOpenRouterProviderPrefs('{"quantizations": ["fp4"]}').ok).toBe(true);
        const bad = parseOpenRouterProviderPrefs('{"quantizations": ["fp12"]}');
        expect(bad.ok).toBe(false);
        expect(bad.error).toContain('fp12');
        expect(parseOpenRouterProviderPrefs('{"quantizations": []}').ok).toBe(false);
    });

    it('型が違う値はエラー（順序リストに文字列以外など）', () => {
        expect(parseOpenRouterProviderPrefs('{"order": "deepseek"}').ok).toBe(false);
        expect(parseOpenRouterProviderPrefs('{"order": [1, 2]}').ok).toBe(false);
        expect(parseOpenRouterProviderPrefs('{"allow_fallbacks": "yes"}').ok).toBe(false);
        expect(parseOpenRouterProviderPrefs('{"data_collection": "maybe"}').ok).toBe(false);
        expect(parseOpenRouterProviderPrefs('{"sort": "fastest"}').ok).toBe(false);
    });

    it('sort / パフォーマンス閾値 / max_price も検証して通す', () => {
        const parsed = parseOpenRouterProviderPrefs(
            '{"sort": {"by": "throughput", "partition": "none"}, "preferred_min_throughput": {"p90": 50}, "max_price": {"prompt": 1}}'
        );
        expect(parsed.ok).toBe(true);
        expect(parsed.value.sort).toEqual({ by: 'throughput', partition: 'none' });
        expect(parseOpenRouterProviderPrefs('{"sort": {"by": "fastest"}}').ok).toBe(false);
        expect(parseOpenRouterProviderPrefs('{"preferred_max_latency": {"p95": 3}}').ok).toBe(false);
    });
});

describe('buildOpenRouterProviderField（設定→リクエスト差分）', () => {
    const base = { openrouterProviderPrefs: DEFAULT_OPENROUTER_PROVIDER_PREFS };
    const prefs = JSON.parse(DEFAULT_OPENROUTER_PROVIDER_PREFS);

    it('既定（品質優先）は fp4 以下を除外する設定になっている', () => {
        expect(DEFAULT_OPENROUTER_PROVIDER_PREFS_ENABLED).toBe(true);
        expect(prefs.quantizations).toEqual(['fp8', 'fp16', 'bf16', 'fp32']);
        expect(prefs.quantizations).not.toContain('fp4');
        expect(prefs.quantizations).not.toContain('int4');
        expect(prefs.order).toEqual(['deepseek', 'novita', 'deepinfra']);
        expect(prefs.allow_fallbacks).toBe(true);
        expect(OPENROUTER_PROVIDER_PREFS_PRESETS.order.json).not.toContain('quantizations');
    });

    it('既定の設定は provider として展開される', () => {
        expect(buildOpenRouterProviderField(base)).toEqual({ provider: prefs });
    });

    it('チェックOFFなら送らない（テキストは残っていても）', () => {
        expect(
            buildOpenRouterProviderField({ ...base, openrouterProviderPrefsEnabled: false })
        ).toEqual({});
    });

    it('空欄・壊れた JSON なら送らない', () => {
        expect(buildOpenRouterProviderField({ openrouterProviderPrefs: '' })).toEqual({});
        expect(
            buildOpenRouterProviderField({ openrouterProviderPrefs: '{"order": [' })
        ).toEqual({});
        expect(buildOpenRouterProviderField({})).toEqual({});
        expect(buildOpenRouterProviderField(undefined)).toEqual({});
    });
});

describe('送信経路（実リクエストボディ）', () => {
    const savedSettings = {};
    let fetchMock;

    beforeEach(() => {
        for (const [key, value] of Object.entries(state.settings)) savedSettings[key] = value;
        state.settings.apiProvider = 'openrouter';
        state.settings.openrouterApiKey = 'test-key';
        state.settings.modelName = 'deepseek/deepseek-chat';
        state.settings.includeThoughts = false;
        state.settings.geminiEnableFunctionCalling = false;
        state.settings.openrouterProviderPrefs = DEFAULT_OPENROUTER_PROVIDER_PREFS;
        state.settings.openrouterProviderPrefsEnabled = true;
        state.activeProjectKnowledge = [];
        fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
            }),
            headers: { get: () => null },
        }));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        for (const key of Object.keys(state.settings)) delete state.settings[key];
        Object.assign(state.settings, savedSettings);
        vi.unstubAllGlobals();
    });

    const bodyOf = () => JSON.parse(fetchMock.mock.calls[0][1].body);

    it('OpenRouter の本文生成リクエストに provider が入る', async () => {
        await apiUtils.callApi(
            [{ role: 'user', parts: [{ text: 'こんにちは' }] }],
            { temperature: 0.7 },
            null
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toContain('openrouter.ai');
        expect(bodyOf().provider).toEqual(JSON.parse(DEFAULT_OPENROUTER_PROVIDER_PREFS));
    });

    it('チェックOFFなら provider を付けない', async () => {
        state.settings.openrouterProviderPrefsEnabled = false;
        await apiUtils.callApi(
            [{ role: 'user', parts: [{ text: 'こんにちは' }] }],
            { temperature: 0.7 },
            null
        );
        expect('provider' in bodyOf()).toBe(false);
    });

    it('壊れた JSON でも送信自体は成立し、provider を付けない', async () => {
        state.settings.openrouterProviderPrefs = '{"order": [';
        await apiUtils.callApi(
            [{ role: 'user', parts: [{ text: 'こんにちは' }] }],
            { temperature: 0.7 },
            null
        );
        expect('provider' in bodyOf()).toBe(false);
    });
});

describe('配線（回帰防止）', () => {
    const apiJs = read('src/api.js');
    const chatJs = read('src/app-logic/chat.js');
    const memoryJs = read('src/app-logic/memory.js');
    const indexHtml = read('index.html');

    it('OpenRouter のアダプタだけが provider 設定を渡す（他プロバイダーには送らない）', () => {
        // cfg.getProviderPrefs を渡しているのは OpenRouter のケースだけ
        expect(apiJs).toContain('getProviderPrefs: getOpenRouterProviderPrefs');
        expect((apiJs.match(/getProviderPrefs:/g) || []).length).toBe(1);
        expect(apiJs).toContain('if (typeof cfg.getProviderPrefs === \'function\')');
    });

    it('タイトル生成・要約/メモリも同じ条件で provider を送る', () => {
        expect(chatJs).toContain('buildOpenRouterProviderField(state.settings)');
        expect(memoryJs).toContain('buildOpenRouterProviderField(state.settings)');
    });

    it('絞り込みで提供元が無くなったときは 404 に案内を添える', () => {
        expect(apiJs).toContain('プロバイダー設定」が条件に合う提供元を見つけられませんでした');
    });

    it('設定画面に JSON 入力・ON/OFF・プリセットがある', () => {
        expect(indexHtml).toContain('id="openrouter-provider-prefs"');
        expect(indexHtml).toContain('id="openrouter-provider-prefs-enabled-toggle"');
        expect(indexHtml).toContain('id="openrouter-prefs-preset-quality"');
        expect(indexHtml).toContain('id="openrouter-prefs-preset-order"');
        expect(indexHtml).toContain('id="openrouter-prefs-preset-clear"');
    });

    it('設定がプロファイルへ保存・書き出しされる（再起動で消えない）', () => {
        const profileJs = read('src/app-logic/profile.js');
        expect(profileJs).toContain("'openrouterProviderPrefs',");
        expect(profileJs).toContain("'openrouterProviderPrefsEnabled',");
        const lifecycleJs = read('src/app-logic/lifecycle.js');
        expect(lifecycleJs).toContain('openrouterProviderPrefs: {');
        expect(lifecycleJs).toContain("event: 'change',");
    });
});
