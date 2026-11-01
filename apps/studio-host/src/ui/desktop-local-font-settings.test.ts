import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FontPreferences } from '../core/local-font-preferences';
import {
  closeDesktopLocalFontSettings, fontSettingsMessage, showDesktopLocalFontSettings,
} from './desktop-local-font-settings';

// Exercise the product body/actions; the upstream modal owns keyboard and focus behavior.
const modal = vi.hoisted(() => ({ current: null as any }));
vi.mock('@upstream/ui/dialog', () => ({ ModalDialog: class {
  afterClose?: () => void;
  body: any;
  createBody(): any {}
  onConfirm(): void {}
  show(): void { modal.current = this; this.body = this.createBody(); }
  hide(): void { this.afterClose?.(); }
  confirm(): void { this.onConfirm(); this.hide(); }
} }));

class Element extends EventTarget {
  children: Element[] = [];
  textContent = '';
  value = '';
  checked = false;
  constructor(readonly tag: string) { super(); }
  appendChild(child: Element): void { this.children.push(child); }
}
const preferences: FontPreferences = {
  choice: 'unset', persisted: false, revision: 0, promptDismissed: false, error: null,
};

describe('desktop font settings actions and truthful status', () => {
  beforeEach(() => vi.stubGlobal('document', {
    createElement: (tag: string) => new Element(tag),
    createTextNode: (text: string) => Object.assign(new Element('text'), { textContent: text }),
  }));
  afterEach(() => { closeDesktopLocalFontSettings(); vi.unstubAllGlobals(); });

  it.each(['enabled', 'disabled'] as const)('confirms the selected %s radio', async (choice) => {
    const result = showDesktopLocalFontSettings({ ...preferences, choice }, 'status');
    const body = modal.current.body as Element;
    const inputs = body.children.filter((child) => child.tag === 'label').map((label) => label.children[0]);
    expect(inputs.map((input) => [input.value, input.checked])).toEqual([
      ['enabled', choice === 'enabled'], ['disabled', choice === 'disabled'],
    ]);
    // Change the selection before confirmation to check the value is read from the UI.
    inputs[0].checked = choice !== 'enabled';
    modal.current.confirm();
    expect(await result).toBe(choice === 'enabled' ? 'disabled' : 'enabled');
  });

  it('dismisses on close and resolves a replaced dialog without persisting a choice', async () => {
    const first = showDesktopLocalFontSettings(preferences, 'first');
    const second = showDesktopLocalFontSettings(preferences, 'second');
    expect(await first).toBe('dismiss');
    closeDesktopLocalFontSettings();
    expect(await second).toBe('dismiss');
  });

  it('offers explicit redetection only for an enabled choice', async () => {
    const result = showDesktopLocalFontSettings({ ...preferences, choice: 'enabled' }, 'status');
    const button = (modal.current.body as Element).children.find((child) => child.tag === 'button')!;
    expect(button.textContent).toBe('다시 감지');
    button.dispatchEvent(new Event('click'));
    expect(await result).toBe('refresh');
    showDesktopLocalFontSettings({ ...preferences, choice: 'disabled' }, 'status');
    expect((modal.current.body as Element).children.some((child) => child.tag === 'button')).toBe(false);
  });

  it('distinguishes saved choice, catalog count, fallback and temporary failures', () => {
    const enabled = { ...preferences, choice: 'enabled' as const, persisted: true };
    expect(fontSettingsMessage(enabled, 3, null)).toContain('감지 목록 3개이며 실제 적용 범위');
    expect(fontSettingsMessage(enabled, 0, 'private/path')).toContain('다시 감지');
    expect(fontSettingsMessage({ ...enabled, error: 'save-failed' }, 3, null)).toContain('이번 창에서만');
    expect(fontSettingsMessage({ ...enabled, error: 'private/path' }, 0, null)).not.toContain('private/path');
    expect(fontSettingsMessage({ ...preferences, choice: 'disabled' }, 0, null)).toContain('시스템의 글꼴 해석은 유지');
  });
});
