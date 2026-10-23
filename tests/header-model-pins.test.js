// メイン画面右上（ヘッダー）のモデル選択を「設定で選んだものだけ」にする機能のテスト。
//
// 背景: ヘッダーのセレクトは設定画面の #model-name を innerHTML ごとミラーしていたため、
// API取得モデルを入れると数百件が並び選びにくかった。設定画面でチェックしたモデルだけを
// 右上に出す。加えて OpenRouter の deepseek/deepseek-v4-pro と @preset/argon-flex は常時表示。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    filterHeaderOptionsHtml,
    getHeaderModelPins,
    normalizeHeaderModelPins,
    normalizeModelIdList,
    resolveHeaderModelIds,
} from '../src/utils/header-models.js';

const read = (relPath) => readFileSync(resolve(process.cwd(), relPath), 'utf8');

describe('resolveHeaderModelIds', () => {
    const available = ['a/1', 'b/2', 'c/3', 'd/4'];

    it('ピンが無ければ全モデルを出す（従来の挙動を変えない）', () => {
        expect(resolveHeaderModelIds({ available, pins: [] })).toEqual(available);
        expect(resolveHeaderModelIds({ available })).toEqual(available);
        expect(resolveHeaderModelIds({ available, pins: null })).toEqual(available);
    });

    it('ピンがあれば、そのモデルだけを元の順序で出す', () => {
        expect(resolveHeaderModelIds({ available, pins: ['c/3', 'a/1'] })).toEqual(['a/1', 'c/3']);
    });

    it('常時表示はピンの有無に関係なく必ず含む', () => {
        expect(resolveHeaderModelIds({ available, pins: ['b/2'], alwaysInclude: ['x/9'] })).toEqual([
            'b/2',
            'x/9',
        ]);
        expect(resolveHeaderModelIds({ available, alwaysInclude: ['x/9'] })).toEqual([
            ...available,
            'x/9',
        ]);
        // すでに候補にある常時表示モデルは重複させない
        expect(resolveHeaderModelIds({ available, pins: ['b/2'], alwaysInclude: ['b/2'] })).toEqual([
            'b/2',
        ]);
    });

    it('ピンが全部ハズレ（プロバイダ切替・廃止）なら全表示に退避してヘッダーを空にしない', () => {
        expect(resolveHeaderModelIds({ available, pins: ['gone/0'] })).toEqual(available);
    });

    it('候補が空でも常時表示だけは返す', () => {
        expect(resolveHeaderModelIds({ available: [], pins: [], alwaysInclude: ['x/9'] })).toEqual([
            'x/9',
        ]);
    });

    it('重複・空白・非文字列を落とす', () => {
        expect(normalizeModelIdList([' a ', 'a', '', null, 'b', 3])).toEqual(['a', 'b']);
        expect(normalizeModelIdList('a')).toEqual([]);
    });
});

describe('normalizeHeaderModelPins / getHeaderModelPins', () => {
    it('プロバイダ→モデルID配列として整える', () => {
        const pins = normalizeHeaderModelPins({
            openrouter: [' deepseek/deepseek-v4-pro ', 'deepseek/deepseek-v4-pro', '@preset/argon-flex'],
            gemini: [],
            '': ['x'],
        });
        expect(pins).toEqual({
            openrouter: ['deepseek/deepseek-v4-pro', '@preset/argon-flex'],
        });
    });

    it('壊れた値（配列・null・文字列）は空扱い', () => {
        expect(normalizeHeaderModelPins(null)).toEqual({});
        expect(normalizeHeaderModelPins([])).toEqual({});
        expect(normalizeHeaderModelPins('x')).toEqual({});
    });

    it('プロバイダ指定でピンを取り出す（未設定は空=全表示）', () => {
        const pins = { openrouter: ['a'] };
        expect(getHeaderModelPins(pins, 'openrouter')).toEqual(['a']);
        expect(getHeaderModelPins(pins, 'gemini')).toEqual([]);
        expect(getHeaderModelPins(undefined, 'openrouter')).toEqual([]);
    });
});

describe('定数（常時表示モデル）', () => {
    it('OpenRouter の deepseek-v4-pro と Argon の flex プリセットが常時表示', async () => {
        const { ALWAYS_VISIBLE_HEADER_MODELS, OPENROUTER_PRESETS } = await import('../src/constants.js');
        expect(ALWAYS_VISIBLE_HEADER_MODELS.openrouter).toContain('deepseek/deepseek-v4-pro');
        expect(ALWAYS_VISIBLE_HEADER_MODELS.openrouter).toContain('@preset/argon-flex');
        // プリセットの表記（Gemini 4 Argon (Flex)）は定数側のラベルを使う
        expect(OPENROUTER_PRESETS.some((p) => p.value === '@preset/argon-flex')).toBe(true);
        expect(OPENROUTER_PRESETS[0].label).toContain('Gemini 4 Argon');
    });
});

