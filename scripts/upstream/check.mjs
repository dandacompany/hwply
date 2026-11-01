// 상류 rhwp 소스(서브모듈)가 있는지 검사한다. 없으면 vite 의 알 수 없는 오류 대신 init.sh 안내로 멈춘다.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.HWPLY_ROOT ?? resolve(fileURLToPath(import.meta.url), '../../..');
const required = ['third_party/rhwp/rhwp-studio/index.html', 'third_party/rhwp/rhwp-studio/src/main.ts'];
const missing = required.filter((p) => !existsSync(resolve(root, p)));
if (missing.length > 0) {
  console.error(`상류 rhwp 소스가 없습니다 (${missing.join(', ')}). scripts/upstream/init.sh 를 먼저 실행하세요.`);
  process.exit(1);
}
