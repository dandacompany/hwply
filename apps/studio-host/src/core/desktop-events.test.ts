import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDesktopEvents } from './desktop-events';

const tauriListen = vi.hoisted(() => vi.fn());
const ensureDesktopUpdater = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const currentWindow = vi.hoisted(() => ({
  listen: vi.fn(),
  onCloseRequested: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: tauriListen }));
vi.mock('./desktop-updater', () => ({ ensureDesktopUpdater }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => currentWindow,
}));

describe('desktop events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { navigator?: unknown }).navigator;
  });

  it('does nothing outside the Tauri runtime', async () => {
    const dispose = await setupDesktopEvents(options());
    dispose();

    expect(tauriListen).not.toHaveBeenCalled();
    expect(ensureDesktopUpdater).not.toHaveBeenCalled();
    expect(currentWindow.listen).not.toHaveBeenCalled();
  });

  it('deduplicates event and pending paths before loading the latest document once', async () => {
    const { windowHandlers } = installTauriEnvironment();
    const host = createHost({
      takePendingOpenPaths: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
        '/documents/latest.HWPX',
      ]),
      openDocumentByPath: vi.fn().mockResolvedValue({
        fileName: 'latest.HWPX',
        pageCount: 3,
      }),
    });
    const setMessage = vi.fn();
    const dispose = await setupDesktopEvents(options({ host, setMessage }));

    expect(ensureDesktopUpdater).toHaveBeenCalledWith(setMessage);

    await windowHandlers.get('hwply-open-paths')?.({
      payload: { paths: ['/documents/older.hwp', '/documents/latest.HWPX'] },
    });

    expect(host.openDocumentByPath).toHaveBeenCalledTimes(1);
    expect(host.openDocumentByPath).toHaveBeenCalledWith('/documents/latest.HWPX');
    expect(setMessage).toHaveBeenLastCalledWith('latest.HWPX — 3페이지');
    dispose();
  });

  it('reports unsupported paths without opening a document', async () => {
    const { windowHandlers } = installTauriEnvironment();
    const host = createHost();
    const setMessage = vi.fn();
    const dispose = await setupDesktopEvents(options({ host, setMessage }));

    await windowHandlers.get('hwply-open-paths')?.({ payload: { paths: ['notes.txt'] } });

    expect(host.openDocumentByPath).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith('HWP/HWPX 파일만 열 수 있습니다');
    dispose();
  });

  it('routes agent bridge requests to the agent port', async () => {
    const { windowHandlers } = installTauriEnvironment();
    const agent = {
      handle: vi.fn().mockResolvedValue(undefined),
      takeNewDocumentRequest: vi.fn().mockResolvedValue(false),
      createNewDocument: vi.fn(),
    };
    const dispose = await setupDesktopEvents(options({ agent }));
    const request = { requestId: 'r1', method: 'state', params: {} };
    await windowHandlers.get('hwply-agent-request')?.({ payload: request });
    expect(agent.handle).toHaveBeenCalledWith(request);
    expect(agent.createNewDocument).not.toHaveBeenCalled();
    dispose();
  });

  it('creates a blank document when the bridge asked for one and nothing is pending', async () => {
    installTauriEnvironment();
    const agent = {
      handle: vi.fn(),
      takeNewDocumentRequest: vi.fn().mockResolvedValue(true),
      createNewDocument: vi.fn().mockResolvedValue(undefined),
    };
    const dispose = await setupDesktopEvents(options({ agent }));
    expect(agent.createNewDocument).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('routes native menu, drag state, and close through shared adapters', async () => {
    const { windowHandlers, getCloseHandler } = installTauriEnvironment();
    const host = createHost();
    const dispatcher = { dispatch: vi.fn() };
    const classList = { toggle: vi.fn() };
    setDocument({ getElementById: vi.fn(() => ({ classList })) });
    const dispose = await setupDesktopEvents(options({ host, dispatcher }));

    await windowHandlers.get('hwply-menu-command')?.({ payload: 'file:save' });
    await windowHandlers.get('tauri://drag-enter')?.({ payload: { paths: ['doc.hwpx'] } });
    await windowHandlers.get('tauri://drag-drop')?.({ payload: {} });
    const preventDefault = vi.fn();
    await getCloseHandler()?.({ preventDefault });

    expect(dispatcher.dispatch).toHaveBeenCalledWith('file:save');
    expect(classList.toggle).toHaveBeenNthCalledWith(1, 'drag-over', true);
    expect(classList.toggle).toHaveBeenNthCalledWith(2, 'drag-over', false);
    expect(preventDefault).toHaveBeenCalled();
    expect(host.confirmWindowClose).toHaveBeenCalledOnce();
    expect(host.destroyCurrentWindow).toHaveBeenCalledOnce();
    dispose();
  });

  it('keeps the window open and reports a close failure', async () => {
    const { getCloseHandler } = installTauriEnvironment();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host = createHost({
      confirmWindowClose: vi.fn().mockRejectedValue(new Error('dialog failed')),
    });
    const setMessage = vi.fn();
    const dispose = await setupDesktopEvents(options({ host, setMessage }));

    await getCloseHandler()?.({ preventDefault: vi.fn() });

    expect(host.destroyCurrentWindow).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith('창 닫기 실패: Error: dialog failed');
    dispose();
  });

  it('unlistens every native event and removes transient state exactly once', async () => {
    const { unlisteners, documentLike } = installTauriEnvironment();
    const classList = { toggle: vi.fn() };
    setDocument({ getElementById: vi.fn(() => ({ classList })) }, documentLike);
    const dispose = await setupDesktopEvents(options());

    dispose();
    dispose();

    expect(unlisteners).toHaveLength(7);
    for (const unlisten of unlisteners) expect(unlisten).toHaveBeenCalledOnce();
    expect(documentLike.removeEventListener).toHaveBeenCalledOnce();
    expect(classList.toggle).toHaveBeenLastCalledWith('drag-over', false);
  });

  it('rolls back completed registrations when one listener fails', async () => {
    const { unlisteners, documentLike } = installTauriEnvironment();
    currentWindow.listen.mockRejectedValueOnce(new Error('menu listener failed'));

    await expect(setupDesktopEvents(options())).rejects.toThrow('menu listener failed');

    expect(unlisteners.length).toBeGreaterThan(0);
    for (const unlisten of unlisteners) expect(unlisten).toHaveBeenCalledOnce();
    expect(documentLike.removeEventListener).toHaveBeenCalledOnce();
  });

  it('unlistens a late registration after setup is aborted', async () => {
    const { unlisteners, documentLike } = installTauriEnvironment();
    const lateRegistration = deferred<() => void>();
    const lateUnlisten = vi.fn();
    currentWindow.listen.mockImplementationOnce(() => lateRegistration.promise);
    const controller = new AbortController();
    const setup = setupDesktopEvents(options(), controller.signal);
    const rejection = expect(setup).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(currentWindow.listen).toHaveBeenCalled());

    controller.abort();
    lateRegistration.resolve(lateUnlisten);
    await rejection;

    expect(lateUnlisten).toHaveBeenCalledOnce();
    for (const unlisten of unlisteners) expect(unlisten).toHaveBeenCalledOnce();
    expect(documentLike.removeEventListener).toHaveBeenCalledOnce();
  });
});

