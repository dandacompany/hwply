export type FontChoice = 'unset' | 'enabled' | 'disabled';
export type FontAction = Exclude<FontChoice, 'unset'> | 'dismiss';
export interface FontPreferences {
  choice: FontChoice;
  persisted: boolean;
  revision: number;
  promptDismissed: boolean;
  error: string | null;
}

let snapshot: FontPreferences = {
  choice: 'unset', persisted: false, revision: -1, promptDismissed: false, error: null,
};
let temporary: FontAction | null = null;
let initialized = false;
let pending: Promise<FontPreferences> | null = null;
let operation = 0;
const subscribers = new Set<() => void>();

export function getFontPreferences(): FontPreferences {
  return {
    ...snapshot,
    choice: temporary && temporary !== 'dismiss' ? temporary : snapshot.choice,
    persisted: temporary && temporary !== 'dismiss' ? false : snapshot.persisted,
    promptDismissed: temporary === 'dismiss' || snapshot.promptDismissed,
    error: temporary ? 'save-failed' : snapshot.error,
  };
}

export function subscribeFontPreferences(callback: () => void): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function notify(): void {
  for (const callback of subscribers) callback();
}

export function acceptFontPreferences(value: FontPreferences): boolean {
  if (!validSnapshot(value) || value.revision < snapshot.revision) return false;
  if (JSON.stringify(value) === JSON.stringify(snapshot)) return false;
  if (value.revision > snapshot.revision) temporary = null;
  operation += 1;
  snapshot = { ...value };
  initialized = true;
  notify();
  return true;
}

function validSnapshot(value: FontPreferences): boolean {
  return !!value && ['unset', 'enabled', 'disabled'].includes(value.choice)
    && typeof value.persisted === 'boolean' && typeof value.promptDismissed === 'boolean'
    && Number.isSafeInteger(value.revision) && value.revision >= 0
    && (value.error === null || typeof value.error === 'string');
}

export async function refreshFontPreferences(): Promise<FontPreferences> {
  if (pending) return pending;
  const started = operation;
  const request = (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const value = await invoke<FontPreferences>('get_local_font_preferences');
      if (!validSnapshot(value)) throw new Error('invalid font settings');
      if (started === operation) acceptFontPreferences(value);
    } catch {
      if (started === operation) {
        snapshot = { ...snapshot, choice: 'unset', persisted: false, error: 'restore-failed' };
        temporary = null;
        notify();
      }
    }
    initialized = true;
    return getFontPreferences();
  })();
  pending = request;
  try { return await request; } finally { if (pending === request) pending = null; }
}

export function ensureFontPreferences(): Promise<FontPreferences> {
  return initialized ? Promise.resolve(getFontPreferences()) : refreshFontPreferences();
}

export async function saveFontPreference(action: FontAction): Promise<FontPreferences> {
  const started = ++operation;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const value = await invoke<FontPreferences>('set_local_font_preferences', { action });
    if (!validSnapshot(value)) throw new Error('invalid font settings');
    if (started === operation && value.revision >= snapshot.revision) {
      temporary = null;
      snapshot = { ...value };
      notify();
    }
  } catch {
    if (started === operation) {
      temporary = action;
      snapshot = { ...snapshot, error: 'save-failed' };
      notify();
    }
  }
  initialized = true;
  return getFontPreferences();
}

export async function listenFontPreferences(onChange: () => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<FontPreferences>('hwply-local-font-preferences-changed', (event) => {
    if (acceptFontPreferences(event.payload)) onChange();
  });
}
