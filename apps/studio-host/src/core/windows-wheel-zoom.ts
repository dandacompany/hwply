type WheelDocument = Pick<Document, 'addEventListener' | 'removeEventListener' | 'getElementById'>;
type WheelEventFactory = (init: WheelEventInit) => WheelEvent;

export function installWindowsWheelZoomReroute(
  root: WheelDocument = document,
  createWheelEvent: WheelEventFactory = (init) => new WheelEvent('wheel', init),
): () => void {
  const reroutedEvents = new WeakSet<object>();
  const handler = ((event: WheelEvent) => {
    if (reroutedEvents.has(event) || (!event.ctrlKey && !event.metaKey)) return;
    const container = root.getElementById('scroll-container');
    if (!container) return;

    event.preventDefault();
    event.stopPropagation();
    const insideContainer = event.target
      ? container.contains(event.target as Node)
      : false;
    const rect = container.getBoundingClientRect();
    const rerouted = createWheelEvent({
      bubbles: true,
      cancelable: true,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      clientX: insideContainer ? event.clientX : rect.left + rect.width / 2,
      clientY: insideContainer ? event.clientY : rect.top + rect.height / 2,
    });
    reroutedEvents.add(rerouted);
    container.dispatchEvent(rerouted);
  }) as EventListener;

  root.addEventListener('wheel', handler, { capture: true, passive: false });
  return () => root.removeEventListener('wheel', handler, { capture: true });
}
