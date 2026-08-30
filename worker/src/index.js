// Cloudflare Worker: OpenCode Go API のブラウザ用 CORS プロキシ
//
// 背景:
//   OpenCode Go (https://opencode.ai/zen/go/v1/*) は OpenAI 互換 API だが、
//   CORS ヘッダー (Access-Control-Allow-Origin) を返さず、OPTIONS プリフライトも
//   404 になるため、ブラウザ (PWA) からの直接 fetch がブロックされる。
//   本 Worker がサーバー間で中継し、CORS ヘッダーを付与して返す。
//
// 設計:
//   - APIキーは PWA 側が Authorization ヘッダーで送り、Worker はそのまま中継する
//     （Worker 側にキーを保存しない → キー漏洩リスクなし）
//   - 設置者以外の不正利用を防ぐため、任意の共有トークンでの簡易認証に対応
//     （環境変数 X_ACCESS_TOKEN を設定した場合のみ有効。未設定なら誰でも叩けるので注意）
//   - 対応メソッド: GET (モデル一覧) / POST (チャット)

const UPSTREAM_BASE = 'https://opencode.ai/zen/go/v1';

// CORS 用の共通ヘッダー。ワイルドカード(*)は Authorization を使う場合に問題になるため、
// リクエストの Origin をそのまま返す（個人利用のプロキシなので許容）。
function corsHeaders(request) {
    const origin = request.headers.get('Origin') || '*';
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Access-Token',
        'Access-Control-Max-Age': '86400',
    };
}

export default {
    async fetch(request) {
        const url = new URL(request.url);

        // プリフライト
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(request) });
        }

        // ヘルスチェック
        if (url.pathname === '/' || url.pathname === '/health') {
            return new Response(JSON.stringify({ ok: true, proxy: 'opencode-go' }), {
                headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
            });
        }

        // パスはそのまま上流へマップ (/models → /v1/models, /chat/completions → /v1/chat/completions)
        const upstreamUrl = UPSTREAM_BASE + url.pathname;

        // 共有トークン認証（X_ACCESS_TOKEN シークレット設定時のみ）
        const sharedToken = globalThis.X_ACCESS_TOKEN;
        if (sharedToken) {
            const provided = request.headers.get('X-Access-Token');
            if (provided !== sharedToken) {
                return new Response(JSON.stringify({ error: { message: 'Invalid or missing X-Access-Token' } }), {
                    status: 401,
                    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
                });
            }
        }

        // 上流へ中継（Authorization を含めヘッダーをそのまま転送）
        const upstreamHeaders = new Headers();
        for (const name of ['Authorization', 'Content-Type', 'Accept']) {
            const v = request.headers.get(name);
            if (v) upstreamHeaders.set(name, v);
        }

        const upstreamRequest = new Request(upstreamUrl, {
            method: request.method,
            headers: upstreamHeaders,
            body: request.method === 'POST' ? request.body : undefined,
            // duplex は標準ではないが Cloudflare Workers の fetch では不要
        });

        let upstreamResponse;
        try {
            upstreamResponse = await fetch(upstreamRequest);
        } catch (err) {
            return new Response(JSON.stringify({ error: { message: `Upstream fetch failed: ${err.message}` } }), {
                status: 502,
                headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
            });
        }

        // 上流のレスポンスに CORS ヘッダーを付けて返す
        const responseHeaders = new Headers(upstreamResponse.headers);
        const extra = corsHeaders(request);
        for (const [k, v] of Object.entries(extra)) responseHeaders.set(k, v);
        // content-encoding 等は Workers が自動処理するためそのまま透過
        return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            headers: responseHeaders,
        });
    },
};
