import { WasmBridge as UpstreamWasmBridge } from '@upstream/core/wasm-bridge';
import { sanitizeAuthoringFontFamily } from './font-authoring-policy';

export * from '@upstream/core/wasm-bridge';

export class WasmBridge extends UpstreamWasmBridge {
  override findOrCreateFontId(name: string): number {
    return super.findOrCreateFontId(sanitizeAuthoringFontFamily(name));
  }

  override findOrCreateFontIdForLang(lang: number, name: string): number {
    return super.findOrCreateFontIdForLang(lang, sanitizeAuthoringFontFamily(name));
  }
}
