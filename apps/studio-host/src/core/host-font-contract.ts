/** Structural rhwp v0.8.7 host protocol, owned at the product font boundary. */
export interface HostFontFace {
  id: string;
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  aliases?: readonly string[];
  weight?: number;
  slant?: 'normal' | 'italic' | 'oblique';
}
export interface HostFontSnapshot { revision: string; faces: readonly HostFontFace[] }
export interface HostFontData { bytes: ArrayBuffer; faceIndex?: number }
export interface HostFontProvider {
  getSnapshot(signal: AbortSignal): Promise<HostFontSnapshot>;
  readFace(id: string, revision: string, signal: AbortSignal): Promise<HostFontData>;
  subscribe(onChange: () => void): () => void;
}
export interface HostFontReference {
  readonly key: string;
  readonly face: Readonly<HostFontFace>;
  readonly revision: string;
  readonly generation: number;
}
export interface LocalFontStyleRequest {
  weight: number;
  slant: 'normal' | 'italic' | 'oblique';
}

function name(value: unknown, empty = false): value is string {
  return typeof value === 'string' && value.length <= 1024 && (empty || !!value.trim());
}

export function copyHostSnapshot(value: HostFontSnapshot): HostFontSnapshot {
  if (!value || !name(value.revision) || !Array.isArray(value.faces) || value.faces.length > 25_000) {
    throw new Error('Invalid host font snapshot');
  }
  const ids = new Set<string>();
  const faces = value.faces.map(face => {
    if (!face || !name(face.id) || ids.has(face.id) || !name(face.family) || !name(face.fullName)
      || !name(face.postscriptName, true) || !name(face.style, true)
      || (face.weight !== undefined && (!Number.isFinite(face.weight) || face.weight < 1 || face.weight > 1000))
      || (face.slant !== undefined && !['normal', 'italic', 'oblique'].includes(face.slant))
      || (face.aliases !== undefined && (!Array.isArray(face.aliases) || face.aliases.length > 32
        || !face.aliases.every((alias: unknown) => name(alias))))) throw new Error('Invalid host font face');
    ids.add(face.id);
    return Object.freeze({ id: face.id, family: face.family, fullName: face.fullName,
      postscriptName: face.postscriptName, style: face.style, weight: face.weight, slant: face.slant,
      aliases: Object.freeze([...(face.aliases ?? [])]) });
  });
  return Object.freeze({ revision: value.revision, faces: Object.freeze(faces) });
}
