// OpenRouter の「プロバイダー設定」（リクエストボディの provider オブジェクト）を扱う純粋関数。
//
// 背景: OpenRouter は既定で価格ベースの負荷分散を行うため、同じモデルでも量子化
// （quantizations）が粗い提供元に当たると出力品質が不安定になる。特に DeepSeek の
// ようなオープンウェイト系は提供元ごとに fp8 / fp4 / int4 が混在している。
// provider.order / provider.only で提供元を絞り、provider.quantizations で
// 量子化レベルを指定できる。
//
// 挙動の違い（公式 docs/guides/routing/provider-selection より）:
//   - order           … 優先順。挙がっていない提供元へもフォールバックする（allow_fallbacks 既定 true）
//   - sort            … price / throughput / latency で並べ替え。order 同様、負荷分散は無効になる
//   - only / ignore / quantizations … 絞り込み（ハードフィルタ）。条件に合う提供元が1つも
//     無いモデルではリクエスト自体が 404（No endpoints found matching your provider preferences）
//     で失敗する。allow_fallbacks では救済されない。
//   - require_parameters … ツール等のパラメータ非対応の提供元を除外（これもハードフィルタ）
//
// そのため「品質優先」プリセット（quantizations で fp4 以下を除外）と「順序のみ」
// プリセット（order だけでハードフィルタ無し）を用意し、設定画面で選べるようにしている。

// OpenRouter が受け付ける量子化レベルの一覧（公式ドキュメントの表と同じ）。
export const OPENROUTER_QUANTIZATION_LEVELS = [
    'int4',
    'int8',
    'fp4',
    'mxfp4',
    'nvfp4',
    'fp6',
    'fp8',
    'mxfp8',
    'fp16',
    'bf16',
    'fp32',
    'unknown',
];

// provider オブジェクトで許可するキーと型。タイプミス（例: "quantization"）を
// 黙って送ると OpenRouter 側で無視され「設定したのに効かない」になるため、
// 未知のキーはエラーとして弾いて画面に出す。
export const OPENROUTER_PROVIDER_PREF_KEYS = {
    order: 'providerList',
    only: 'providerList',
    ignore: 'providerList',
    quantizations: 'quantizations',
    allow_fallbacks: 'boolean',
    require_parameters: 'boolean',
    zdr: 'boolean',
    enforce_distillable_text: 'boolean',
    data_collection: 'dataCollection',
    sort: 'sort',
    preferred_min_throughput: 'numberOrObject',
    preferred_max_latency: 'numberOrObject',
    max_price: 'object',
};

// 絞り込み（ハードフィルタ）になるキー。条件に合う提供元が無いモデルでは 404 になる。
const HARD_FILTER_KEYS = ['only', 'ignore', 'quantizations', 'require_parameters', 'max_price'];

// 設定画面のプリセット。JSON 文字列として持つ（テキストエリアに直接入れて編集できる）。
export const OPENROUTER_PROVIDER_PREFS_PRESETS = {
    // 品質優先: fp4 以下の粗い量子化の提供元を除外し、信頼できる提供元を優先する。
    // ただし quantizations はハードフィルタなので、fp8 以上の提供元が無いモデルでは 404 になる。
    quality: {
        id: 'quality',
        label: '品質優先',
        description: 'fp4 以下の量子化を除外し、deepseek / novita / deepinfra を優先する',
        json: JSON.stringify(
            {
                quantizations: ['fp8', 'fp16', 'bf16', 'fp32'],
                order: ['deepseek', 'novita', 'deepinfra'],
                allow_fallbacks: true,
            },
            null,
            2
        ),
    },
    // 順序のみ: ハードフィルタを使わないので、どのモデルでも 404 にならない安全な設定。
    order: {
        id: 'order',
        label: '順序のみ',
        description: '量子化の絞り込みはせず、信頼できる提供元を優先するだけ（どのモデルでも安全）',
        json: JSON.stringify(
            {
                order: ['deepseek', 'novita', 'deepinfra'],
                allow_fallbacks: true,
            },
            null,
            2
        ),
    },
};

