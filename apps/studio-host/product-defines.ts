import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 빌드 시점 제품 상수: 앱 버전(tauri.conf.json)과 번들된 rhwp 태그·커밋(rhwp-core.lock). */
export function createProductDefines(hostDir: string): Record<string, string> {
  const lock = readFileSync(resolve(hostDir, '../../rhwp-core.lock'), 'utf8');
  const tag = /^rhwp_release_tag = "(.*)"\r?$/m.exec(lock)?.[1] ?? '';
  const commit = /^rhwp_commit = "(.*)"\r?$/m.exec(lock)?.[1] ?? '';
  const desktop = JSON.parse(readFileSync(resolve(hostDir, '../desktop/src-tauri/tauri.conf.json'), 'utf8')) as { version: string };
  return {
    __HWPLY_VERSION__: JSON.stringify(desktop.version),
    __HWPLY_RHWP_TAG__: JSON.stringify(tag),
    __HWPLY_RHWP_COMMIT__: JSON.stringify(commit),
  };
}
