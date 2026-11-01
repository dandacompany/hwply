import type { CommandDispatcher } from '@upstream/command/dispatcher';
import type { DesktopHost } from './desktop-host';
import { findLatestSupportedDocumentPath, hasSupportedDocumentPath } from './document-files';
import { ensureDesktopUpdater } from './desktop-updater';
import { detectDesktopPlatform, isTauriRuntime } from './platform';
import { installWindowsWheelZoomReroute } from './windows-wheel-zoom';
import type { AgentRequest } from '../agent/agent-adapter';

type DesktopEventHost = Pick<
  DesktopHost,
  | 'openDocumentByPath'
  | 'takePendingOpenPaths'
  | 'confirmWindowClose'
  | 'destroyCurrentWindow'
>;

/** 에이전트 브리지 쪽 창 구성원(`src/agent/agent-bridge.ts`). */
export interface DesktopAgentPort {
  handle(request: AgentRequest): Promise<void>;
  /** Rust 가 `hwply new` 로 이 창을 만들었는지(한 번만 true). */
  takeNewDocumentRequest(): Promise<boolean>;
  createNewDocument(): Promise<void>;
}

interface DesktopEventsOptions {
  host: DesktopEventHost;
  dispatcher: Pick<CommandDispatcher, 'dispatch'>;
  setMessage(message: string): void;
  agent?: DesktopAgentPort;
}

interface CloseRequestEvent {
  preventDefault(): void;
}

type Disposer = () => void;
type TauriListen = typeof import('@tauri-apps/api/event').listen;
type CurrentWebviewWindow = ReturnType<
  typeof import('@tauri-apps/api/webviewWindow').getCurrentWebviewWindow
>;

export async function setupDesktopEvents({
  host,
  dispatcher,
  setMessage,
  agent,
}: DesktopEventsOptions, signal?: AbortSignal): Promise<Disposer> {
  if (!isTauriRuntime()) return () => {};
  await ensureDesktopUpdater(setMessage).catch((error) => {
    console.error('[desktop-updater] setup failed:', error);
  });
  const { listen } = await import('@tauri-apps/api/event');
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const currentWindow = getCurrentWebviewWindow();
  const disposers = new DisposerStack(signal);

  try {
    disposers.throwIfDisposed();
    disposers.add(() => setDesktopDragActive(false));
    if (detectDesktopPlatform() === 'windows') {
      disposers.add(installWindowsWheelZoomReroute());
    }
    await registerDesktopListeners(disposers, listen, currentWindow, {
      host,
      dispatcher,
      setMessage,
      agent,
    });

    disposers.throwIfDisposed();
    const pending = await host.takePendingOpenPaths();
    await openLatestDesktopDocument(host, pending, setMessage);
    disposers.throwIfDisposed();
    if (agent && pending.length === 0 && await agent.takeNewDocumentRequest()) {
      await agent.createNewDocument();
    }
    return () => disposers.dispose();
  } catch (error) {
    disposers.dispose();
    throw error;
  }
}

async function registerDesktopListeners(
  disposers: DisposerStack,
  listen: TauriListen,
  currentWindow: CurrentWebviewWindow,
  { host, dispatcher, setMessage, agent }: DesktopEventsOptions,
): Promise<void> {
  await Promise.all([
    ...(agent
      ? [disposers.track(currentWindow.listen('hwply-agent-request', (event) => {
        void agent.handle(event.payload as AgentRequest);
      }))]
      : []),
    disposers.track(listen('hwply-job-progress', (event) => {
      const payload = event.payload as { message?: string };
      if (payload?.message) setMessage(payload.message);
    })),
    disposers.track(currentWindow.listen('hwply-menu-command', (event) => {
      const command = String(event.payload || '');
      if (command) dispatcher.dispatch(command);
    })),
    disposers.track(currentWindow.listen('hwply-open-paths', async (event) => {
      const payload = event.payload as { paths?: string[] };
      const pending = await host.takePendingOpenPaths();
      await openLatestDesktopDocument(host, [...(payload.paths ?? []), ...pending], setMessage);
    })),
    disposers.track(currentWindow.listen('tauri://drag-enter', (event) => {
      const payload = event.payload as { paths?: string[] };
      if (!hasSupportedDocumentPath(payload.paths ?? [])) return;
      setDesktopDragActive(true);
      setMessage('HWP/HWPX 파일을 놓으면 문서를 엽니다');
    })),
    disposers.track(currentWindow.listen('tauri://drag-leave', () => {
      setDesktopDragActive(false);
    })),
    disposers.track(currentWindow.listen('tauri://drag-drop', () => {
      setDesktopDragActive(false);
    })),
    disposers.track(currentWindow.onCloseRequested(async (event) => {
      await handleDesktopCloseRequest(event, host, setMessage);
    })),
  ]);
}

async function handleDesktopCloseRequest(
  event: CloseRequestEvent,
  host: DesktopEventHost,
  setMessage: (message: string) => void,
): Promise<void> {
  event.preventDefault();
  try {
    if (await host.confirmWindowClose()) await host.destroyCurrentWindow();
  } catch (error) {
    console.error('[desktop-events] close request failed:', error);
    setMessage(`창 닫기 실패: ${error}`);
  }
}

function setDesktopDragActive(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.getElementById('scroll-container')?.classList.toggle('drag-over', active);
}

class DisposerStack {
  private readonly disposers: Disposer[] = [];
  private disposed = false;

  constructor(private readonly signal?: AbortSignal) {
    signal?.addEventListener('abort', this.handleAbort, { once: true });
    if (signal?.aborted) this.dispose();
  }

  add(disposer: Disposer): void {
    if (!this.disposed) {
      this.disposers.push(disposer);
      return;
    }
    runDisposer(disposer);
  }

  async track(pendingDisposer: Promise<Disposer>): Promise<void> {
    const disposer = await pendingDisposer;
    if (this.disposed) {
      runDisposer(disposer);
      throw setupAbortedError();
    }
    this.disposers.push(disposer);
  }

  throwIfDisposed(): void {
    if (this.disposed) throw setupAbortedError();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.signal?.removeEventListener('abort', this.handleAbort);
    while (this.disposers.length > 0) runDisposer(this.disposers.pop()!);
  }

  private readonly handleAbort = () => this.dispose();
}

function runDisposer(disposer: Disposer): void {
  try {
    disposer();
  } catch (error) {
    console.warn('[desktop-events] cleanup failed:', error);
  }
}

function setupAbortedError(): Error {
  const error = new Error('desktop event setup aborted');
  error.name = 'AbortError';
  return error;
}

async function openLatestDesktopDocument(
  host: DesktopEventHost,
  paths: string[],
  setMessage: (message: string) => void,
): Promise<void> {
  const path = findLatestSupportedDocumentPath(Array.from(new Set(paths)));
  if (!path) {
    if (paths.length > 0) setMessage('HWP/HWPX 파일만 열 수 있습니다');
    return;
  }
  try {
    setMessage('파일 로딩 중...');
    const loaded = await host.openDocumentByPath(path);
    if (loaded) setMessage(`${loaded.fileName} — ${loaded.pageCount}페이지`);
  } catch (error) {
    setMessage(`파일 로드 실패: ${error}`);
    console.error('[desktop-events] 데스크톱 파일 로드 실패:', error);
  }
}
