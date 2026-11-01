import type { CommandRegistry } from '@upstream/command/registry';
import {
  disposeDesktopLocalFonts, openDesktopLocalFontSettings, refreshDesktopLocalFontView,
} from './local-font-controller';
import { getFontPreferences, listenFontPreferences, refreshFontPreferences } from './local-font-preferences';

const commandId = 'tool:local-font-settings';

export function installDesktopLocalFonts(registry: CommandRegistry): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;
  const command = {
    id: commandId,
    label: '로컬 글꼴 설정…',
    execute: () => { void openDesktopLocalFontSettings(); },
  };
  registry.register(command);
  const changed = () => { if (!disposed) void refreshDesktopLocalFontView(); };
  const focused = () => {
    const before = JSON.stringify(getFontPreferences());
    void refreshFontPreferences().then((after) => {
      if (JSON.stringify(after) !== before) changed();
    });
  };
  window.addEventListener('focus', focused);
  void listenFontPreferences(changed).then(async (cleanup) => {
    if (disposed) { cleanup(); return; }
    unlisten = cleanup;
    await refreshFontPreferences();
  }).catch(() => {
    // Document entry and focus retain snapshot recovery if native listen fails.
  });
  return () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('focus', focused);
    unlisten?.();
    if (registry.get(commandId) === command) registry.unregister(commandId);
    disposeDesktopLocalFonts();
  };
}
