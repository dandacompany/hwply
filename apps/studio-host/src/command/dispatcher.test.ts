import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandDispatcher } from './dispatcher';

const setupDesktopEvents = vi.hoisted(() => vi.fn());
const installDesktopToolbarModeSync = vi.hoisted(() => vi.fn());
const installDesktopLocalFonts = vi.hoisted(() => vi.fn(() => vi.fn()));
const host = vi.hoisted(() => ({ bindCommandServices: vi.fn() }));

vi.mock('@upstream/command/dispatcher', () => ({
  CommandDispatcher: class {
    dispatch = vi.fn(() => true);
  },
}));
vi.mock('../core/desktop-host', () => ({ getDesktopHost: () => host }));
vi.mock('../core/desktop-events', () => ({ setupDesktopEvents }));
vi.mock('../core/desktop-toolbar-mode-sync', () => ({ installDesktopToolbarModeSync }));
vi.mock('../core/local-font-lifecycle', () => ({ installDesktopLocalFonts }));
const agentPort = vi.hoisted(() => ({ handle: vi.fn() }));
const disposeAgent = vi.hoisted(() => vi.fn());
const installAgentSetupPrompt = vi.hoisted(() => vi.fn());
vi.mock('../ui/agent-setup-dialog', () => ({ installAgentSetupPrompt }));
vi.mock('../agent/agent-bridge', () => ({
  installDesktopAgent: () => ({ port: agentPort, dispose: disposeAgent }),
}));

const dispatchers: CommandDispatcher[] = [];

