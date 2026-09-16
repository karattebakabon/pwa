// レート制限（429）とリトライ方針の回帰テスト。
//
// 背景: OpenRouter の無料モデル（ID が ":free"）は
//   ・OpenRouter 側の分あたり／日あたり上限に当たりやすく HTTP 429 が返る
//   ・提供元が1社しかないため混雑すると応答が返らず、画面が「応答生成中...」で固まる
// という2つの失敗をしやすい。429 は即エラーにせず Retry-After を尊重して再試行し、
// 無料モデルのときだけタイムアウトの安全弁をかける、という方針を固定する。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isRetryableStatus, maxRateLimitWaitMs, parseRetryAfter } from '../src/utils/retry.js';

const read = (relPath) => readFileSync(resolve(process.cwd(), relPath), 'utf8');

describe('parseRetryAfter', () => {
    const NOW = Date.UTC(2026, 8, 16, 0, 0, 0); // 2026-09-16T00:00:00Z

    it('秒数（整数・小数）をミリ秒に変換する', () => {
        expect(parseRetryAfter('30')).toBe(30_000);
        expect(parseRetryAfter('1.5')).toBe(1500);
        expect(parseRetryAfter('0')).toBe(0);
    });

    it('HTTP-date を現在時刻からの差分に変換する', () => {
        expect(parseRetryAfter('Wed, 16 Sep 2026 00:00:20 GMT', NOW)).toBe(20_000);
    });

    it('解釈できない値・空値は null（＝通常の指数バックオフにまかせる）', () => {
        expect(parseRetryAfter(null)).toBeNull();
        expect(parseRetryAfter(undefined)).toBeNull();
        expect(parseRetryAfter('')).toBeNull();
        expect(parseRetryAfter('   ')).toBeNull();
        expect(parseRetryAfter('soon')).toBeNull();
    });

    it('過去の日時は0（負の待機時間を作らない）', () => {
        expect(parseRetryAfter('Wed, 16 Sep 2026 00:00:00 GMT', NOW + 5000)).toBe(0);
    });
});

describe('isRetryableStatus', () => {
    it('429（レート制限）・5xx・ステータス無し（ネットワーク断/タイムアウト）はリトライ対象', () => {
        expect(isRetryableStatus(429)).toBe(true);
        expect(isRetryableStatus(500)).toBe(true);
        expect(isRetryableStatus(503)).toBe(true);
        expect(isRetryableStatus(undefined)).toBe(true);
        expect(isRetryableStatus(null)).toBe(true);
    });

    it('その他の4xxは即エラー（キー不正・モデル不正・残高不足など）', () => {
        expect(isRetryableStatus(400)).toBe(false);
        expect(isRetryableStatus(401)).toBe(false);
        expect(isRetryableStatus(402)).toBe(false);
        expect(isRetryableStatus(404)).toBe(false);
    });
});

describe('maxRateLimitWaitMs', () => {
    it('バックオフ上限の5倍（最低5分）を「待ちすぎ」の境界にする', () => {
        expect(maxRateLimitWaitMs(60)).toBe(300_000);
        expect(maxRateLimitWaitMs(10)).toBe(300_000); // 最低5分
        expect(maxRateLimitWaitMs(120)).toBe(600_000);
        expect(maxRateLimitWaitMs(undefined)).toBe(300_000); // 既定60秒
    });
});

describe('配線（回帰防止）', () => {
    const appJs = read('src/app.js');
    const apiJs = read('src/api.js');
    const messageJs = read('src/app-logic/message.js');
    const swJs = read('sw.js');
    const html = read('index.html');

    it('「全プロバイダーの最新モデルを取得」に OpenRouter が含まれる', () => {
        // 以前は compatList に OpenRouter が無く、OpenRouter だけ取得できなかった
        expect(appJs).toContain('https://openrouter.ai/api/v1/models');
        expect(appJs).toContain("key: 'openrouter'");
    });

    it('OpenRouter の一覧は APIキー未設定でも取得する（noAuthOk）', () => {
        expect(appJs).toContain('p.apiKey || p.noAuthOk');
        // "Bearer undefined" を送らない（未設定時に 401 になるため）
        expect(appJs).toContain("if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`");
    });

    it('429 の Retry-After をエラーに載せて返す（OpenAI互換・Gemini 両経路）', () => {
        const hits = apiJs.match(/headers\.get\('Retry-After'\)/g) || [];
        expect(hits.length).toBeGreaterThanOrEqual(3); // OpenAI互換(共通/ツール) + Gemini
        expect(apiJs).toContain('error.retryAfter = retryAfterHeader');
        expect(apiJs).toContain('e.retryAfter = retryAfterHeader');
    });

    it('無料モデルのときだけタイムアウトを既定で有効にする', () => {
        expect(messageJs).toContain('OPENROUTER_FREE_TIMEOUT_SECONDS');
        expect(messageJs).toContain("endsWith(':free')");
        expect(messageJs).toContain('state.settings.enableApiTimeout || isOpenRouterFreeModel');
    });

    it('429 はリトライ経路に入る（Retry-After を待機時間に使う）', () => {
        expect(messageJs).toContain('parseRetryAfter(error.retryAfter)');
        expect(messageJs).toContain('retryAfterDelayMs');
        expect(messageJs).toContain('maxRateLimitWaitMs');
    });

    it('取得した OpenRouter モデルは入力候補（datalist）として使える', () => {
        // OpenRouter はセレクトではなくテキスト入力方式のため、取得した一覧は
        // datalist（入力候補）に入れる。手入力のタイプミス（ベンダー接頭辞の欠落など）も防げる。
        expect(html).toContain('id="openrouter-model-list"');
        expect(html).toContain('list="openrouter-model-list"');
        const lifecycleJs = read('src/app-logic/lifecycle.js');
        expect(lifecycleJs).toContain('elements.openrouterModelList');
        expect(lifecycleJs).toContain('fetchedModels.openrouter');
    });

    it('キャッシュ更新（sw.js と index.html と APP_VERSION）が揃っている', () => {
        const cacheVersion = swJs.match(/gemini-pwa-cache-v([\d.]+)/)[1];
        const scriptVersion = html.match(/app\.js\?v=([\d.]+)/)[1];
        const appVersion = read('src/constants.js').match(/APP_VERSION = '([\d.]+)'/)[1];
        expect(scriptVersion).toBe(cacheVersion);
        expect(appVersion).toBe(cacheVersion);
    });
});
