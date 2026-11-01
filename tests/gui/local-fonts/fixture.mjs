import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const root = new URL('./', import.meta.url);
export async function verifyFixtures() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!['Abel-Regular.ttf', 'OFL.txt', 'abel.hwp', 'abel.hwpx'].includes(name)) throw new Error('unknown fixture');
    const bytes = await readFile(new URL(name, root));
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('fixture hash mismatch');
  }
  return manifest;
}

export function supportedFontRoot({ platform = process.platform, home, localAppData }) {
  const base = platform === 'linux' ? home : platform === 'win32' ? localAppData : null;
  if (!base || !isAbsolute(base)) throw new Error('Windows/Linux의 격리된 사용자 root가 필요합니다');
  return platform === 'linux' ? join(base, '.local/share/fonts') : join(base, 'Microsoft/Windows/Fonts');
}

// Call only in an isolated Windows/Linux acceptance account. Never overwrite or
// remove an existing font: cleanup owns only its newly created unique directory.
export async function installFixtureFont(environment) {
  await verifyFixtures();
  const fontRoot = supportedFontRoot(environment);
  await mkdir(fontRoot, { recursive: true });
  const directory = await mkdtemp(join(fontRoot, 'hwply-task74-'));
  const path = join(directory, 'Abel-Regular.ttf');
  try { await copyFile(new URL('Abel-Regular.ttf', root), path, constants.COPYFILE_EXCL); }
  catch (error) { await rm(directory, { recursive: true }); throw error; }
  return { path, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

// Recording evidence cannot confer acceptance. Stage 4 must review paired
// fallback/local screenshots and metrics for each real renderer and scenario.
export async function recordObservation(observation) {
  const manifest = await verifyFixtures();
  if (!['windows', 'linux'].includes(observation.os)
    || !['canvas2d', 'svg', 'canvaskit'].includes(observation.renderer)
    || !/^[a-f0-9]{40}$/.test(observation.sourceSha)
    || !['hwp', 'hwpx'].includes(observation.format)) throw new Error('invalid observation context');
  return {
    schemaVersion: 1, acceptance: 'unverified', fixtureHashes: manifest.files,
    sourceSha: observation.sourceSha, os: observation.os, renderer: observation.renderer,
    format: observation.format, scenario: observation.scenario,
    detected: observation.detected === true, supplied: observation.supplied === true,
    registered: observation.registered === true, originalFontPreserved: observation.originalFontPreserved === true,
    fallbackWidth: observation.fallbackWidth ?? null, localWidth: observation.localWidth ?? null,
    screenshots: observation.screenshots ?? [],
  };
}
