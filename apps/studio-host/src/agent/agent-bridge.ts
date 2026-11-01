import type { CommandServices } from '@upstream/command/types';
import type { DesktopHost } from '../core/desktop-host';
import type { DesktopAgentPort } from '../core/desktop-events';
import { writeFileInChunks } from '../core/chunked-fs';
import { readStableDocumentFile } from '../core/document-files';
import { waitForDesktopStudioHandlers } from '../embed/desktop-runtime';
import { AgentAdapter, type AgentActivityEvent } from './agent-adapter';
import { AgentSnapshots } from './agent-snapshots';
import { AgentActivity } from '../ui/agent-activity';
import { detectDesktopPlatform } from '../core/platform';

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

export interface DesktopAgent {
  port: DesktopAgentPort;
  adapter: AgentAdapter;
  snapshots: AgentSnapshots;
}

/** 이 창의 에이전트 어댑터를 실제 Tauri·Studio 조각으로 만든다. */
export function createDesktopAgent(
  host: DesktopHost,
  services: CommandServices,
  onActivity: (event: AgentActivityEvent) => void,
): DesktopAgent {
  const snapshots = new AgentSnapshots();
  const adapter = new AgentAdapter({
    handlers: waitForDesktopStudioHandlers,
    wasm: () => services.wasm as never,
    host,
    readFile: async (path) => (await readStableDocumentFile(path)).bytes,
    writeFile: writeFileInChunks,
    respond: (requestId, reply) => invoke('agent_respond', {
      requestId,
      result: reply.result ?? null,
      error: reply.error ?? null,
    }),
    snapshots,
    notify: onActivity,
    confirm: async (message) => {
      const { ask } = await import('@tauri-apps/plugin-dialog');
      return ask(message, { title: '에이전트 변경 되돌리기', kind: 'warning', okLabel: '되돌리기', cancelLabel: '취소' });
    },
  });
  const port: DesktopAgentPort = {
    handle: (request) => adapter.handle(request),
    takeNewDocumentRequest: () => invoke<boolean>('agent_take_new_document_request'),
    createNewDocument: async () => {
      await host.beginNewDocument(services);
    },
  };
  return { port, adapter, snapshots };
}

/** 창 하나의 에이전트 연결: 어댑터 + 변경 배지·토스트. 저장하면 배지를 초기화한다. */
export function installDesktopAgent(
  host: DesktopHost,
  services: CommandServices,
  setMessage: (message: string) => void,
): DesktopAgent & { dispose(): void } {
  let activity: AgentActivity | null = null;
  const agent = createDesktopAgent(host, services, (event) => activity?.record(event));
  activity = new AgentActivity(
    document.body,
    () => agent.adapter.restoreLatest().catch((error) => {
      setMessage(`에이전트 변경 되돌리기 실패: ${error instanceof Error ? error.message : error}`);
    }),
    detectDesktopPlatform() === 'windows' ? 'windows' : 'macos',
  );
  const removeSaved = host.onSaved(() => activity?.resetCount());
  return { ...agent, dispose: removeSaved };
}
