import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
// 원본: hwply-icon.svg(여백 없음 — PNG·ICO·창·파비콘), hwply-icon-macos.svg(Apple 아이콘 격자 — icns).
const sourceLogo = join(root, 'assets/logo/hwply-icon.svg');
const sourceMacos = join(root, 'assets/logo/hwply-icon-macos.svg');
const logoDir = join(root, 'assets/logo');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const pngTargets = [
  ['logo-16.png', 16],
  ['logo-32.png', 32],
  ['logo-48.png', 48],
  ['logo-128.png', 128],
  ['logo-256.png', 256],
  ['logo-300.png', 300],
  ['logo-512.png', 512],
  ['logo-1024.png', 1024],
];

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function generatePngs() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hwply-icons-'));
  const iconArgs = pngTargets.flatMap(([, size]) => ['--png', String(size)]);

  try {
    run(pnpmCommand, [
      '--filter',
      'hwply-desktop',
      'tauri',
      'icon',
      sourceLogo,
      '--output',
      tempRoot,
      ...iconArgs,
    ]);
    for (const [name, size] of pngTargets) {
      copyFileSync(join(tempRoot, `${size}x${size}.png`), join(logoDir, name));
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function generateIcns() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hwply-icns-'));
  try {
    run(pnpmCommand, ['--filter', 'hwply-desktop', 'tauri', 'icon', sourceMacos, '--output', tempRoot]);
    copyFileSync(join(tempRoot, 'icon.icns'), join(logoDir, 'hwply.icns'));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeIco(outPath, pngPaths) {
  const headerSize = 6;
  const entrySize = 16;
  const count = pngPaths.length;
  const images = pngPaths.map(path => readFileSync(path));
  const header = Buffer.alloc(headerSize + entrySize * count);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let offset = header.length;
  pngPaths.forEach((path, index) => {
    const image = images[index];
    const size = Number(path.match(/(\d+)\.png$/)?.[1] ?? 0);
    const entry = headerSize + entrySize * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });

  writeFileSync(outPath, Buffer.concat([header, ...images]));
}

function copyIfPresent(from, to) {
  if (!existsSync(resolve(to, '..'))) return;
  copyFileSync(from, to);
}

mkdirSync(logoDir, { recursive: true });
generatePngs();
generateIcns();
writeIco(join(logoDir, 'favicon.ico'), [16, 32, 48, 256].map(size => join(logoDir, `logo-${size}.png`)));

copyFileSync(join(logoDir, 'favicon.ico'), join(root, 'apps/studio-host/public/favicon.ico'));
copyIfPresent(join(logoDir, 'favicon.ico'), join(root, 'apps/studio-host/dist/favicon.ico'));

console.log('Generated app icons (PNG, ICO, ICNS) from assets/logo/hwply-icon*.svg');
