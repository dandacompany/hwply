import { installEmbedRuntime as installUpstreamEmbedRuntime } from '@upstream/embed/runtime';
import type { EmbedRpcHandlers } from '@upstream/embed/rpc-router';
import { installPageHideCleanup } from '../core/page-lifecycle';

export type DesktopStudioHandlers = Pick<
  EmbedRpcHandlers,
  | 'loadFile'
  | 'pageCount'
  | 'getPageSvg'
  | 'exportHwp'
  | 'exportHwpx'
  | 'exportHml'
  | 'notifySaved'
  | 'getDocumentState'
  | 'getSelectionContext'
  | 'applyTextCommand'
  | 'focusTarget'
>;

interface HandlerWaiter {
  owner: Set<HandlerWaiter>;
  resolve(handlers: DesktopStudioHandlers): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
}

type WaiterResult =
  | { handlers: DesktopStudioHandlers }
  | { error: Error };

const pendingHandlerWaiters = new Set<HandlerWaiter>();
let activeRegistration: EmbedRuntimeRegistration | null = null;

export function waitForDesktopStudioHandlers(timeoutMs = 15_000): Promise<DesktopStudioHandlers> {
  return activeRegistration
    ? activeRegistration.waitForHandlers(timeoutMs)
    : createHandlerWaiter(pendingHandlerWaiters, timeoutMs);
}

export function installEmbedRuntime(
  options: Parameters<typeof installUpstreamEmbedRuntime>[0],
): () => void {
  const uninstallUpstream = installUpstreamEmbedRuntime(options);
  const registration = new EmbedRuntimeRegistration(
    pickDesktopHandlers(options.handlers),
    uninstallUpstream,
  );
  const previousRegistration = activeRegistration;
  activeRegistration = registration;
  registration.attachPageHideCleanup();
  previousRegistration?.dispose();
  registration.adoptPendingWaiters(pendingHandlerWaiters);
  return () => registration.dispose();
}

class EmbedRuntimeRegistration {
  private readonly waiters = new Set<HandlerWaiter>();
  private disposed = false;
  private resolutionScheduled = false;
  private removePageHideCleanup: () => void = () => {};

  constructor(
    private readonly handlers: DesktopStudioHandlers,
    private readonly uninstallUpstream: () => void,
  ) {}

  attachPageHideCleanup(): void {
    this.removePageHideCleanup = installPageHideCleanup(() => this.dispose());
  }

  waitForHandlers(timeoutMs: number): Promise<DesktopStudioHandlers> {
    const pending = createHandlerWaiter(this.waiters, timeoutMs);
    this.scheduleResolution();
    return pending;
  }

  adoptPendingWaiters(source: Set<HandlerWaiter>): void {
    for (const waiter of source) {
      source.delete(waiter);
      waiter.owner = this.waiters;
      this.waiters.add(waiter);
    }
    this.scheduleResolution();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removePageHideCleanup();
    const ownedActiveRegistration = activeRegistration === this;
    if (ownedActiveRegistration) activeRegistration = null;
    settleHandlerWaiters(this.waiters, { error: runtimeDisposedError() });
    runUpstreamUninstaller(this.uninstallUpstream);
    if (ownedActiveRegistration) {
      settleHandlerWaiters(pendingHandlerWaiters, { error: runtimeDisposedError() });
    }
  }

  private scheduleResolution(): void {
    if (this.disposed || this.resolutionScheduled || this.waiters.size === 0) return;
    this.resolutionScheduled = true;
    queueMicrotask(() => {
      this.resolutionScheduled = false;
      if (this.disposed) return;
      settleHandlerWaiters(this.waiters, { handlers: this.handlers });
    });
  }
}

function createHandlerWaiter(
  owner: Set<HandlerWaiter>,
  timeoutMs: number,
): Promise<DesktopStudioHandlers> {
  return new Promise((resolve, reject) => {
    let waiter!: HandlerWaiter;
    waiter = {
      owner,
      resolve,
      reject,
      timer: setTimeout(() => settleHandlerWaiter(waiter, {
        error: new Error(`Studio handler 준비 시간이 ${timeoutMs}ms를 초과했습니다`),
      }), timeoutMs),
      settled: false,
    };
    owner.add(waiter);
  });
}

function settleHandlerWaiters(waiters: Set<HandlerWaiter>, result: WaiterResult): void {
  for (const waiter of Array.from(waiters)) settleHandlerWaiter(waiter, result);
}

function settleHandlerWaiter(waiter: HandlerWaiter, result: WaiterResult): void {
  if (waiter.settled) return;
  waiter.settled = true;
  clearTimeout(waiter.timer);
  waiter.owner.delete(waiter);
  if ('handlers' in result) waiter.resolve(result.handlers);
  else waiter.reject(result.error);
}

function pickDesktopHandlers(handlers: EmbedRpcHandlers): DesktopStudioHandlers {
  return {
    loadFile: handlers.loadFile,
    pageCount: handlers.pageCount,
    getPageSvg: handlers.getPageSvg,
    exportHwp: handlers.exportHwp,
    exportHwpx: handlers.exportHwpx,
    exportHml: handlers.exportHml,
    notifySaved: handlers.notifySaved,
    getDocumentState: handlers.getDocumentState,
    getSelectionContext: handlers.getSelectionContext,
    applyTextCommand: handlers.applyTextCommand,
    focusTarget: handlers.focusTarget,
  };
}

function runUpstreamUninstaller(uninstall: () => void): void {
  try {
    uninstall();
  } catch (error) {
    console.warn('[desktop-runtime] upstream uninstall failed:', error);
  }
}

function runtimeDisposedError(): Error {
  return new Error('Studio handler runtime이 준비 완료 전에 종료되었습니다');
}
