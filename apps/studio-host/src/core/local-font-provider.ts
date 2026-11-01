import type { LocalFontEntry } from './local-font-records';

const faces = new Map<string, { face: FontFace; owner: FontFaceSet }>();
const registrations = new Map<string, Promise<void>>();
const binaryCache = new Map<string, Promise<Uint8Array>>();
const failedPaths = new Set<string>();
const suppliedPaths = new Set<string>();
let generation = 0;

export function desktopFontGeneration(): number { return generation; }
export function desktopFontUnavailable(path: string): boolean { return failedPaths.has(path); }
export function desktopFontSupplyState() {
  return { registered: faces.size, supplied: suppliedPaths.size, failed: failedPaths.size };
}

export async function listDesktopFontEntries(): Promise<LocalFontEntry[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LocalFontEntry[]>('list_local_fonts');
}

export async function readDesktopFontBytes(path: string): Promise<Uint8Array> {
  const started = generation;
  let pending = binaryCache.get(path);
  if (!pending) {
    pending = (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const bytes = new Uint8Array(await invoke<number[]>('read_local_font', { path }));
      if (!isSingleStaticFont(bytes)) throw new Error('unsupported font face');
      return bytes;
    })();
    binaryCache.set(path, pending);
  }
  try {
    const bytes = await pending;
    if (started !== generation) throw new Error('superseded font request');
    suppliedPaths.add(path);
    return bytes;
  } catch {
    if (started === generation) failedPaths.add(path);
    throw new Error('local font bytes unavailable');
  }
}

export async function ensureDesktopFontFace(entry: LocalFontEntry): Promise<void> {
  if (!entry.path) return;
  const key = entryKey(entry);
  if (faces.has(key)) return;
  let pending = registrations.get(key);
  if (!pending) {
    pending = registerFace(entry, key, generation);
    registrations.set(key, pending);
  }
  return pending;
}

async function registerFace(entry: LocalFontEntry, key: string, started: number): Promise<void> {
  try {
    const source = (await readDesktopFontBytes(entry.path!)).slice();
    if (started !== generation) return;
    const descriptors: FontFaceDescriptors = { style: entry.style || 'normal' };
    if (entry.weight) descriptors.weight = String(entry.weight);
    const face = await new FontFace(entry.family, source, descriptors).load();
    if (started !== generation) return;
    const owner = document.fonts;
    owner.add(face);
    faces.set(key, { face, owner });
  } catch {
    if (started === generation) failedPaths.add(entry.path!);
    throw new Error('local font registration unavailable');
  }
}

export function resetDesktopFontProvider(): void {
  generation += 1;
  for (const { face, owner } of faces.values()) owner.delete(face);
  faces.clear();
  registrations.clear();
  binaryCache.clear();
  failedPaths.clear();
  suppliedPaths.clear();
}

function entryKey(entry: LocalFontEntry): string {
  return [entry.family, entry.postScriptName, entry.style, entry.weight ?? '', entry.path ?? ''].join('\u0000');
}

// The catalog has no collection index or variation coordinates. Supply only a
// standalone static sfnt; leave other containers to explicit fallback.
function isSingleStaticFont(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0);
  if (signature !== 0x00010000 && signature !== 0x4f54544f) return false;
  const count = view.getUint16(4);
  if (12 + count * 16 > bytes.length) return false;
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(12 + index * 16) === 0x66766172) return false;
  }
  return true;
}
