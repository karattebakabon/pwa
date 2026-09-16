// レート制限・リトライまわりの判定（純粋関数のみ）。DB・DOMに触らない。
//
// 背景: OpenRouter の無料モデル（ID が ":free" で終わるもの）は
//   ・OpenRouter 側の「分あたり／日あたり」リクエスト上限（HTTP 429）
//   ・上流プロバイダが1社しかないため混雑すると応答が返らない
// という2つの理由で失敗しやすい。429 は Retry-After ヘッダ付きで返るので、
// 呼び出し側が「いつ再試行してよいか」を尊重できるようにここで解釈する。

/**
 * HTTPステータスが「待てば直る」ものかどうか。
 * status が無い（ネットワーク断・タイムアウト等）はリトライ対象とみなす。
 * @param {number|undefined|null} status
 * @returns {boolean}
 */
export function isRetryableStatus(status) {
    if (!status) return true;
    if (status === 429) return true; // レート制限（無料モデルで頻発）
    if (status === 408 || status === 409 || status === 425) return true; // 一時的な競合・タイムアウト
    return status >= 500; // サーバ側の一時障害
}

/**
 * Retry-After ヘッダの値をミリ秒に変換する。
 * RFC 9110 の2形式（秒数 "30" と HTTP-date "Wed, 21 Oct 2026 07:28:00 GMT"）に対応。
 * 解釈できない値・空値は null（＝呼び出し側は通常の指数バックオフを使う）。
 * @param {string|null|undefined} value
 * @param {number} [now] 現在時刻(epoch ms)。テスト用に差し替え可能
 * @returns {number|null} 待機すべきミリ秒（負にならない）
 */
export function parseRetryAfter(value, now = Date.now()) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    if (!s) return null;
    // 秒数（小数も許容する）
    if (/^\d+(\.\d+)?$/.test(s)) {
        return Math.max(0, Math.round(parseFloat(s) * 1000));
    }
    // HTTP-date
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    return Math.max(0, t - now);
}

/**
 * 429 のときに「待ちすぎ」と判断すべき上限（ms）。
 * 日次上限のように待っても無駄なケースで延々と待たないための安全弁。
 * 既定は バックオフ上限の5倍（例: 60秒設定なら5分）。
 * @param {number} maxBackoffDelaySeconds
 * @returns {number}
 */
export function maxRateLimitWaitMs(maxBackoffDelaySeconds) {
    const base = Number(maxBackoffDelaySeconds) > 0 ? Number(maxBackoffDelaySeconds) : 60;
    return Math.max(base, 60) * 1000 * 5;
}
