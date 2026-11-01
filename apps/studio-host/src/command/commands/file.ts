import {
  confirmSaveBeforeReplacingDocument as confirmUpstreamReplacement,
  fileCommands as upstreamFileCommands,
} from '@upstream/command/commands/file';
import type { CommandDef, CommandServices } from '@upstream/command/types';
import { printDirectlyFromPageSurface } from '../direct-print';
import { getDesktopHost } from '../../core/desktop-host';
import { isTauriRuntime } from '../../core/platform';
import { resolveDesktopRecentPath } from '../../recent/recent-store';

const upstreamById = new Map(upstreamFileCommands.map((command) => [command.id, command]));

export async function confirmSaveBeforeReplacingDocument(
  ...args: Parameters<typeof confirmUpstreamReplacement>
): Promise<boolean> {
  const [services] = args;
  if (!isTauriRuntime() || !getDesktopHost().activeSession) {
    return confirmUpstreamReplacement(...args);
  }
  try {
    return await getDesktopHost().confirmDocumentReplacement(services);
  } catch (error) {
    reportDesktopError('저장 확인', error);
    return false;
  }
}

const desktopExecutors = new Map<string, CommandDef['execute']>([
  ['file:new-doc', async (services) => {
    await getDesktopHost().beginNewDocument(services);
  }],
  ['file:open', async () => {
    await runDesktopAction('파일 열기', () => getDesktopHost().openDocumentFromDialog());
  }],
  ['file:open-recent', async (_services, params) => {
    const id = typeof params?.id === 'string' ? params.id : '';
    const path = resolveDesktopRecentPath(id);
    if (!path) {
      setStatus('최근 문서 정보를 찾을 수 없습니다');
      return;
    }
    await runDesktopAction('최근 문서 열기', () => getDesktopHost().openDocumentByPath(path));
  }],
  ['file:save', async () => {
    await runDesktopAction('저장', () => getDesktopHost().saveCurrent());
  }],
  ['file:save-as', async () => {
    await runDesktopAction('다른 이름으로 저장', () => getDesktopHost().saveCurrent(undefined, true));
  }],
  ['file:save-as-hwp', async () => {
    await runDesktopAction('HWP 형식으로 저장', () => getDesktopHost().saveCurrent('hwp', true));
  }],
  ['file:save-as-hwpx', async () => {
    await runDesktopAction('HWPX 형식으로 저장', () => getDesktopHost().saveCurrent('hwpx', true));
  }],
  ['file:print-to-pdf', async () => {
    await runDesktopAction('PDF 저장', () => getDesktopHost().exportCurrentPdf());
  }],
  ['file:print', async (services) => {
    await runDesktopAction(
      '인쇄',
      () => printDirectlyFromPageSurface(services),
      'restore',
    );
  }],
]);

export const fileCommands: CommandDef[] = [
  ...upstreamFileCommands.map((command) => {
    const desktopExecute = desktopExecutors.get(command.id);
    if (!desktopExecute) return command;
    return {
      ...command,
      execute(services: CommandServices, params?: Record<string, unknown>) {
        if (!isTauriRuntime()) return command.execute(services, params);
        return desktopExecute(services, params);
      },
    };
  }),
  {
    id: 'file:new-window',
    label: '새 창',
    shortcutLabel: 'Ctrl+Shift+N',
    async execute() {
      await runDesktopAction('새 창', () => getDesktopHost().createNewWindow());
    },
  },
];

type CompletionStatus = 'complete' | 'restore';

async function runDesktopAction<T>(
  label: string,
  action: () => Promise<T>,
  completionStatus: CompletionStatus = 'complete',
): Promise<T | null> {
  const originalStatus = readStatus();
  try {
    setStatus(`${label} 중...`);
    const result = await action();
    if (result === null) {
      setStatus(originalStatus);
    } else {
      setStatus(completionStatus === 'restore' ? originalStatus : `${label} 완료`);
    }
    return result;
  } catch (error) {
    reportDesktopError(label, error);
    return null;
  }
}

function readStatus(): string {
  const status = typeof document === 'undefined' ? null : document.getElementById('sb-message');
  return status?.textContent || '';
}

function setStatus(message: string): void {
  const status = typeof document === 'undefined' ? null : document.getElementById('sb-message');
  if (status) status.textContent = message;
}

function reportDesktopError(label: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(`${label} 실패: ${message}`);
  if (typeof alert === 'function') alert(`${label}에 실패했습니다:\n${message}`);
}
