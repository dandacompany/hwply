import type { EventBus } from '@upstream/core/event-bus';

type HeaderFooterMode = 'none' | 'header' | 'footer';
type ScheduleRender = (callback: () => void) => void;

export const DESKTOP_TOOLBAR_READY_CLASS = 'hwply-toolbar-ready';
export const DESKTOP_TOOLBAR_HIDDEN_CLASS = 'hwply-toolbar-hidden';
export const DESKTOP_CSP_INLINE_HIDDEN_SELECTORS = [
  '.tb-rotate-group',
  '.tb-headerfooter-group',
  '.tb-note-group',
  '#file-input',
  '#sb-field',
] as const;

export interface ToolbarModeElements {
  rootElement: HTMLElement | null;
  rotateGroup: HTMLElement | null;
  headerFooterGroup: HTMLElement | null;
  headerFooterLabel: HTMLElement | null;
  noteGroup: HTMLElement | null;
  defaultGroups: HTMLElement[];
  scrollContainer: HTMLElement | null;
}

interface ToolbarModeState {
  pictureSelected: boolean;
  headerFooterMode: HeaderFooterMode;
  noteActive: boolean;
}

export function installDesktopToolbarModeSync(
  eventBus: EventBus,
  root: Document = document,
  scheduleRender: ScheduleRender = queueMicrotask,
): () => void {
  return installToolbarModeSync(eventBus, collectElements(root), scheduleRender);
}

export function installToolbarModeSync(
  eventBus: EventBus,
  elements: ToolbarModeElements,
  scheduleRender: ScheduleRender = queueMicrotask,
): () => void {
  const state: ToolbarModeState = {
    pictureSelected: false,
    headerFooterMode: 'none',
    noteActive: false,
  };
  let renderPending = false;
  let disposed = false;

  const requestRender = () => {
    if (disposed || renderPending) return;
    renderPending = true;
    scheduleRender(() => {
      renderPending = false;
      if (disposed) return;
      renderToolbarMode(elements, state);
    });
  };

  const unsubscribers = [
    eventBus.on('picture-object-selection-changed', (selected) => {
      state.pictureSelected = selected === true;
      requestRender();
    }),
    eventBus.on('headerFooterModeChanged', (mode) => {
      state.headerFooterMode = toHeaderFooterMode(mode);
      if (state.headerFooterMode !== 'none') state.noteActive = false;
      requestRender();
    }),
    eventBus.on('footnoteModeChanged', (active) => {
      state.noteActive = active === true;
      if (state.noteActive) state.headerFooterMode = 'none';
      requestRender();
    }),
  ];

  renderToolbarMode(elements, state);
  elements.rootElement?.classList.add(DESKTOP_TOOLBAR_READY_CLASS);
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    elements.rootElement?.classList.remove(DESKTOP_TOOLBAR_READY_CLASS);
    managedElements(elements).forEach((element) => {
      element?.classList.remove(DESKTOP_TOOLBAR_HIDDEN_CLASS);
    });
  };
}

function collectElements(root: Document): ToolbarModeElements {
  const headerFooterGroup = root.querySelector<HTMLElement>('.tb-headerfooter-group');
  return {
    rootElement: root.documentElement,
    rotateGroup: root.querySelector<HTMLElement>('.tb-rotate-group'),
    headerFooterGroup,
    headerFooterLabel: headerFooterGroup?.querySelector<HTMLElement>('.tb-hf-label') ?? null,
    noteGroup: root.querySelector<HTMLElement>('.tb-note-group'),
    defaultGroups: Array.from(root.querySelectorAll<HTMLElement>(
      '#icon-toolbar > .tb-group:not(.tb-headerfooter-group):not(.tb-note-group):not(.tb-rotate-group), #icon-toolbar > .tb-sep',
    )),
    scrollContainer: root.getElementById('scroll-container'),
  };
}

function renderToolbarMode(elements: ToolbarModeElements, state: ToolbarModeState): void {
  const noteVisible = state.noteActive;
  const headerFooterVisible = !noteVisible && state.headerFooterMode !== 'none';
  const defaultVisible = !noteVisible && !headerFooterVisible;

  setVisible(elements.noteGroup, noteVisible);
  setVisible(elements.headerFooterGroup, headerFooterVisible);
  setVisible(elements.rotateGroup, state.pictureSelected && !noteVisible);
  elements.defaultGroups.forEach((element) => setVisible(element, defaultVisible));

  if (elements.headerFooterLabel) {
    elements.headerFooterLabel.textContent = headerFooterVisible
      ? state.headerFooterMode === 'header' ? '머리말' : '꼬리말'
      : '';
  }
  elements.scrollContainer?.classList.toggle('hf-editing', headerFooterVisible);
}

function setVisible(element: HTMLElement | null, visible: boolean): void {
  if (!element) return;
  element.classList.toggle(DESKTOP_TOOLBAR_HIDDEN_CLASS, !visible);
  if (visible) {
    element.hidden = false;
    element.style.removeProperty('display');
  }
}

function managedElements(elements: ToolbarModeElements): Array<HTMLElement | null> {
  return [
    elements.rotateGroup,
    elements.headerFooterGroup,
    elements.noteGroup,
    ...elements.defaultGroups,
  ];
}

function toHeaderFooterMode(mode: unknown): HeaderFooterMode {
  return mode === 'header' || mode === 'footer' ? mode : 'none';
}
