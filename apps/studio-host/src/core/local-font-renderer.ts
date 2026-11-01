import { isAuthoringBlockedFontFamily } from './font-authoring-policy';
import { desktopFontGeneration, readDesktopFontBytes } from './local-font-provider';
import { getFontCatalog, hostFontSource } from './local-font-state';
import type { LocalFontRecord } from './local-font-records';
import type { HostFontData, LocalFontStyleRequest } from './host-font-contract';

export function resolveRendererLocalFont(name: string, style?: LocalFontStyleRequest): LocalFontRecord | null {
  if (isAuthoringBlockedFontFamily(name)) return null;
  return getFontCatalog().lookup?.resolve(name, style) ?? null;
}

export async function loadRendererLocalFont(record: LocalFontRecord): Promise<HostFontData | null> {
  const catalog = getFontCatalog();
  const entry = catalog.lookup?.entryFor(record.sourceKey);
  if (!entry || isAuthoringBlockedFontFamily(record.family)) return null;
  if (entry.hostReference) return hostFontSource.read(entry.hostReference);
  if (!entry.path) return null;
  const started = desktopFontGeneration();
  try {
    const bytes = await readDesktopFontBytes(entry.path);
    if (started !== desktopFontGeneration() || catalog.generation !== getFontCatalog().generation) return null;
    return { bytes: bytes.slice().buffer as ArrayBuffer, faceIndex: 0 };
  } catch { return null; }
}
