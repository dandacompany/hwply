import { remove } from '@tauri-apps/plugin-fs';
import { showHwpSavePasswordDialog } from '@upstream/ui/hwp-password-dialog';
import { writeFileInChunks } from './chunked-fs';
import { readStableDocumentFile, type StableDocumentFile } from './document-files';
import {
  waitForDesktopStudioHandlers,
  type DesktopStudioHandlers,
} from '../embed/desktop-runtime';
import type { DesktopDocumentFormat } from './desktop-session';
import { resolveSaveDialogDefaultPath } from './save-dialog-default-path';

export type NativeInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export interface DesktopHostDependencies {
  invoke: NativeInvoke;
  chooseOpenPath(): Promise<string | null>;
  chooseDocumentSavePath(
    defaultPath: string,
    format: DesktopDocumentFormat,
  ): Promise<string | null>;
  choosePdfSavePath(defaultPath: string): Promise<string | null>;
  resolveSaveDefaultPath(fileName: string, sourcePath: string | null): Promise<string>;
  chooseDocumentSavePassword(fileName: string): Promise<string | null>;
  showMessage(message: string, options: Record<string, unknown>): Promise<string | boolean>;
  readDocument(path: string): Promise<StableDocumentFile>;
  writeDocument(path: string, bytes: Uint8Array): Promise<void>;
  removeFile(path: string): Promise<void>;
  handlers(): Promise<DesktopStudioHandlers>;
  /** 네이티브 창 제목. Tauri 는 document.title 을 창 제목에 반영하지 않는다. */
  setWindowTitle(title: string): Promise<void>;
  /** 이 창의 문서를 에이전트 브리지에 알린다. null 이면 창에 문서가 없다. */
  reportAgentDocument(doc: AgentDocumentReport | null): Promise<void>;
}

export interface AgentDocumentReport {
  docId: string;
  fileName: string;
  sourcePath: string | null;
  format: DesktopDocumentFormat;
  encrypted: boolean;
}

export function createDefaultDesktopHostDependencies(): DesktopHostDependencies {
  return {
    invoke: async (command, args = {}) => {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke(command, args);
    },
    setWindowTitle: async (title) => {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_window_title', { title });
    },
    reportAgentDocument: async (doc) => {
      const { invoke } = await import('@tauri-apps/api/core');
      if (doc) await invoke('agent_attach_document', { doc });
      else await invoke('agent_detach_document');
    },
    chooseOpenPath: async () => {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'HWP/HWPX 문서', extensions: ['hwp', 'hwpx'] }],
      });
      return typeof selected === 'string' ? selected : null;
    },
    chooseDocumentSavePath: async (defaultPath, format) => {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const label = format === 'hwpx' ? 'HWPX 문서' : 'HWP 문서';
      return save({ defaultPath, filters: [{ name: label, extensions: [format] }] });
    },
    choosePdfSavePath: async (defaultPath) => {
      const { save } = await import('@tauri-apps/plugin-dialog');
      return save({ defaultPath, filters: [{ name: 'PDF 문서', extensions: ['pdf'] }] });
    },
    resolveSaveDefaultPath: resolveSaveDialogDefaultPath,
    chooseDocumentSavePassword: showHwpSavePasswordDialog,
    showMessage: async (message, options) => {
      const dialog = await import('@tauri-apps/plugin-dialog');
      return dialog.message(message, options as never);
    },
    readDocument: readStableDocumentFile,
    writeDocument: writeFileInChunks,
    removeFile: (path) => remove(path),
    handlers: waitForDesktopStudioHandlers,
  };
}
