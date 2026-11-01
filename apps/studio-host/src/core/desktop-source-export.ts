import {
  exportDocumentWithReportForFormat,
  exportPasswordProtectedDocumentWithReportForFormat,
  type SaveExportArtifact,
} from '@upstream/command/save-document-format';
import { fileNameForFormat } from '@upstream/command/save-target';
import type { CommandServices } from '@upstream/command/types';
import type { DesktopDocumentFormat } from './desktop-session';

export interface DesktopSourceExport {
  artifact: SaveExportArtifact;
  passwordProtected: boolean;
}

export type DesktopSavePasswordPrompt = (fileName: string) => Promise<string | null>;

/** 암호 열기 여부를 native host 저장 상태로 승계한다. 암호 문자열은 보관하지 않는다. */
export function syncDesktopPasswordRequirement(services: CommandServices): void {
  services.wasm.requiresPasswordForSave = services.wasm.getDocumentInfo().encrypted;
}

/**
 * native 원자 저장에서 upstream 명시 저장 serializer와 내용 손실 보고를 사용한다.
 * 암호 문서는 매 저장마다 새 암호를 입력받고 지역 참조를 시도 직후 비운다.
 */
export async function exportDesktopSource(
  services: CommandServices,
  format: DesktopDocumentFormat,
  promptPassword: DesktopSavePasswordPrompt,
): Promise<DesktopSourceExport | null> {
  flushDeferredPagination(services);
  let password: string | null = null;
  try {
    const passwordRequired = services.wasm.requiresPasswordForSave
      || services.wasm.getDocumentInfo().encrypted;
    if (passwordRequired) {
      password = await promptPassword(fileNameForFormat(services.wasm.fileName, format));
      if (password === null) return null;
    }

    const artifact = password === null
      ? exportDocumentWithReportForFormat(services.wasm, format)
      : exportPasswordProtectedDocumentWithReportForFormat(
        services.wasm,
        format,
        password,
      );
    return { artifact, passwordProtected: password !== null };
  } finally {
    password = '';
  }
}

function flushDeferredPagination(services: CommandServices): void {
  const inputHandler = services.getInputHandler();
  if (!inputHandler) return;
  inputHandler.flushDeferredPaginationIfNeeded('native-save');
  if (inputHandler.hasDeferredPaginationPending()) {
    throw new Error('저장 전 페이지네이션을 완료하지 못했습니다 (native-save)');
  }
}
