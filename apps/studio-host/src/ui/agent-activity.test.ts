// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentActivity } from './agent-activity';

function setup(platform: 'macos' | 'windows' = 'macos') {
  document.body.innerHTML = '';
  const root = document.body;
  const onRestoreLatest = vi.fn().mockResolvedValue(undefined);
  const activity = new AgentActivity(root, onRestoreLatest, platform);
  return { root, activity, onRestoreLatest };
}

describe('agent activity', () => {
  afterEach(() => vi.useRealTimers());

  it('shows a badge counting live and round-trip changes', () => {
    const { root, activity } = setup();
    expect(root.querySelector('.hwply-agent-badge')).toBeNull();
    activity.record({ kind: 'live' });
    activity.record({ kind: 'roundtrip' });
    expect(root.querySelector('.hwply-agent-badge')?.textContent).toBe('에이전트 변경 2');
  });

  it('round-trip toast has a restore button that calls onRestoreLatest once', async () => {
    const { root, activity, onRestoreLatest } = setup();
    activity.record({ kind: 'roundtrip' });
    const toast = root.querySelector('.hwply-agent-toast');
    expect(toast?.textContent).toContain('에이전트가 문서를 바꿨습니다');
    const button = toast?.querySelector('button');
    expect(button?.textContent).toBe('되돌리기');
    button?.click();
    button?.click();
    await Promise.resolve();
    expect(onRestoreLatest).toHaveBeenCalledTimes(1);
  });

  it('live toast has no restore button and names the platform undo key', () => {
    const mac = setup('macos');
    mac.activity.record({ kind: 'live' });
    const toast = mac.root.querySelector('.hwply-agent-toast');
    expect(toast?.textContent).toBe('에이전트가 문단을 고쳤습니다 — ⌘Z 로 되돌릴 수 있습니다');
    expect(toast?.querySelector('button')).toBeNull();
    const win = setup('windows');
    win.activity.record({ kind: 'live' });
    expect(win.root.querySelector('.hwply-agent-toast')?.textContent).toContain('Ctrl+Z');
  });

  it('toast disappears after eight seconds', () => {
    vi.useFakeTimers();
    const { root, activity } = setup();
    activity.record({ kind: 'roundtrip' });
    vi.advanceTimersByTime(8_000);
    expect(root.querySelector('.hwply-agent-toast')).toBeNull();
  });

  it('clicking the badge restores the latest snapshot', async () => {
    const { root, activity, onRestoreLatest } = setup();
    activity.record({ kind: 'roundtrip' });
    (root.querySelector('.hwply-agent-badge') as HTMLElement).click();
    await Promise.resolve();
    expect(onRestoreLatest).toHaveBeenCalledTimes(1);
  });

  it('resetCount hides the badge', () => {
    const { root, activity } = setup();
    activity.record({ kind: 'live' });
    activity.resetCount();
    expect(root.querySelector('.hwply-agent-badge')).toBeNull();
  });
});
