import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OPENROUTER_PRESETS } from '../src/constants.js';

const read = (p) => readFileSync(resolve(p), 'utf8');

// OpenRouter のプリセットは「仮想モデル」で、model フィールドに "@preset/<slug>" を
// そのまま送るだけでよい（アカウント限定のため /v1/models の公開一覧には出てこない）。
// そのためアプリ側からは「選択肢として見える」ことが要件になる。
describe('OpenRouter presets (@preset/<slug>)', () => {
    it('declares preset ids in the @preset/<slug> shape', () => {
        expect(OPENROUTER_PRESETS.length).toBeGreaterThan(0);
        OPENROUTER_PRESETS.forEach((preset) => {
            expect(preset.value.startsWith('@preset/')).toBe(true);
            expect(typeof preset.label).toBe('string');
            expect(preset.label.length).toBeGreaterThan(0);
        });
        expect(OPENROUTER_PRESETS.some((p) => p.value === '@preset/argon-flex')).toBe(true);
    });

    it('surfaces presets in the custom-model dropdown (header model select mirrors it)', () => {
        const app = read('src/app.js');
        expect(app).toContain("import { OPENROUTER_PRESETS } from './constants.js'");
        expect(app).toContain('OPENROUTER_PRESETS.forEach');
        expect(app).toContain("opt.dataset.provider = 'openrouter'");
        expect(app).toContain("opt.dataset.userDefined = 'true'");
    });

    it('surfaces presets in the OpenRouter model-name input datalist', () => {
        const lifecycle = read('src/app-logic/lifecycle.js');
        expect(lifecycle).toContain('OPENROUTER_PRESETS.forEach');
    });

    it('sends the preset id verbatim (no model-name rewriting on the wire)', () => {
        const api = read('src/api.js');
        expect(api).toContain('const model = state.settings.modelName || cfg.defaultModel;');
        expect(api).toContain('model: model,');
    });
});
