// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

const showAgentSetupDialog = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./agent-setup-dialog', () => ({ showAgentSetupDialog }));
vi.mock('./update-dialog', () => ({ showUpdateDialog: vi.fn() }));

import { AboutDialog } from './about-dialog';

describe('about dialog', () => {
  it('about dialog has agent setup button', () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    vi.stubGlobal('__APP_VERSION__', '0.0.0-test');
    const body = (new AboutDialog() as unknown as { createBody(): HTMLElement }).createBody();
    const button = [...body.querySelectorAll('button')].find((b) => b.textContent === '에이전트 연결 설정…');
    expect(button).toBeDefined();
    button!.click();
    expect(showAgentSetupDialog).toHaveBeenCalledOnce();
  });
});
