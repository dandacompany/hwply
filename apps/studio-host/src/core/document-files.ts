export function isSupportedDocumentPath(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.endsWith('.hwp') || lower.endsWith('.hwpx');
}

export function hasSupportedDocumentPath(paths: string[]): boolean {
  return paths.some(isSupportedDocumentPath);
}

export function findLatestSupportedDocumentPath(paths: string[]): string | null {
  return [...paths].reverse().find(isSupportedDocumentPath) ?? null;
}

export async function readStableDocumentFile(path: string): Promise<StableDocumentFile> {
  const before = await stat(path);
  const { bytes, contentHash } = await readFileInChunks(path, finiteFileSize(before.size));
  const after = await stat(path);
  const beforeFingerprint = statFingerprint(before);
  const afterFingerprint = statFingerprint(after);
  if (
    beforeFingerprint
    && afterFingerprint
    && (
      beforeFingerprint.len !== afterFingerprint.len
      || beforeFingerprint.modifiedMillis !== afterFingerprint.modifiedMillis
    )
  ) {
    throw new Error('파일을 읽는 중 변경되었습니다. 다시 시도하세요.');
  }
  return {
    bytes,
    sourceFingerprint: afterFingerprint ? { ...afterFingerprint, contentHash } : undefined,
  };
}

function statFingerprint(
  info: Partial<{ size: number; mtime: Date | null }>,
): Omit<SourceFingerprint, 'contentHash'> | undefined {
  const len = finiteFileSize(info.size);
  const modifiedMillis = info.mtime instanceof Date ? info.mtime.getTime() : undefined;
  return len === undefined || modifiedMillis === undefined || !Number.isFinite(modifiedMillis)
    ? undefined
    : { len, modifiedMillis };
}
import { stat } from '@tauri-apps/plugin-fs';
import { finiteFileSize, readFileInChunks } from './chunked-fs';

export interface SourceFingerprint {
  len: number;
  modifiedMillis: number;
  contentHash: number;
}

export interface StableDocumentFile {
  bytes: Uint8Array;
  sourceFingerprint?: SourceFingerprint;
}
