import { describe, expect, it } from 'vitest';
import {
  detectDesktopPlatform,
  isTauriRuntime,
} from './platform';

describe('platform', () => {
  it('detects Windows from navigator.platform', () => {
    expect(detectDesktopPlatform({
      platform: 'Win32',
      userAgent: 'Mozilla/5.0',
    })).toBe('windows');
  });

  it('falls back to the Windows user agent', () => {
    expect(detectDesktopPlatform({
      platform: '',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })).toBe('windows');
  });

  it('detects Linux and leaves unsupported platforms unknown', () => {
    expect(detectDesktopPlatform({
      platform: 'Linux x86_64',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    })).toBe('linux');

    expect(detectDesktopPlatform({
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
    })).toBe('unknown');
    expect(detectDesktopPlatform({ platform: '', userAgent: '' })).toBe('unknown');
  });

  it('detects both injected and protocol Tauri runtimes', () => {
    expect(isTauriRuntime({ location: { protocol: 'https:' } as Location })).toBe(false);
    expect(isTauriRuntime({
      __TAURI_INTERNALS__: {},
      location: { protocol: 'https:' } as Location,
    })).toBe(true);
    expect(isTauriRuntime({ location: { protocol: 'tauri:' } as Location })).toBe(true);
  });
});
