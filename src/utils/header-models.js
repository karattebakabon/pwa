// メイン画面右上（ヘッダー）のモデル選択に「何を出すか」を決める純粋関数。
//
// 背景: ヘッダーのセレクトは設定画面の #model-name を innerHTML ごとミラーしていたため、
// プロバイダの全モデル（API取得モデルを入れると数百件）がそのまま並び、選びにくかった。
// 設定画面で「右上に出すモデル」をチェックさせ、ヘッダーはそのモデルだけを出す。
//
// ルール:
//   - pins が空（未設定）     … これまでどおり全モデルを出す（既存ユーザーの挙動を変えない）
//   - pins が全部ハズレ     … 安全側で全モデルを出す（ヘッダーが空になって詰むのを防ぐ）
//   - alwaysInclude         … ピンの有無に関係なく必ず出す（例: deepseek-v4-pro / @preset/argon-flex）
//   - 並び順は「選択肢の元の順序」を保ち、足りない alwaysInclude だけ末尾に足す

/** 文字列配列を「trim・空除去・重複除去」して返す。 */
export function normalizeModelIdList(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const out = [];
    value.forEach((item) => {
        if (typeof item !== 'string') return;
        const id = item.trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        out.push(id);
    });
    return out;
}

/** ヘッダーに出すモデルIDの一覧を決める。 */
export function resolveHeaderModelIds({ available = [], pins = [], alwaysInclude = [] } = {}) {
    const avail = normalizeModelIdList(available);
    const pinList = normalizeModelIdList(pins);
    const always = normalizeModelIdList(alwaysInclude);

    let ids = pinList.length === 0 ? avail.slice() : avail.filter((id) => pinList.includes(id));
    // ピンが全て選択肢から消えている（プロバイダ切替・モデル廃止など）→ 全表示に退避
    if (ids.length === 0) ids = avail.slice();
    // 常時表示は必ず含める（元の順序を壊さないよう、無いものだけ末尾へ）
    always.forEach((id) => {
        if (!ids.includes(id)) ids.push(id);
    });
    return ids;
}

/** 保存値（プロバイダ→モデルID配列）を安全な形に整える。 */
export function normalizeHeaderModelPins(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    Object.entries(raw).forEach(([provider, value]) => {
        if (typeof provider !== 'string' || !provider.trim()) return;
        const ids = normalizeModelIdList(value);
        if (ids.length > 0) out[provider.trim()] = ids;
    });
    return out;
}

/** 指定プロバイダのピン一覧を取り出す（未設定なら空配列＝全表示）。 */
export function getHeaderModelPins(pinsMap, provider) {
    const normalized = normalizeHeaderModelPins(pinsMap);
    return normalized[provider] || [];
}

/**
 * 設定画面のセレクト（#model-name）の innerHTML を、右上（ヘッダー）用に絞り込む。
 * <option>/<optgroup> の構造を保ち、常時表示モデルが無ければ「常時表示」グループとして補う。
 *
 * @param {{html: string, pins?: string[], alwaysInclude?: string[], provider?: string,
 *          labels?: Record<string,string>}} params
 * @returns {string} 絞り込み後の innerHTML
 */
export function filterHeaderOptionsHtml({
    html = '',
    pins = [],
    alwaysInclude = [],
    provider = 'gemini',
    labels = {},
} = {}) {
    const box = document.createElement('div');
    box.innerHTML = html;

    const available = Array.from(box.querySelectorAll('option')).map((opt) => opt.value);
    const keep = resolveHeaderModelIds({ available, pins, alwaysInclude });
    const keepSet = new Set(keep);

    Array.from(box.querySelectorAll('option')).forEach((opt) => {
        if (!keepSet.has(opt.value)) opt.remove();
    });
    // 空になったグループは残さない（ラベルだけの行が出るのを防ぐ）
    Array.from(box.querySelectorAll('optgroup')).forEach((group) => {
        if (!group.querySelector('option')) group.remove();
    });

    // 常時表示モデルが設定側の一覧に無くても、右上から選べるように補う
    const present = new Set(Array.from(box.querySelectorAll('option')).map((opt) => opt.value));
    const missing = keep.filter((id) => !present.has(id));
    if (missing.length > 0) {
        const group = document.createElement('optgroup');
        group.label = '常時表示';
        missing.forEach((id) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = labels[id] || id;
            opt.dataset.provider = provider;
            opt.dataset.userDefined = 'true';
            group.appendChild(opt);
        });
        box.appendChild(group);
    }
    return box.innerHTML;
}