function installTauriEnvironment() {
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform: 'Win32', userAgent: 'Windows NT 10.0' },
    configurable: true,
  });
  (globalThis as { window?: unknown }).window = {
    __TAURI_INTERNALS__: {},
    location: { protocol: 'tauri:' },
  };
  const documentLike = setDocument();
  const windowHandlers = new Map<string, (event: { payload: unknown }) => unknown>();
  const globalHandlers = new Map<string, (event: { payload: unknown }) => unknown>();
  const unlisteners: Array<ReturnType<typeof vi.fn>> = [];
  let closeHandler: ((event: { preventDefault(): void }) => Promise<void>) | undefined;
  tauriListen.mockImplementation(async (name, handler) => {
    globalHandlers.set(name, handler);
    return trackedUnlisten(unlisteners, () => globalHandlers.delete(name));
  });
  currentWindow.listen.mockImplementation(async (name, handler) => {
    windowHandlers.set(name, handler);
    return trackedUnlisten(unlisteners, () => windowHandlers.delete(name));
  });
  currentWindow.onCloseRequested.mockImplementation(async (handler) => {
    closeHandler = handler;
    return trackedUnlisten(unlisteners, () => { closeHandler = undefined; });
  });
  return {
    documentLike,
    unlisteners,
    windowHandlers,
    getCloseHandler: () => closeHandler,
  };
}

function trackedUnlisten(
  unlisteners: Array<ReturnType<typeof vi.fn>>,
  cleanup: () => void,
) {
  const unlisten = vi.fn(cleanup);
  unlisteners.push(unlisten);
  return unlisten;
}

function setDocument(
  overrides: Record<string, unknown> = {},
  base?: { addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> },
) {
  const documentLike = {
    addEventListener: base?.addEventListener ?? vi.fn(),
    removeEventListener: base?.removeEventListener ?? vi.fn(),
    getElementById: vi.fn(() => null),
    ...overrides,
  };
  (globalThis as { document?: unknown }).document = documentLike;
  return documentLike;
}

function createHost(overrides: Record<string, unknown> = {}) {
  return {
    openDocumentByPath: vi.fn(),
    takePendingOpenPaths: vi.fn().mockResolvedValue([]),
    confirmWindowClose: vi.fn().mockResolvedValue(true),
    destroyCurrentWindow: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    host: createHost(),
    dispatcher: { dispatch: vi.fn() },
    setMessage: vi.fn(),
    ...overrides,
  } as never;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
