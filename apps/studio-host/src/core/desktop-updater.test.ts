import { describe, expect, it, vi } from 'vitest';
import {
  DesktopUpdaterController,
  invokeUpdaterButton,
  shouldOfferManualDownloads,
  type DesktopUpdaterBridge,
  type UpdaterSnapshot,
} from './desktop-updater';

describe('desktop updater controller', () => {
  it('listens before the initial snapshot and keeps a newer startup event', async () => {
    const order: string[] = [];
    let handler: (snapshot: UpdaterSnapshot) => void = () => undefined;
    const announce = vi.fn();
    const bridge = fixtureBridge({
      listen: vi.fn(async (next) => {
        order.push('listen');
        handler = next;
        return () => undefined;
      }),
      getState: vi.fn(async () => {
        order.push('getState');
        handler(snapshot({ status: 'available', trigger: 'startup', operationId: 2 }));
        return snapshot({ status: 'checking', trigger: 'startup', operationId: 1 });
      }),
    });
    const controller = new DesktopUpdaterController(bridge, announce);

    await controller.start();

    expect(order).toEqual(['listen', 'getState']);
    expect(controller.current()?.operationId).toBe(2);
    expect(announce).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('제품 정보'));
  });

  it('does not announce a manual check result as a startup interruption', async () => {
    const announce = vi.fn();
    const available = snapshot({ status: 'available', trigger: 'manual', operationId: 1 });
    const bridge = fixtureBridge({ check: vi.fn().mockResolvedValue(available) });
    const controller = new DesktopUpdaterController(bridge, announce);

    expect(await controller.check()).toEqual(available);
    expect(announce).not.toHaveBeenCalled();
  });

  it('accepts monotonic progress and ignores delayed progress snapshots', async () => {
    let handler: (snapshot: UpdaterSnapshot) => void = () => undefined;
    const bridge = fixtureBridge({
      listen: vi.fn(async (next) => {
        handler = next;
        return () => undefined;
      }),
    });
    const controller = new DesktopUpdaterController(bridge);
    await controller.start();

    handler(progressSnapshot(60));
    handler(progressSnapshot(20));

    expect(controller.current()?.progress?.percent).toBe(60);
  });

  it('keeps a dirty-document result retryable through the explicit apply action', async () => {
    const blocked = snapshot({
      status: 'available',
      trigger: 'manual',
      operationId: 1,
      blocker: 'dirtyDocuments',
    });
    const completed = snapshot({
      status: 'restartRequired',
      trigger: 'manual',
      operationId: 1,
    });
    const apply = vi.fn().mockResolvedValueOnce(blocked).mockResolvedValueOnce(completed);
    const controller = new DesktopUpdaterController(fixtureBridge({ apply }));

    expect((await controller.apply()).blocker).toBe('dirtyDocuments');
    expect((await controller.apply()).status).toBe('restartRequired');
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('invokes native work only from a button with an updater action', async () => {
    const check = vi.fn().mockResolvedValue(snapshot());
    const openManualDownloads = vi.fn().mockResolvedValue(undefined);
    const controller = new DesktopUpdaterController(fixtureBridge({ check, openManualDownloads }));

    expect(await invokeUpdaterButton(
      { tagName: 'DIV', dataset: { updaterAction: 'check' } } as never,
      controller,
    )).toBe(false);
    expect(check).not.toHaveBeenCalled();
    expect(await invokeUpdaterButton(
      { tagName: 'BUTTON', dataset: { updaterAction: 'check' } } as never,
      controller,
    )).toBe(true);
    expect(check).toHaveBeenCalledOnce();
    expect(await invokeUpdaterButton(
      { tagName: 'A', dataset: { updaterAction: 'manualDownloads' } } as never,
      controller,
    )).toBe(false);
    expect(openManualDownloads).not.toHaveBeenCalled();
    expect(await invokeUpdaterButton(
      { tagName: 'BUTTON', dataset: { updaterAction: 'manualDownloads' } } as never,
      controller,
    )).toBe(true);
    expect(openManualDownloads).toHaveBeenCalledOnce();
  });

  it('offers the manual download route for blockers and updater errors', () => {
    expect(shouldOfferManualDownloads(null)).toBe(false);
    expect(shouldOfferManualDownloads(snapshot())).toBe(false);
    expect(shouldOfferManualDownloads(snapshot({
      blocker: 'unsupportedInstall',
      manualDownloadsUrl: 'https://example.test/updates/',
    }))).toBe(true);
    expect(shouldOfferManualDownloads(snapshot({ status: 'error' }))).toBe(true);
    expect(shouldOfferManualDownloads(snapshot(), 'invoke failed')).toBe(true);
  });

  it('preserves unsupported-install fallback and allows a failed check retry', async () => {
    const unsupported = snapshot({
      blocker: 'unsupportedInstall',
      manualDownloadsUrl: 'https://example.test/updates/',
    });
    const failed = snapshot({
      status: 'error',
      trigger: 'manual',
      operationId: 1,
      failure: { code: 'updateCheckFailed', message: '확인 실패', retryable: true },
    });
    const available = snapshot({ status: 'available', trigger: 'manual', operationId: 2 });
    const check = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(available);
    const controller = new DesktopUpdaterController(fixtureBridge({
      getState: vi.fn().mockResolvedValue(unsupported),
      check,
    }));
    await controller.start();

    expect(controller.current()?.manualDownloadsUrl).toContain('/updates/');
    expect((await controller.check()).failure?.retryable).toBe(true);
    expect((await controller.check()).status).toBe('available');
  });
});

function fixtureBridge(overrides: Partial<DesktopUpdaterBridge> = {}): DesktopUpdaterBridge {
  return {
    listen: vi.fn().mockResolvedValue(() => undefined),
    getState: vi.fn().mockResolvedValue(snapshot()),
    check: vi.fn().mockResolvedValue(snapshot()),
    apply: vi.fn().mockResolvedValue(snapshot()),
    restart: vi.fn().mockResolvedValue(snapshot()),
    openManualDownloads: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function progressSnapshot(percent: number): UpdaterSnapshot {
  return snapshot({
    status: 'downloading',
    trigger: 'manual',
    operationId: 1,
    progress: { downloadedBytes: percent, totalBytes: 100, percent },
  });
}

function snapshot(overrides: Partial<UpdaterSnapshot> = {}): UpdaterSnapshot {
  return {
    status: 'idle',
    trigger: null,
    operationId: null,
    currentVersion: '0.1.0',
    availableVersion: '0.2.0',
    target: null,
    releaseNotes: null,
    progress: null,
    blocker: null,
    failure: null,
    manualDownloadsUrl: null,
    ...overrides,
  };
}
