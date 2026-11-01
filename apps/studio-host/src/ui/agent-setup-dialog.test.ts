// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import {
  waitForQuietStartup,
  maybeShowAgentSetupOnStartup,
  shouldAutoShow,
  showAgentSetupDialog,
  type SetupStatus,
} from './agent-setup-dialog';

function status(overrides: Partial<SetupStatus> = {}): SetupStatus {
  return {
    cliAvailable: true,
    firstRun: true,
    suggestRefresh: false,
    plan: {
      actions: [
        { kind: 'link', dest: '/h/.local/bin/hwply', status: 'planned' },
        { kind: 'skill', dest: '/h/.claude/skills/hwply', status: 'planned' },
      ],
      harnesses: [
        { id: 'claude', label: 'Claude Code', root: '/h/.claude', dest: '/h/.claude/skills/hwply', exists: true },
        { id: 'agents', label: 'Codex·기타', root: '/h/.agents', dest: '/h/.agents/skills/hwply', exists: false },
      ],
    },
    ...overrides,
  };
}

const dialog = () => document.querySelector('.agent-setup-dialog');
const checkbox = (name: string) =>
  document.querySelector<HTMLInputElement>(`.agent-setup-dialog input[name="${name}"]`)!;
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.agent-setup-dialog button')].find((b) => b.textContent === text)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('agent setup dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    invoke.mockReset();
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('auto shows on first run when cli available', async () => {
    expect(shouldAutoShow(status())).toBe(true);
    expect(shouldAutoShow(status({ firstRun: false, suggestRefresh: true }))).toBe(true);
    expect(shouldAutoShow(status({ firstRun: false }))).toBe(false);
    invoke.mockResolvedValueOnce(status());
    await maybeShowAgentSetupOnStartup('main');
    expect(invoke).toHaveBeenCalledWith('setup_status');
    expect(dialog()).not.toBeNull();
  });

  it('does not auto show without cli', async () => {
    expect(shouldAutoShow(status({ cliAvailable: false }))).toBe(false);
    invoke.mockResolvedValueOnce(status({ cliAvailable: false }));
    await maybeShowAgentSetupOnStartup('main');
    expect(dialog()).toBeNull();
    await maybeShowAgentSetupOnStartup('editor-2');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('checks only harnesses whose root exists', async () => {
    await showAgentSetupDialog(status());
    expect(checkbox('path').checked).toBe(true);
    expect(checkbox('skill-claude').checked).toBe(true);
    expect(checkbox('skill-agents').checked).toBe(false);
    expect(dialog()!.textContent).toContain('~/.agents/skills/hwply');
  });

  it('apply sends checked options', async () => {
    await showAgentSetupDialog(status());
    checkbox('skill-agents').checked = true;
    checkbox('path').checked = false;
    invoke.mockResolvedValueOnce({ actions: [], harnesses: [] });
    button('설정').click();
    await flush();
    expect(invoke).toHaveBeenCalledWith('setup_apply', { path: false, skills: ['claude', 'agents'] });
  });

  it('renders skipped reasons and path hint', async () => {
    await showAgentSetupDialog(status());
    invoke.mockResolvedValueOnce({
      actions: [
        { kind: 'link', dest: '/h/.local/bin/hwply', status: 'done' },
        { kind: 'link', dest: '/h/.local/bin/rhwp', status: 'skipped', reason: '기존 파일 유지(--force 로 교체)' },
      ],
      harnesses: [],
      pathHint: 'export PATH="$HOME/.local/bin:$PATH"',
    });
    button('설정').click();
    await flush();
    const text = dialog()!.textContent ?? '';
    expect(text).toContain('기존 파일 유지');
    expect(text).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect(text).toContain('hwply setup');
  });

  it('waits for the document and for other startup dialogs (recovery) before showing', async () => {
    vi.useFakeTimers();
    try {
      let ready = false;
      const recovery = document.createElement('div');
      recovery.className = 'modal-overlay';
      document.body.appendChild(recovery);
      let done = false;
      void waitForQuietStartup(() => ready, { pollMs: 100, timeoutMs: 10_000 }).then(() => { done = true; });

      await vi.advanceTimersByTimeAsync(500);
      expect(done).toBe(false); // 문서가 아직 열리지 않았다
      ready = true;
      await vi.advanceTimersByTimeAsync(500);
      expect(done).toBe(false); // 복구 창이 떠 있다
      recovery.remove();
      document.dispatchEvent(new Event('rhwp-modal-dialog-closed'));
      await vi.advanceTimersByTimeAsync(200);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows without a document when startup stays quiet (desktop opens no blank document)', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      void waitForQuietStartup(() => false, { pollMs: 100, quietMs: 1_000, timeoutMs: 30_000 }).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(600);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(600);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a recovery dialog that appears during the quiet window is waited out', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      void waitForQuietStartup(() => false, { pollMs: 100, quietMs: 1_000, timeoutMs: 30_000 }).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(500);
      const recovery = document.createElement('div');
      recovery.className = 'modal-overlay';
      document.body.appendChild(recovery); // 복구 창은 시작 조금 뒤에 뜬다
      await vi.advanceTimersByTimeAsync(5_000);
      expect(done).toBe(false);
      recovery.remove();
      document.dispatchEvent(new Event('rhwp-modal-dialog-closed'));
      await vi.advanceTimersByTimeAsync(500);
      expect(done).toBe(false); // 닫힌 뒤에도 잠시 조용한지 본다
      await vi.advanceTimersByTimeAsync(800);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('later dismisses without applying', async () => {
    await showAgentSetupDialog(status());
    invoke.mockResolvedValueOnce(undefined);
    button('나중에').click();
    await flush();
    expect(invoke).toHaveBeenCalledWith('setup_dismiss');
    expect(invoke).not.toHaveBeenCalledWith('setup_apply', expect.anything());
    expect(dialog()).toBeNull();
  });
});
