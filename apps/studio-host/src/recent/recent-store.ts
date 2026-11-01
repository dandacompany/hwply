import {
  addRecentDoc as addUpstreamRecentDoc,
  clearRecentDocs as clearUpstreamRecentDocs,
  listRecentDocs as listUpstreamRecentDocs,
  removeRecentDoc as removeUpstreamRecentDoc,
  type RecentDoc,
  type RecentDocInput,
} from '@upstream/recent/recent-store';
import { isTauriRuntime } from '../core/platform';

interface NativeRecentDocument {
  path: string;
  fileName: string;
}

const nativePathsById = new Map<string, string>();
let nativeListGeneration = 0;

export type { RecentDoc, RecentDocInput };

export async function addRecentDoc(input: RecentDocInput): Promise<void> {
  if (!isTauriRuntime()) return addUpstreamRecentDoc(input);
  // Native path opens are recorded only after the Studio load handler succeeds.
}

export async function listRecentDocs(): Promise<RecentDoc[]> {
  if (!isTauriRuntime()) return listUpstreamRecentDocs();
  const { invoke } = await import('@tauri-apps/api/core');
  const documents = await invoke<NativeRecentDocument[]>('list_recent_documents');
  nativePathsById.clear();
  nativeListGeneration += 1;
  const openedAt = Date.now();
  return documents.map((document, index) => {
    const id = `desktop-recent-${nativeListGeneration}-${index}`;
    nativePathsById.set(id, document.path);
    return {
      id,
      fileName: document.fileName,
      sourceFormat: sourceFormatFromName(document.fileName),
      openedAt: openedAt - index,
    };
  });
}

export async function removeRecentDoc(id: string): Promise<void> {
  if (!isTauriRuntime()) return removeUpstreamRecentDoc(id);
  const path = nativePathsById.get(id);
  if (!path) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('remove_recent_document', { path });
  nativePathsById.delete(id);
}

export async function clearRecentDocs(): Promise<void> {
  if (!isTauriRuntime()) return clearUpstreamRecentDocs();
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('clear_recent_documents');
  nativePathsById.clear();
}

export function resolveDesktopRecentPath(id: string): string | null {
  return nativePathsById.get(id) ?? null;
}

export function resetDesktopRecentPathsForTests(): void {
  nativePathsById.clear();
  nativeListGeneration = 0;
}

function sourceFormatFromName(fileName: string): 'hwp' | 'hwpx' {
  return fileName.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp';
}