describe('filterHeaderOptionsHtml（ヘッダー用のDOM絞り込み）', () => {
    const html = [
        '<option value="a/1">A1</option>',
        '<option value="b/2">B2</option>',
        '<optgroup label="追加モデル" id="user-defined-models-group">',
        '  <option value="c/3" data-provider="openrouter" data-user-defined="true">C3</option>',
        '</optgroup>',
    ].join('');

    const valuesOf = (result) => {
        const box = document.createElement('div');
        box.innerHTML = result;
        return Array.from(box.querySelectorAll('option')).map((o) => o.value);
    };

    it('ピンが無ければ全部残す（従来のミラーと同じ）', () => {
        expect(valuesOf(filterHeaderOptionsHtml({ html }))).toEqual(['a/1', 'b/2', 'c/3']);
    });

    it('ピンがあればそのモデルだけ残し、空になったグループは消す', () => {
        const result = filterHeaderOptionsHtml({ html, pins: ['c/3'] });
        expect(valuesOf(result)).toEqual(['c/3']);
        const box = document.createElement('div');
        box.innerHTML = result;
        // 標準モデルは全部消えるので、optgroup は「追加モデル」だけが残る
        expect(Array.from(box.querySelectorAll('optgroup')).length).toBe(1);
        expect(box.querySelector('optgroup').label).toBe('追加モデル');
    });

    it('常時表示モデルが候補に無ければ「常時表示」グループとして補う（ラベル付き）', () => {
        const result = filterHeaderOptionsHtml({
            html,
            pins: ['a/1'],
            alwaysInclude: ['@preset/argon-flex'],
            provider: 'openrouter',
            labels: { '@preset/argon-flex': 'Gemini 4 Argon (Flex) — @preset/argon-flex' },
        });
        expect(valuesOf(result)).toEqual(['a/1', '@preset/argon-flex']);
        const box = document.createElement('div');
        box.innerHTML = result;
        const group = box.querySelector('optgroup');
        expect(group.label).toBe('常時表示');
        const opt = box.querySelector('option[value="@preset/argon-flex"]');
        expect(opt.textContent).toContain('Gemini 4 Argon');
        // 右上から選んだときにプロバイダを切り替えられるよう data-provider を付ける
        expect(opt.dataset.provider).toBe('openrouter');
    });

    it('常時表示モデルが既に候補にあれば重複させない', () => {
        const result = filterHeaderOptionsHtml({ html, pins: ['c/3'], alwaysInclude: ['c/3'] });
        expect(valuesOf(result)).toEqual(['c/3']);
    });
});

describe('配線（回帰防止）', () => {
    it('設定画面に「右上に表示するモデル」の一覧がある', () => {
        const html = read('index.html');
        expect(html).toContain('id="header-model-pins-container"');
        expect(html).toContain('id="header-model-pins-list"');
        expect(html).toContain('id="header-model-pins-status"');
        expect(html).toContain('id="header-model-pins-clear"');
    });

    it('ヘッダーのミラーはピンで絞り、常時表示を補う', () => {
        const appJs = read('src/app.js');
        const utils = read('src/utils/header-models.js');
        expect(appJs).toContain('filterHeaderOptionsHtml({');
        expect(appJs).toContain("window.addEventListener('header-model-pins-changed', syncToHeader)");
        // 常時表示モデルは設定側の一覧にも入れておく（選んだときに mainSelect と一致させる）
        expect(appJs).toContain('ALWAYS_VISIBLE_HEADER_MODELS.openrouter');
        // 絞り込みと「常時表示」グループの組み立ては util 側（テスト対象）
        expect(utils).toContain('resolveHeaderModelIds({ available, pins, alwaysInclude })');
        expect(utils).toContain("group.label = '常時表示'");
    });

    it('設定画面の一覧はプロバイダのモデルから作り、変更を永続化する', () => {
        const lifecycle = read('src/app-logic/lifecycle.js');
        expect(lifecycle).toContain('renderHeaderModelPins()');
        expect(lifecycle).toContain('async saveHeaderModelPins()');
        expect(lifecycle).toContain('state.activeProfile.settings.headerModelPins');
        // プロバイダ切替・モデル一覧更新のたびに作り直す
        expect(lifecycle).toContain('this.renderHeaderModelPins();');
    });

    it('プロファイルのエクスポートに含める', () => {
        expect(read('src/app-logic/profile.js')).toContain('settings.headerModelPins');
    });

    it('既定は「絞り込みなし」（空オブジェクト）', () => {
        expect(read('src/state.js')).toContain('headerModelPins: {}');
    });
});
