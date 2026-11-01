import { isTauriRuntime } from './platform';

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'restartRequired'
  | 'error';

export interface UpdaterSnapshot {
  status: UpdaterStatus;
  trigger: 'startup' | 'manual' | null;
  operationId: number | null;
  currentVersion: string | null;
  availableVersion: string | null;
  target: { target: string; artifactKind: 'msi' | 'nsis' | 'appImage' } | null;
  releaseNotes: string | null;
  progress: {
    downloadedBytes: number;
    totalBytes: number | null;
    percent: number | null;
  } | null;
  blocker: 'dirtyDocuments' | 'unsupportedInstall' | 'readOnlyAppImage' | null;
  failure: { code: string; message: string; retryable: boolean } | null;
  manualDownloadsUrl: string | null;
}

export interface DesktopUpdaterBridge {
  listen(handler: (snapshot: UpdaterSnapshot) => void): Promise<() => void>;
  getState(): Promise<UpdaterSnapshot>;
  check(): Promise<UpdaterSnapshot>;
  apply(): Promise<UpdaterSnapshot>;
  restart(): Promise<UpdaterSnapshot>;
  openManualDownloads(): Promise<void>;
}

type UpdaterListener = (snapshot: UpdaterSnapshot) => void;

export class DesktopUpdaterController {
  private snapshot: UpdaterSnapshot | null = null;
  private readonly listeners = new Set<UpdaterListener>();
  private readonly announcedOperations = new Set<number>();
  private startPromise: Promise<void> | null = null;

  constructor(
    private readonly bridge: DesktopUpdaterBridge,
    private readonly announce: (message: string) => void = () => undefined,
  ) {}

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.connect();
    return this.startPromise;
  }

  current(): UpdaterSnapshot | null {
    return this.snapshot;
  }

  subscribe(listener: UpdaterListener): () => void {
    this.listeners.add(listener);
    if (this.snapshot) listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async check(): Promise<UpdaterSnapshot> {
    return this.accept(await this.bridge.check());
  }

  async apply(): Promise<UpdaterSnapshot> {
    return this.accept(await this.bridge.apply());
  }

  async restart(): Promise<UpdaterSnapshot> {
    return this.accept(await this.bridge.restart());
  }

  async openManualDownloads(): Promise<void> {
    await this.bridge.openManualDownloads();
  }

  private async connect(): Promise<void> {
    await this.bridge.listen((snapshot) => this.accept(snapshot));
    this.accept(await this.bridge.getState());
  }

  private accept(next: UpdaterSnapshot): UpdaterSnapshot {
    if (isStaleSnapshot(this.snapshot, next)) return this.snapshot ?? next;
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
    this.announceStartupUpdate(next);
    return next;
  }

  private announceStartupUpdate(snapshot: UpdaterSnapshot): void {
    const operationId = snapshot.operationId;
    if (
      snapshot.status !== 'available'
      || snapshot.trigger !== 'startup'
      || operationId === null
      || this.announcedOperations.has(operationId)
    ) return;
    this.announcedOperations.add(operationId);
    this.announce(
      `${snapshot.availableVersion ?? '새 버전'} 업데이트가 있습니다. 제품 정보에서 확인하세요.`,
    );
  }
}

let activeController: DesktopUpdaterController | null = null;

export async function ensureDesktopUpdater(
  announce: (message: string) => void,
): Promise<DesktopUpdaterController | null> {
  if (!isTauriRuntime()) return null;
  activeController ??= new DesktopUpdaterController(createTauriUpdaterBridge(), announce);
  await activeController.start();
  return activeController;
}

export function getDesktopUpdaterController(): DesktopUpdaterController | null {
  return activeController;
}

export async function invokeUpdaterButton(
  target: EventTarget | null,
  controller: DesktopUpdaterController | null = activeController,
): Promise<boolean> {
  const button = target as { tagName?: string; dataset?: { updaterAction?: string } } | null;
  if (!controller || button?.tagName !== 'BUTTON') return false;
  switch (button.dataset?.updaterAction) {
    case 'check':
      await controller.check();
      return true;
    case 'apply':
      await controller.apply();
      return true;
    case 'restart':
      await controller.restart();
      return true;
    case 'manualDownloads':
      await controller.openManualDownloads();
      return true;
    default:
      return false;
  }
}

export function updaterStatusMessage(snapshot: UpdaterSnapshot): string {
  if (snapshot.blocker === 'dirtyDocuments') {
    return '저장하지 않은 문서를 먼저 저장하거나 닫아 주세요.';
  }
  if (snapshot.blocker === 'unsupportedInstall' || snapshot.blocker === 'readOnlyAppImage') {
    return '이 설치 형식은 앱에서 업데이트할 수 없습니다. 다운로드 페이지를 이용해 주세요.';
  }
  if (snapshot.failure) return snapshot.failure.message;
  switch (snapshot.status) {
    case 'checking': return '업데이트를 확인하고 있습니다…';
    case 'available': return `${snapshot.availableVersion ?? '새 버전'}을 설치할 수 있습니다.`;
    case 'downloading': return `업데이트 다운로드 중${progressSuffix(snapshot)}…`;
    case 'installing': return '업데이트를 설치하고 있습니다…';
    case 'restartRequired': return '설치가 완료되었습니다. 앱을 다시 시작해 주세요.';
    default: return snapshot.currentVersion
      ? `현재 ${snapshot.currentVersion} 버전이 최신입니다.`
      : '업데이트 상태를 확인할 수 있습니다.';
  }
}

export function shouldOfferManualDownloads(
  snapshot: UpdaterSnapshot | null,
  actionError?: string,
): boolean {
  return Boolean(actionError || snapshot?.manualDownloadsUrl || snapshot?.status === 'error');
}

function progressSuffix(snapshot: UpdaterSnapshot): string {
  return snapshot.progress?.percent === null || snapshot.progress?.percent === undefined
    ? ''
    : ` ${snapshot.progress.percent}%`;
}

function isStaleSnapshot(current: UpdaterSnapshot | null, next: UpdaterSnapshot): boolean {
  if (!current) return false;
  const currentOperation = current.operationId ?? -1;
  const nextOperation = next.operationId ?? -1;
  if (nextOperation < currentOperation) return true;
  if (nextOperation > currentOperation) return false;
  const currentBytes = current.progress?.downloadedBytes;
  const nextBytes = next.progress?.downloadedBytes;
  return current.status === 'downloading'
    && next.status === 'downloading'
    && currentBytes !== undefined
    && nextBytes !== undefined
    && nextBytes < currentBytes;
}

function createTauriUpdaterBridge(): DesktopUpdaterBridge {
  return {
    async listen(handler) {
      const { listen } = await import('@tauri-apps/api/event');
      return listen<UpdaterSnapshot>('hwply-updater-state', (event) => handler(event.payload));
    },
    async getState() {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<UpdaterSnapshot>('updater_get_state');
    },
    async check() {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<UpdaterSnapshot>('updater_check');
    },
    async apply() {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<UpdaterSnapshot>('updater_apply');
    },
    async restart() {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<UpdaterSnapshot>('updater_restart');
    },
    async openManualDownloads() {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke<void>('updater_open_manual_downloads');
    },
  };
}

export function resetDesktopUpdaterForTest(): void {
  activeController = null;
}