// 既定値。品質優先を入れておき、設定画面で OFF にも切り替えられる（チェックボックス）。
export const DEFAULT_OPENROUTER_PROVIDER_PREFS = OPENROUTER_PROVIDER_PREFS_PRESETS.quality.json;
export const DEFAULT_OPENROUTER_PROVIDER_PREFS_ENABLED = true;

const isPlainObject = (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isProviderList = (value) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0);

// JSON のキー名をそのまま画面に出せる型名に変換する。
const keyTypeLabel = (type) => {
    switch (type) {
        case 'providerList':
            return '文字列の配列（例: ["deepseek", "novita"]）';
        case 'quantizations':
            return `量子化レベルの配列（${OPENROUTER_QUANTIZATION_LEVELS.join(' / ')}）`;
        case 'boolean':
            return 'true / false';
        case 'dataCollection':
            return '"allow" または "deny"';
        case 'sort':
            return '"price" / "throughput" / "latency" または { by, partition }';
        case 'numberOrObject':
            return '数値、または { p50, p75, p90, p99 }';
        case 'object':
            return 'オブジェクト';
        default:
            return '正しい型';
    }
};

const validateQuantizations = (value) => {
    if (!Array.isArray(value) || value.length === 0) {
        return '量子化レベルの配列にしてください（例: ["fp8", "fp16", "bf16", "fp32"]）';
    }
    const unknown = value.filter(
        (item) =>
            typeof item !== 'string' ||
            !OPENROUTER_QUANTIZATION_LEVELS.includes(item.trim().toLowerCase())
    );
    if (unknown.length > 0) {
        return `扱えない量子化レベルが含まれています: ${unknown
            .map((v) => JSON.stringify(v))
            .join(', ')}（使える値: ${OPENROUTER_QUANTIZATION_LEVELS.join(' / ')}）`;
    }
    return null;
};

const validateSort = (value) => {
    if (typeof value === 'string') {
        return ['price', 'throughput', 'latency'].includes(value)
            ? null
            : 'sort は "price" / "throughput" / "latency" のいずれかで指定してください。';
    }
    if (isPlainObject(value)) {
        if (value.by !== undefined && !['price', 'throughput', 'latency'].includes(value.by)) {
            return 'sort.by は "price" / "throughput" / "latency" のいずれかで指定してください。';
        }
        if (value.partition !== undefined && !['model', 'none'].includes(value.partition)) {
            return 'sort.partition は "model" または "none" で指定してください。';
        }
        return null;
    }
    return 'sort は文字列またはオブジェクトで指定してください。';
};

const validateNumberOrObject = (key, value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return null;
    if (isPlainObject(value)) {
        const bad = Object.entries(value).filter(
            ([percentile, v]) =>
                !['p50', 'p75', 'p90', 'p99'].includes(percentile) ||
                typeof v !== 'number' ||
                !Number.isFinite(v)
        );
        if (bad.length === 0) return null;
        return `${key} のパーセンタイル指定が不正です（例: { "p50": 100 }。使えるキー: p50 / p75 / p90 / p99）。`;
    }
    return `${key} は数値または { p50, p75, p90, p99 } で指定してください。`;
};

/**
 * 設定画面のテキスト（JSON）を provider オブジェクトへ変換する。
 *
 * @param {string} text 設定画面のテキストエリアの内容
 * @returns {{ok: boolean, value: object|null, empty: boolean, warnings: string[], error: string|null}}
 *   ok:false のときは error に理由が入る（呼び出し側は送信しない）。
 *   empty:true（空欄）は「設定なし＝provider を送らない」の意味で ok:true と区別する。
 */
