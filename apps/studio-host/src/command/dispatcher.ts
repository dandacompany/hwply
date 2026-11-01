import { CommandDispatcher as UpstreamCommandDispatcher } from '@upstream/command/dispatcher';
import type { CommandRegistry } from '@upstream/command/registry';
import type { CommandServices } from '@upstream/command/types';
import type { EventBus } from '@upstream/core/event-bus';
import { getDesktopHost } from '../core/desktop-host';
import { installDesktopAgent } from '../agent/agent-bridge';
import { setupDesktopEvents } from '../core/desktop-events';
import { installDesktopToolbarModeSync } from '../core/desktop-toolbar-mode-sync';
import { installPageHideCleanup } from '../core/page-lifecycle';
import { isTauriRuntime } from '../core/platform';
import { installDesktopLocalFonts } from '../core/local-font-lifecycle';
import { installAgentSetupPrompt } from '../ui/agent-setup-dialog';

type Disposer = () => void;

interface DesktopAdapterRegistration {
  dispose(): void;
}

let activeDesktopRegistration: DesktopAdapterRegistration | null = null;

export class CommandDispatcher extends UpstreamCommandDispatcher {
  private disposeDesktopAdapters: Disposer = () => {};

  constructor(registry: CommandRegistry, services: CommandServices, eventBus: EventBus) {
    super(registry, services, eventBus);
    if (!isTauriRuntime()) return;
    const host = getDesktopHost();
    host.bindCommandServices(services);
    const setMessage = (message: string) => {
      const status = document.getElementById('sb-message');
      if (status) status.textContent = message;
    };
    const agent = installDesktopAgent(host, services, setMessage);
    void installAgentSetupPrompt();
    const disposeAdapters = installDesktopAdapters({
      host,
      dispatcher: this,
      agent: agent.port,
      eventBus,
      registry,
      setMessage,
    });
    this.disposeDesktopAdapters = () => {
      disposeAdapters();
      agent.dispose();
    };
  }

  dispose(): void {
    this.disposeDesktopAdapters();
  }
}

function installDesktopAdapters({
  host,
  dispatcher,
  eventBus,
  registry,
  setMessage,
  agent,
}: Parameters<typeof setupDesktopEvents>[0] & { eventBus: EventBus; registry: CommandRegistry }): Disposer {
  activeDesktopRegistration?.dispose();
  const abortController = new AbortController();
  const disposeToolbar = installDesktopToolbarModeSync(eventBus);
  const disposeFonts = installDesktopLocalFonts(registry);
  let disposeEvents: Disposer | null = null;
  let removePageHideCleanup: Disposer = () => {};
  let disposed = false;

  const registration: DesktopAdapterRegistration = {
    dispose() {
      if (disposed) return;
      disposed = true;
      removePageHideCleanup();
      abortController.abort();
      disposeEvents?.();
      disposeToolbar();
      disposeFonts();
    },
  };
  const uninstall = () => {
    registration.dispose();
    if (activeDesktopRegistration === registration) activeDesktopRegistration = null;
  };
  activeDesktopRegistration = registration;
  removePageHideCleanup = installPageHideCleanup(uninstall);

  void setupDesktopEvents({ host, dispatcher, setMessage, agent }, abortController.signal)
    .then((dispose) => {
      if (disposed) dispose();
      else disposeEvents = dispose;
    })
    .catch((error) => {
      if (disposed) return;
      uninstall();
      console.error('[desktop-events] setup failed:', error);
    });

  return uninstall;
}
