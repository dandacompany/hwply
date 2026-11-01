import { normalizeFontEntries, type LocalFontEntry } from './local-font-records';
import { createLocalFontLookup, type LocalFontLookup } from './local-font-lookup';
import { subscribeFontPreferences } from './local-font-preferences';
import { resetDesktopFontProvider } from './local-font-provider';
import { HostFontSource } from './host-font-source';

const listeners = new Set<() => void>();
export const hostFontSource = new HostFontSource(invalidateFontCatalog);
export function onFontCatalogChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let entries: LocalFontEntry[] | null = null;
let lookup: LocalFontLookup | null = null;
let detectedAt: string | null = null;
let error: string | null = null;
let generation = 0;
let pending: Promise<LocalFontEntry[]> | null = null;

export function getFontCatalog() {
  return { entries, lookup, detectedAt, error, generation };
}

export function invalidateFontCatalog(): void {
  generation += 1;
  entries = null;
  lookup = null;
  detectedAt = null;
  error = null;
  pending = null;
  resetDesktopFontProvider();
  hostFontSource.reset();
  for (const listener of listeners) listener();
}

subscribeFontPreferences(invalidateFontCatalog);

export async function loadFontCatalog(
  loader: () => Promise<LocalFontEntry[]>, force = false,
): Promise<LocalFontEntry[]> {
  if (force) invalidateFontCatalog();
  if (entries) return entries;
  if (pending) return pending;
  if (error) throw new Error(error);
  const started = generation;
  const request = (async () => {
    try {
      const result = normalizeFontEntries(await loader());
      if (started !== generation) return [];
      const indexed = createLocalFontLookup(result);
      entries = result;
      lookup = indexed;
      detectedAt = new Date().toISOString();
      return result;
    } catch {
      if (started !== generation) return [];
      error = '로컬 글꼴 목록을 읽지 못했습니다. 설정에서 다시 감지할 수 있습니다.';
      throw new Error(error);
    }
  })();
  pending = request;
  try { return await request; } finally { if (pending === request) pending = null; }
}
