import { isAuthoringBlockedFontFamily } from './font-authoring-policy';
import {
  desktopFontGeneration, desktopFontUnavailable,
  ensureDesktopFontFace,
  listDesktopFontEntries,
} from './local-font-provider';
import {
  normalizeFontName,
  uniqueAuthoringFamilies,
  type LocalFontEntry,
  type LocalFontRecord,
} from './local-font-records';
import { isTauriRuntime } from './platform';
import { ensureFontPreferences, getFontPreferences } from './local-font-preferences';
import { getFontCatalog, hostFontSource, invalidateFontCatalog, loadFontCatalog,
  onFontCatalogChanged } from './local-font-state';
import type { HostFontProvider } from './host-font-contract';
import { loadRendererLocalFont } from './local-font-renderer';
export { resolveRendererLocalFont, loadRendererLocalFont } from './local-font-renderer';
export type { HostFontProvider, LocalFontStyleRequest } from './host-font-contract';

export type { LocalFontEntry, LocalFontRecord } from './local-font-records';

interface BrowserFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

export type LocalFontDetectionSource = 'local-font-access' | 'font-presence-probe';

export interface LocalFontSnapshot {
  version: 2;
  detectedAt: string;
  families: string[];
  fontRecords: LocalFontRecord[];
  source: LocalFontDetectionSource;
}

export interface LocalFontState {
  supported: boolean;
  method: LocalFontDetectionSource | null;
  loaded: boolean;
  stored: boolean;
  source: LocalFontDetectionSource | null;
  complete: boolean;
  storage: 'none' | 'native-preference';
  count: number;
  checkedFamilies: string[];
  detectedAt: string | null;
  lastError: string | null;
}

export interface DetectLocalFontsOptions {
  force?: boolean;
  includeRegistered?: boolean;
  candidateFamilies?: readonly string[];
}

export interface GetLocalFontsOptions {
  includeRegistered?: boolean;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<BrowserFontData[]>;
  }
}

