import {
  DocumentDirtyState as UpstreamDocumentDirtyState,
  type DirtyStateChange,
} from '@upstream/core/document-dirty-state';
import type { EventBus } from '@upstream/core/event-bus';
import { getDesktopHost } from './desktop-host';
import { isTauriRuntime } from './platform';

export type { DirtyStateChange };

export class DocumentDirtyState extends UpstreamDocumentDirtyState {
  constructor(eventBus: EventBus) {
    super(eventBus);
  }

  override markDirty(reason?: string): void {
    super.markDirty(reason);
    if (isTauriRuntime()) getDesktopHost().markDocumentDirty();
  }

  override markClean(reason?: string): void {
    super.markClean(reason);
    if (!isTauriRuntime()) return;
    const host = getDesktopHost();
    if (reason === 'document-initialized') host.completePendingDocumentInitialization();
    host.syncDocumentTitle();
  }
}
