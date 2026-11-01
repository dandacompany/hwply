export type DesktopPlatform = 'windows' | 'linux' | 'unknown';

type NavigatorLike = Pick<Navigator, 'platform' | 'userAgent'> | undefined;

export function isTauriRuntime(
  windowLike: (Pick<Window, 'location'> & { __TAURI_INTERNALS__?: unknown }) | undefined =
    typeof window === 'undefined' ? undefined : window,
): boolean {
  return Boolean(
    windowLike
    && ('__TAURI_INTERNALS__' in windowLike || windowLike.location?.protocol === 'tauri:'),
  );
}

export function detectDesktopPlatform(
  nav: NavigatorLike = typeof navigator === 'undefined' ? undefined : navigator,
): DesktopPlatform {
  const platform = (nav?.platform ?? '').toLowerCase();
  const userAgent = (nav?.userAgent ?? '').toLowerCase();

  if (platform.includes('win') || userAgent.includes('windows')) return 'windows';
  if (platform.includes('linux') || userAgent.includes('linux')) return 'linux';
  return 'unknown';
}
