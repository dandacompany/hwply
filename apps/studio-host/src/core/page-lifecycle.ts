type Disposer = () => void;

export function installPageHideCleanup(dispose: Disposer): Disposer {
  if (typeof window === 'undefined') return () => {};
  const target = window;
  let installed = true;
  const handlePageHide = () => {
    if (!installed) return;
    installed = false;
    target.removeEventListener('pagehide', handlePageHide);
    dispose();
  };
  target.addEventListener('pagehide', handlePageHide, { once: true });
  return () => {
    if (!installed) return;
    installed = false;
    target.removeEventListener('pagehide', handlePageHide);
  };
}
