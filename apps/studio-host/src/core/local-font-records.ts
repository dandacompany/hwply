import type { HostFontReference } from './host-font-contract';
import {
  filterAuthoringFontFamilies,
  isAuthoringBlockedFontFamily,
} from './font-authoring-policy';

export interface LocalFontEntry {
  family: string;
  fullName?: string | null;
  aliases?: string[];
  postScriptName: string;
  style: string;
  weight?: number;
  slant?: 'normal' | 'italic' | 'oblique';
  hostReference?: HostFontReference;
  sourceKind: 'system-installed' | 'file-backed';
  path?: string | null;
}

export interface LocalFontRecord {
  sourceKey?: string;
  hostReference?: HostFontReference;
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  displayName: string;
  aliases: string[];
}

export function fontEntryKey(entry: LocalFontEntry): string {
  if (entry.hostReference) return entry.hostReference.key;
  return JSON.stringify([entry.path ?? null, entry.postScriptName, entry.style,
    entry.weight ?? null, entry.sourceKind, entry.path ? null : entry.family]);
}

export function normalizeFontEntries(entries: LocalFontEntry[]): LocalFontEntry[] {
  const grouped = new Map<string, LocalFontEntry>();
  for (const entry of entries) {
    const family = entry.family.trim();
    if (!family || isAuthoringBlockedFontFamily(family)
      || isAuthoringBlockedFontFamily(entry.postScriptName ?? family)
      || isAuthoringBlockedFontFamily(entry.fullName)) continue;
    const normalized = {
      ...entry, family, postScriptName: entry.postScriptName?.trim() || family,
      fullName: entry.fullName?.trim() || undefined,
      style: entry.style?.trim() || 'normal',
      sourceKind: entry.sourceKind ?? 'system-installed', path: entry.path ?? null,
    };
    const key = fontEntryKey(normalized);
    const previous = grouped.get(key);
    const aliases = [family, normalized.fullName, normalized.postScriptName,
      ...(entry.aliases ?? []), ...(previous?.aliases ?? [])]
      .filter((name): name is string => !!name && !isAuthoringBlockedFontFamily(name));
    grouped.set(key, { ...normalized, ...previous, aliases: [...new Set(aliases)] });
  }
  return [...grouped.values()].sort((left, right) =>
    left.family.localeCompare(right.family, 'ko')
    || left.style.localeCompare(right.style, 'en')
    || left.postScriptName.localeCompare(right.postScriptName, 'en'));
}

export function uniqueAuthoringFamilies(entries: LocalFontEntry[]): string[] {
  const families = filterAuthoringFontFamilies(entries.map((entry) => entry.family));
  return Array.from(new Set(families)).sort((a, b) => a.localeCompare(b, 'ko'));
}

export function toLocalFontRecord(entry: LocalFontEntry): LocalFontRecord {
  return {
    sourceKey: fontEntryKey(entry),
    ...(entry.hostReference ? { hostReference: entry.hostReference } : {}),
    family: entry.sourceKind === 'file-backed' && entry.path
      ? entry.fullName || entry.family : entry.family,
    fullName: entry.fullName || entry.postScriptName,
    postscriptName: entry.postScriptName,
    style: entry.style,
    displayName: entry.family,
    aliases: Array.from(new Set([entry.family, entry.fullName, entry.postScriptName,
      ...(entry.aliases ?? [])].filter((name): name is string => !!name))),
  };
}

export function normalizeFontName(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}
