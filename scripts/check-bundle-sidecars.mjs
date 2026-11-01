#!/usr/bin/env node
// 번들에 사이드카(hwply-cli·rhwp)와 skill 이 들어갔는지 확인한다.
//   macOS : node scripts/check-bundle-sidecars.mjs --app <hwply.app>
//   Windows: node scripts/check-bundle-sidecars.mjs --dir <target/…/debug|release>  (Tauri 가 사이드카를 실행 파일 옆에 둔다)

import { accessSync, constants, existsSync } from 'node:fs';
import { join } from 'node:path';

const [flag, root] = process.argv.slice(2);
let required;
if (flag === '--app') {
  required = [
    ['Contents/MacOS/hwply', true],
    ['Contents/MacOS/hwply-cli', true],
    ['Contents/MacOS/rhwp', true],
    ['Contents/Resources/skill/hwply/SKILL.md', false],
  ];
} else if (flag === '--dir') {
  required = [['hwply.exe', false], ['hwply-cli.exe', false], ['rhwp.exe', false]];
} else {
  console.error('사용법: --app <hwply.app> | --dir <대상 폴더>');
  process.exit(2);
}

const missing = [];
for (const [rel, executable] of required) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    missing.push(rel);
    continue;
  }
  if (executable) {
    try {
      accessSync(path, constants.X_OK);
    } catch {
      missing.push(`${rel} (실행 권한 없음)`);
    }
  }
}
if (missing.length > 0) {
  console.error(`번들에 빠진 것: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`bundle sidecars ok: ${root}`);