export function parseOpenRouterProviderPrefs(text) {
    const result = { ok: true, value: null, empty: true, warnings: [], error: null };
    if (text === undefined || text === null || String(text).trim() === '') {
        return result;
    }

    let parsed;
    try {
        parsed = JSON.parse(String(text));
    } catch (e) {
        result.ok = false;
        result.empty = false;
        result.error = `JSON として解釈できません（${e.message}）。`;
        return result;
    }

    if (parsed === null) {
        return result; // null は「設定なし」と同じ扱い
    }
    if (!isPlainObject(parsed)) {
        result.ok = false;
        result.empty = false;
        result.error =
            'provider 設定は JSON オブジェクト（{ ... }）で書いてください（配列や数値は使えません）。';
        return result;
    }
    if (Object.keys(parsed).length === 0) {
        return result;
    }

    result.empty = false;
    const value = {};

    for (const [key, rawValue] of Object.entries(parsed)) {
        const type = OPENROUTER_PROVIDER_PREF_KEYS[key];
        if (!type) {
            result.ok = false;
            result.error = `「${key}」は OpenRouter の provider 設定では使えません。使えるキー: ${Object.keys(
                OPENROUTER_PROVIDER_PREF_KEYS
            ).join(' / ')}`;
            return result;
        }

        if (type === 'boolean') {
            if (typeof rawValue !== 'boolean') {
                result.ok = false;
                result.error = `「${key}」は ${keyTypeLabel(type)} で指定してください。`;
                return result;
            }
            value[key] = rawValue;
            continue;
        }

        if (type === 'providerList') {
            if (!isProviderList(rawValue)) {
                result.ok = false;
                result.error = `「${key}」は ${keyTypeLabel(type)} で指定してください。`;
                return result;
            }
            value[key] = rawValue.map((item) => item.trim());
            continue;
        }

        if (type === 'quantizations') {
            const error = validateQuantizations(rawValue);
            if (error) {
                result.ok = false;
                result.error = error;
                return result;
            }
            value[key] = rawValue.map((item) => item.trim().toLowerCase());
            continue;
        }

        if (type === 'dataCollection') {
            if (rawValue !== 'allow' && rawValue !== 'deny') {
                result.ok = false;
                result.error = `「data_collection」は ${keyTypeLabel(type)} で指定してください。`;
                return result;
            }
            value[key] = rawValue;
            continue;
        }

        if (type === 'sort') {
            const error = validateSort(rawValue);
            if (error) {
                result.ok = false;
                result.error = error;
                return result;
            }
            value[key] = rawValue;
            continue;
        }

        if (type === 'numberOrObject') {
            const error = validateNumberOrObject(key, rawValue);
            if (error) {
                result.ok = false;
                result.error = error;
                return result;
            }
            value[key] = rawValue;
            continue;
        }

        // max_price などのオブジェクト
        if (!isPlainObject(rawValue)) {
            result.ok = false;
            result.error = `「${key}」は ${keyTypeLabel(type)} で指定してください。`;
            return result;
        }
        value[key] = rawValue;
    }

    // 注意喚起（送信はする。設定が効きすぎて失敗したときの原因を後から追えるように）
    const hardFilters = HARD_FILTER_KEYS.filter((key) => value[key] !== undefined);
    if (hardFilters.length > 0) {
        result.warnings.push(
            `${hardFilters.join(' / ')} は絞り込み（ハードフィルタ）です。条件に合う提供元が無いモデルでは「No endpoints found matching your provider preferences」で失敗します。`
        );
    }
    if (value.quantizations !== undefined && value.allow_fallbacks === false) {
        result.warnings.push(
            'quantizations で絞り込んだうえ allow_fallbacks を false にすると、提供元が落ちたときに即エラーになります。'
        );
    }
    if (value.order !== undefined && value.only !== undefined) {
        result.warnings.push(
            'order と only を両方指定しています。only で許可した提供元の中だけで order が効きます。'
        );
    }
    if (value.order !== undefined || value.sort !== undefined) {
        result.warnings.push(
            'order / sort を指定すると OpenRouter の価格ベース負荷分散は無効になります（指定順に試行）。'
        );
    }

    result.value = value;
    return result;
}

/**
 * 設定（state.settings）から、リクエストボディへそのまま展開できる差分を返す。
 * `{ provider: {...} }` または `{}`（＝送らない）。メイン送信・タイトル生成・
 * 要約のような補助経路で同じ判定を使うために用意している。
 */
export function buildOpenRouterProviderField(settings) {
    const s = settings || {};
    if (s.openrouterProviderPrefsEnabled === false) return {};
    const parsed = parseOpenRouterProviderPrefs(s.openrouterProviderPrefs);
    if (!parsed.ok || parsed.empty || !parsed.value) return {};
    return { provider: parsed.value };
}
