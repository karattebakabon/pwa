// Gemini の思考の深さ（thinking_level）と旧方式 thinking_budget を組み立てる純粋関数。
import { normalizeModelName } from './pricing.js';
import { geminiAcceptsThinkingBudget } from './gemini-params.js';

export const GEMINI_THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'];

/** 選択中のGeminiモデルで利用可能な思考レベル。対象外は null。 */
export function getGeminiThinkingLevels(model) {
    const normalized = normalizeModelName(model);
    if (!normalized.startsWith('gemini')) return null;

    // 画像生成・埋め込み・Live等は思考レベルの対象外。
    if (/-image|embedding|-live|-tts|robotics/.test(normalized)) return null;

    // 公式対応表で minimal が案内されているモデル群。
    if (
        normalized.startsWith('gemini-3-6-flash') ||
        normalized.startsWith('gemini-3-5-flash') ||
        normalized.startsWith('gemini-3-flash') ||
        normalized.startsWith('gemini-3-1-flash-lite')
    ) {
        return GEMINI_THINKING_LEVELS;
    }

    // Gemini 3 Pro preview exposes only low and high in the official API table.
    if (normalized.startsWith('gemini-3-pro-preview')) return ['low', 'high'];

    // 数値付きの3系・2.5系は共通の low / medium / high を提示する。
    // 未知の将来モデルにも新方式で指定できるよう、3以降は保守的に共通段階を使う。
    const version = /^gemini-(\d+)(?:-(\d+))?/.exec(normalized);
    if (version) {
        const major = Number(version[1]);
        if (major >= 3) return ['low', 'medium', 'high'];
        if (major === 2 && version[2] === '5') return ['low', 'medium', 'high'];
        return null;
    }

    // gemini-flash-latest のような別名ではバージョンを特定できない。
    if (normalized.endsWith('-latest')) return ['low', 'medium', 'high'];
    return null;
}

/** Gemini REST API向け thinkingConfig を作る。thinkingLevel が旧 budget より優先。 */
export function buildGeminiThinkingConfig({ model, thinkingLevel, thinkingBudget, includeThoughts }) {
    const config = {};
    const level = typeof thinkingLevel === 'string' ? thinkingLevel.trim().toLowerCase() : '';
    const allowedLevels = getGeminiThinkingLevels(model);

    if (level && allowedLevels?.includes(level)) {
        config.thinkingLevel = level.toUpperCase();
    } else if (
        Number.isFinite(thinkingBudget) &&
        thinkingBudget > 0 &&
        geminiAcceptsThinkingBudget(model)
    ) {
        config.thinkingBudget = thinkingBudget;
    }

    if (includeThoughts) config.includeThoughts = true;
    return Object.keys(config).length > 0 ? config : null;
}

/** 翻訳など軽い用途用。旧budget対応モデルでは0、新モデルは最小levelを使う。 */
export function buildGeminiLightThinkingConfig(model) {
    if (geminiAcceptsThinkingBudget(model)) return { thinkingBudget: 0 };
    const levels = getGeminiThinkingLevels(model);
    return levels?.length ? { thinkingLevel: levels[0].toUpperCase() } : null;
}
