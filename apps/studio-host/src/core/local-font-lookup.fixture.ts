import type { LocalFontEntry } from './local-font-records';

/** Synthetic names and paths only; never enumerate the host's installed fonts. */
export function lookupFont(index: number, overrides: Partial<LocalFontEntry> = {}): LocalFontEntry {
  const pair = Math.floor(index / 2);
  const style = index % 2 === 0 ? 'Regular' : 'Bold';
  return {
    family: `Lookup Family ${pair}`,
    fullName: `Lookup Family ${pair} ${style}`,
    postScriptName: `Lookup${pair}-${style}`,
    aliases: [`조회 글꼴 ${pair}`, `조회 글꼴 ${pair} ${style}`],
    style: 'normal',
    weight: index % 2 === 0 ? 400 : 700,
    sourceKind: 'file-backed',
    path: `/synthetic-fonts/lookup-${index}.ttf`,
    ...overrides,
  };
}

export function lookupCatalog(size: number): LocalFontEntry[] {
  return Array.from({ length: size }, (_, index) => lookupFont(index));
}

export const lookupEnabledPreference = {
  choice: 'enabled' as const, persisted: true, revision: 1,
  promptDismissed: false, error: null,
};