export function isLocalFontSupported(): boolean {
  return isTauriRuntime()
    || (typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function');
}

export function isLocalFontAccessSupported(): boolean {
  return isLocalFontSupported();
}

export function getLocalFontDetectionMethod(): LocalFontDetectionSource | null {
  return isLocalFontSupported() ? 'local-font-access' : null;
}

export async function detectLocalFontEntries(force = false): Promise<LocalFontEntry[]> {
  if (isTauriRuntime() && (await ensureFontPreferences()).choice !== 'enabled') return [];
  return loadFontCatalog(hasHostFontProvider() ? detectHostFontEntries
    : isTauriRuntime() ? listDesktopFontEntries : detectBrowserFontEntries, force);
}

export async function detectLocalFonts(
  options: DetectLocalFontsOptions = {},
): Promise<string[]> {
  const entries = await detectLocalFontEntries(options.force);
  return uniqueAuthoringFamilies(entries);
}

export function getLocalFonts(_options: GetLocalFontsOptions = {}): string[] {
  return [...new Set(getLocalFontRecords().map((record) => record.family))].sort((a, b) => a.localeCompare(b, 'ko'));
}

export function getDetectedLocalFonts(): string[] {
  return getLocalFonts({ includeRegistered: true });
}

export function getLocalFontRecords(
  _options: GetLocalFontsOptions = {},
): LocalFontRecord[] {
  return getFontCatalog().lookup?.records() ?? [];
}

export function resolveLocalFont(fontName: string): LocalFontRecord | null {
  if (isAuthoringBlockedFontFamily(fontName)) return null;
  return getFontCatalog().lookup?.resolve(fontName) ?? null;
}

export function localFontFaceKey(
  record: Pick<LocalFontRecord, 'family' | 'fullName' | 'postscriptName' | 'sourceKey' | 'hostReference'>,
): string {
  return record.hostReference?.key ?? record.sourceKey ?? normalizeFontName(record.postscriptName || record.fullName || record.family);
}

export async function loadLocalFontBytesFor(
  fontNames: readonly string[],
): Promise<Map<string, ArrayBuffer>> {
  const started = desktopFontGeneration();
  const result = new Map<string, ArrayBuffer>();
  for (const fontName of fontNames) {
    if (started !== desktopFontGeneration()) return new Map();
    const record = resolveLocalFont(fontName);
    if (!record) continue;
    const data = await loadRendererLocalFont(record);
    if (started !== desktopFontGeneration()) return new Map();
    if (data) result.set(localFontFaceKey(record), data.bytes);
  }
  return started === desktopFontGeneration() ? result : new Map();
}

export async function loadLocalFontBytes(fontName: string): Promise<ArrayBuffer | null> {
  const record = resolveLocalFont(fontName);
  if (!record) return null;
  return (await loadLocalFontBytesFor([fontName])).get(localFontFaceKey(record)) ?? null;
}

export async function loadStoredLocalFonts(): Promise<LocalFontSnapshot | null> {
  if (isTauriRuntime()) {
    try { await detectLocalFontEntries(); } catch { /* State carries a safe retry message. */ }
  }
  return currentSnapshot();
}

export async function clearStoredLocalFonts(): Promise<void> {
  invalidateFontCatalog();
}

export function getLocalFontState(): LocalFontState {
  const snapshot = currentSnapshot();
  const preference = getFontPreferences();
  const native = isTauriRuntime();
  return {
    supported: isLocalFontSupported(),
    method: getLocalFontDetectionMethod(),
    loaded: snapshot !== null,
    stored: native ? preference.persisted : snapshot !== null,
    source: snapshot?.source ?? null,
    complete: snapshot !== null,
    storage: native && preference.persisted ? 'native-preference' : 'none',
    count: snapshot?.families.length ?? 0,
    checkedFamilies: snapshot?.families ?? [],
    detectedAt: snapshot?.detectedAt ?? null,
    lastError: preference.error || getFontCatalog().error,
  };
}

export function resetLocalFontsForTests(): void {
  invalidateFontCatalog();
}

export async function ensureLocalFontsAvailable(targetFamilies?: Iterable<string>): Promise<Set<string>> {
  const started = desktopFontGeneration();
  const entries = await detectLocalFontEntries();
  if (started !== desktopFontGeneration()) return new Set();
  const available = new Set(
    entries
      .filter((entry) => entry.sourceKind === 'system-installed')
      .filter((entry) => !isAuthoringBlockedFontFamily(entry.family))
      .map((entry) => entry.family),
  );
  if (!isTauriRuntime() || !supportsBinaryFontLoading()) return available;
  const requestedNames = targetFamilies ?? getLocalFontRecords().map(record => record.fullName);
  for (const requested of requestedNames) {
    const record = resolveLocalFont(requested);
    if (!record) continue;
    const entry = getFontCatalog().lookup?.entryFor(record.sourceKey);
    if (entry?.sourceKind !== 'file-backed' || !entry.path) continue;
    try {
      for (const family of new Set([record.family, requested])) {
        await ensureDesktopFontFace({ ...entry, family });
        if (started !== desktopFontGeneration()) return new Set();
      }
      if (!desktopFontUnavailable(entry.path)) available.add(record.family);
    } catch {
      // File-backed fonts are best-effort; substitute fallback remains available.
    }
  }

  return started === desktopFontGeneration() ? available : new Set();
}

async function detectBrowserFontEntries(): Promise<LocalFontEntry[]> {
  if (typeof window === 'undefined' || typeof window.queryLocalFonts !== 'function') {
    return [];
  }

  const fontDataList = await window.queryLocalFonts();
  return fontDataList.map((font) => ({
    family: font.family,
    fullName: font.fullName,
    aliases: [font.family, font.fullName, font.postscriptName],
    postScriptName: font.postscriptName,
    style: font.style || 'normal',
    sourceKind: 'system-installed',
  }));
}

function currentSnapshot(): LocalFontSnapshot | null {
  const { entries, detectedAt } = getFontCatalog();
  if (!entries) return null;
  const fontRecords = getLocalFontRecords({ includeRegistered: true });
  return {
    version: 2,
    detectedAt: detectedAt ?? new Date().toISOString(),
    families: uniqueAuthoringFamilies(entries),
    fontRecords,
    source: 'local-font-access',
  };
}

function supportsBinaryFontLoading(): boolean {
  return typeof document !== 'undefined'
    && !!document.fonts
    && typeof FontFace === 'function';
}

export function hasHostFontProvider(): boolean {
  return hostFontSource.active && (!isTauriRuntime() || getFontPreferences().choice === 'enabled');
}
export function onHostFontsChanged(listener: () => void): () => void {
  return onFontCatalogChanged(listener);
}
export async function setHostFontProvider(provider: HostFontProvider | null): Promise<void> {
  hostFontSource.setProvider(provider);
  await prepareHostFontCatalog();
}
export async function prepareHostFontCatalog(): Promise<void> {
  await detectLocalFontEntries();
}
export function getHostFontState() {
  const catalog = getFontCatalog();
  return { active: hasHostFontProvider(), generation: catalog.generation,
    count: catalog.entries?.length ?? 0, lastError: hostFontSource.lastError ?? catalog.error };
}
async function detectHostFontEntries(): Promise<LocalFontEntry[]> {
  return (await hostFontSource.references()).map(ref => ({
    family: ref.face.family, fullName: ref.face.fullName, postScriptName: ref.face.postscriptName,
    style: ref.face.style, aliases: [`${ref.face.family} ${ref.face.style}`, ...(ref.face.aliases ?? [])], weight: ref.face.weight,
    slant: ref.face.slant, hostReference: ref, sourceKind: 'system-installed',
  }));
}