describe('desktop command dispatcher adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDesktopEvents.mockResolvedValue(vi.fn());
    installDesktopToolbarModeSync.mockReturnValue(vi.fn());
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  afterEach(() => {
    while (dispatchers.length > 0) dispatchers.pop()?.dispose();
  });

  it('has no desktop side effects outside Tauri', () => {
    createDispatcher();

    expect(host.bindCommandServices).not.toHaveBeenCalled();
    expect(setupDesktopEvents).not.toHaveBeenCalled();
    expect(installDesktopToolbarModeSync).not.toHaveBeenCalled();
    expect(installAgentSetupPrompt).not.toHaveBeenCalled();
  });

  it('checks agent setup once on startup in Tauri', async () => {
    installTauriEnvironment();
    createDispatcher();
    await flushSetup();
    expect(installAgentSetupPrompt).toHaveBeenCalledOnce();
    expect(installAgentSetupPrompt).toHaveBeenCalledWith(expect.any(Function));
  });

  it('owns toolbar and native event cleanup for the active registration', async () => {
    installTauriEnvironment();
    const disposeToolbar = vi.fn();
    const disposeEvents = vi.fn();
    installDesktopToolbarModeSync.mockReturnValue(disposeToolbar);
    setupDesktopEvents.mockResolvedValue(disposeEvents);
    const services = {};
    const eventBus = {};

    const dispatcher = createDispatcher(services, eventBus);
    await flushSetup();

    expect(host.bindCommandServices).toHaveBeenCalledWith(services);
    expect(installDesktopToolbarModeSync).toHaveBeenCalledWith(eventBus);
    expect(setupDesktopEvents).toHaveBeenCalledWith(
      expect.objectContaining({ host, dispatcher, setMessage: expect.any(Function) }),
      expect.any(AbortSignal),
    );

    dispatcher.dispose();
    dispatcher.dispose();
    expect(disposeEvents).toHaveBeenCalledOnce();
    expect(disposeToolbar).toHaveBeenCalledOnce();
  });

  it('disposes the active registration on production pagehide', async () => {
    const windowLike = installTauriEnvironment();
    const disposeToolbar = vi.fn();
    const disposeEvents = vi.fn();
    installDesktopToolbarModeSync.mockReturnValue(disposeToolbar);
    setupDesktopEvents.mockResolvedValue(disposeEvents);

    const dispatcher = createDispatcher();
    await flushSetup();
    windowLike.dispatchEvent(new Event('pagehide'));

    expect(disposeEvents).toHaveBeenCalledOnce();
    expect(disposeToolbar).toHaveBeenCalledOnce();
    dispatcher.dispose();
    expect(disposeEvents).toHaveBeenCalledOnce();
  });

  it('replaces the previous registration without letting stale cleanup reach the latest one', async () => {
    installTauriEnvironment();
    const disposeToolbarFirst = vi.fn();
    const disposeToolbarSecond = vi.fn();
    const disposeEventsFirst = vi.fn();
    const disposeEventsSecond = vi.fn();
    installDesktopToolbarModeSync
      .mockReturnValueOnce(disposeToolbarFirst)
      .mockReturnValueOnce(disposeToolbarSecond);
    setupDesktopEvents
      .mockResolvedValueOnce(disposeEventsFirst)
      .mockResolvedValueOnce(disposeEventsSecond);

    const first = createDispatcher();
    await flushSetup();
    const second = createDispatcher();
    await flushSetup();

    expect(disposeEventsFirst).toHaveBeenCalledOnce();
    expect(disposeToolbarFirst).toHaveBeenCalledOnce();
    first.dispose();
    expect(disposeEventsSecond).not.toHaveBeenCalled();
    expect(disposeToolbarSecond).not.toHaveBeenCalled();

    second.dispose();
    expect(disposeEventsSecond).toHaveBeenCalledOnce();
    expect(disposeToolbarSecond).toHaveBeenCalledOnce();
  });

  it('disposes a late event setup result after its generation was replaced', async () => {
    installTauriEnvironment();
    const firstSetup = deferred<() => void>();
    const disposeEventsFirst = vi.fn();
    const disposeEventsSecond = vi.fn();
    const disposeToolbarFirst = vi.fn();
    installDesktopToolbarModeSync
      .mockReturnValueOnce(disposeToolbarFirst)
      .mockReturnValueOnce(vi.fn());
    setupDesktopEvents
      .mockReturnValueOnce(firstSetup.promise)
      .mockResolvedValueOnce(disposeEventsSecond);

    createDispatcher();
    const second = createDispatcher();
    firstSetup.resolve(disposeEventsFirst);
    await flushSetup();

    expect(disposeToolbarFirst).toHaveBeenCalledOnce();
    expect(disposeEventsFirst).toHaveBeenCalledOnce();
    expect(disposeEventsSecond).not.toHaveBeenCalled();
    second.dispose();
    expect(disposeEventsSecond).toHaveBeenCalledOnce();
  });

  it('fails closed when the active native event setup rejects', async () => {
    installTauriEnvironment();
    const error = new Error('listen failed');
    const disposeToolbar = vi.fn();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installDesktopToolbarModeSync.mockReturnValue(disposeToolbar);
    setupDesktopEvents.mockRejectedValue(error);

    const dispatcher = createDispatcher();
    await vi.waitFor(() => expect(errorLog).toHaveBeenCalledWith(
      '[desktop-events] setup failed:',
      error,
    ));

    expect(disposeToolbar).toHaveBeenCalledOnce();
    dispatcher.dispose();
    expect(disposeToolbar).toHaveBeenCalledOnce();
  });
});

function createDispatcher(services: object = {}, eventBus: object = {}): CommandDispatcher {
  const dispatcher = new CommandDispatcher({} as never, services as never, eventBus as never);
  dispatchers.push(dispatcher);
  return dispatcher;
}

function installTauriEnvironment(): EventTarget {
  const windowLike = new EventTarget();
  Object.assign(windowLike, {
    __TAURI_INTERNALS__: {},
    location: { protocol: 'tauri:' },
  });
  (globalThis as { window?: unknown }).window = windowLike;
  (globalThis as { document?: unknown }).document = { getElementById: vi.fn(() => null) };
  return windowLike;
}

async function flushSetup(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
