// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const controller = vi.hoisted(() => ({
  current: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
  check: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../core/desktop-updater', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/desktop-updater')>();
  return {
    ...actual,
    getDesktopUpdaterController: () => controller,
    ensureDesktopUpdater: vi.fn(),
  };
});

import { showUpdateDialog } from './update-dialog';

const idle = { status: 'idle', trigger: 'startup', operationId: 1, currentVersion: '0.1.0', availableVersion: null, target: null, releaseNotes: null, progress: null, blocker: null, failure: null, manualDownloadsUrl: null };

describe('update dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('opening the dialog starts a fresh check when the last result says up to date', async () => {
    controller.current.mockReturnValue(idle);
    await showUpdateDialog();
    expect(controller.check).toHaveBeenCalledOnce();
  });

  it('does not restart a check while an update is ready to install', async () => {
    controller.current.mockReturnValue({ ...idle, status: 'available', availableVersion: '0.1.1' });
    await showUpdateDialog();
    expect(controller.check).not.toHaveBeenCalled();
  });
});
