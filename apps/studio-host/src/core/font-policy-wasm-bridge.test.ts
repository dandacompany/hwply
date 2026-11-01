import { describe, expect, it, vi } from 'vitest';
import { WasmBridge } from './font-policy-wasm-bridge';

const findFont = vi.hoisted(() => vi.fn((_name: string) => 11));
const findFontForLang = vi.hoisted(() => vi.fn((_lang: number, _name: string) => 12));

vi.mock('@upstream/core/wasm-bridge', () => ({
  WasmBridge: class {
    findOrCreateFontId(name: string) {
      return findFont(name);
    }

    findOrCreateFontIdForLang(lang: number, name: string) {
      return findFontForLang(lang, name);
    }
  },
}));

describe('font policy WasmBridge leaf adapter', () => {
  it('sanitizes restricted authoring fonts without replacing the upstream bridge', () => {
    const bridge = new WasmBridge();

    expect(bridge.findOrCreateFontId('HY헤드라인M')).toBe(11);
    expect(bridge.findOrCreateFontIdForLang(2, '휴먼명조')).toBe(12);
    expect(findFont).toHaveBeenCalledWith('함초롬돋움');
    expect(findFontForLang).toHaveBeenCalledWith(2, '함초롬바탕');
  });
});
