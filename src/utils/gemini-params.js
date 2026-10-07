// Gemini に送る generationConfig を、モデルが受け付ける形に整える純粋関数。
// Google の告知に合わせ、受け付けると確認できているモデルだけに旧パラメータを送る。
import { normalizeModelName } from './pricing.js';

// Gemini 3.6 Flash 以降では既定値に固定され、指定しても効果がない。
// 今後のモデルや -latest 別名には送らず、モデル既定値に任せる。
const SAMPLING_PARAMS_PREFIXES = [
    'gemini-2-5',
    'gemini-3-flash',
    'gemini-3-pro',
    'gemini-3-1-',
    'gemini-3-5-',
];

// thinkingBudget を受け付けると確認できているモデル（現行の3.8 Flashまで）。
const THINKING_BUDGET_PREFIXES = [
    ...SAMPLING_PARAMS_PREFIXES,
    'gemini-3-6-',
    'gemini-3-7-',
    'gemini-3-8-',
];

const isGemini = (model) => model.startsWith('gemini');

export function geminiAcceptsSamplingParams(model) {
    const normalized = normalizeModelName(model);
    if (!isGemini(normalized)) return true;
    return SAMPLING_PARAMS_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function geminiAcceptsThinkingBudget(model) {
    const normalized = normalizeModelName(model);
    if (!isGemini(normalized)) return true;
    return THINKING_BUDGET_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Gemini に送信する設定のうち、そのモデルで受理されると確認できない項目を除外する。
 * 入力とネストした thinkingConfig は変更しない。
 */
export function sanitizeGeminiGenerationConfig(model, generationConfig) {
    const config = { ...(generationConfig || {}) };

    if (!geminiAcceptsSamplingParams(model)) {
        delete config.temperature;
        delete config.topP;
        delete config.topK;
    }

    if (config.thinkingConfig && !geminiAcceptsThinkingBudget(model)) {
        const thinkingConfig = { ...config.thinkingConfig };
        delete thinkingConfig.thinkingBudget;
        if (Object.keys(thinkingConfig).length > 0) {
            config.thinkingConfig = thinkingConfig;
        } else {
            delete config.thinkingConfig;
        }
    }

    return config;
}
