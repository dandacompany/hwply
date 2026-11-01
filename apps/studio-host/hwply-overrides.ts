import { resolve } from 'node:path';

export type HwplyOverrideOwner =
  | 'native-host'
  | 'font-policy'
  | 'product-ux'
  | 'legacy-upstream-copy';

export type HwplyOverrideDisposition =
  | 'retain-leaf-adapter'
  | 'replace-with-leaf-adapter'
  | 'remove-shadow';

export type HwplyOverrideStage = 2 | 3 | 4;

export interface HwplyOverrideSpec {
  id: string;
  replacementId?: string;
  owner: HwplyOverrideOwner;
  targetDisposition: HwplyOverrideDisposition;
  transitionStage: HwplyOverrideStage;
  removalStage: HwplyOverrideStage | null;
}

export const hwplyOverrideSpecs = [
  {
    id: 'core/font-loader', owner: 'font-policy',
    targetDisposition: 'replace-with-leaf-adapter', transitionStage: 3, removalStage: null,
  },
  {
    id: 'core/local-fonts', owner: 'font-policy',
    targetDisposition: 'replace-with-leaf-adapter', transitionStage: 3, removalStage: null,
  },
  {
    id: 'core/wasm-bridge', replacementId: 'core/font-policy-wasm-bridge', owner: 'font-policy',
    targetDisposition: 'retain-leaf-adapter', transitionStage: 3, removalStage: null,
  },
  {
    id: 'core/document-files', owner: 'native-host',
    targetDisposition: 'retain-leaf-adapter', transitionStage: 3, removalStage: null,
  },
  {
    id: 'core/document-dirty-state', owner: 'native-host',
    targetDisposition: 'retain-leaf-adapter', transitionStage: 3, removalStage: null,
  },
  {
    id: 'core/desktop-events', owner: 'native-host',
    targetDisposition: 'replace-with-leaf-adapter', transitionStage: 3, removalStage: null,
  },
  {
    id: 'core/platform', owner: 'native-host',
    targetDisposition: 'retain-leaf-adapter', transitionStage: 3, removalStage: null,
  },
  {
    id: 'command/dispatcher', owner: 'native-host',
    targetDisposition: 'retain-leaf-adapter', transitionStage: 3, removalStage: null,
  },
  {
    id: 'command/commands/file', owner: 'native-host',
    targetDisposition: 'replace-with-leaf-adapter', transitionStage: 4, removalStage: null,
  },
  {
    id: 'embed/runtime', replacementId: 'embed/desktop-runtime', owner: 'native-host',
    targetDisposition: 'retain-leaf-adapter', transitionStage: 2, removalStage: null,
  },
  {
    id: 'ui/about-dialog', owner: 'product-ux',
    targetDisposition: 'retain-leaf-adapter', transitionStage: 2, removalStage: null,
  },
  {
    id: 'recent/recent-store', owner: 'native-host',
    targetDisposition: 'retain-leaf-adapter', transitionStage: 3, removalStage: null,
  },
] as const satisfies readonly HwplyOverrideSpec[];

export const finalForbiddenStudioEntryPaths = [
  'index.html',
  'src/main.ts',
] as const;

export const finalForbiddenOverrideIds = (hwplyOverrideSpecs as readonly HwplyOverrideSpec[])
  .filter((spec) => spec.targetDisposition === 'remove-shadow')
  .map((spec) => spec.id);

export function createHwplyOverrides(hwplySrc: string) {
  return hwplyOverrideSpecs.map(({ id, replacementId }: HwplyOverrideSpec) => ({
    find: `@/${id}`,
    replacement: resolve(hwplySrc, replacementId ?? id),
  }));
}
