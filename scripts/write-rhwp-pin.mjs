#!/usr/bin/env node

import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  createRhwpPinData,
  serializeRhwpPin,
} from './verify-rhwp-pin.mjs';

export async function writeRhwpPin({
  repoRoot,
  releaseTag,
  commit,
  wasmPackVersion,
  cliSums,
}) {
  const pin = await createRhwpPinData({
    repoRoot,
    releaseTag,
    commit,
    wasmPackVersion,
    cliSums,
  });
  const lockPath = resolve(repoRoot, 'rhwp-core.lock');
  const temporaryPath = resolve(repoRoot, `.rhwp-core.lock.${process.pid}.tmp`);

  try {
    await writeFile(temporaryPath, serializeRhwpPin(pin), {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporaryPath, lockPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  return pin;
}

function parseArguments(args) {
  const values = {
    releaseTag: '',
    commit: '',
    wasmPackVersion: '',
    cliSumsFile: '',
  };
  const options = new Map([
    ['--tag', 'releaseTag'],
    ['--commit', 'commit'],
    ['--wasm-pack-version', 'wasmPackVersion'],
    ['--cli-sums', 'cliSumsFile'],
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const key = options.get(option);
    if (!key) {
      throw new Error(`알 수 없는 option입니다: ${option}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${option}에는 value가 필요합니다.`);
    }
    if (values[key] !== '') {
      throw new Error(`${option}은 한 번만 지정할 수 있습니다.`);
    }
    values[key] = value;
    index += 1;
  }

  for (const [option, key] of options) {
    if (values[key] === '') {
      throw new Error(`${option}이 필요합니다.`);
    }
  }
  return values;
}

function git(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 실패: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

async function main() {
  const { cliSumsFile, ...options } = parseArguments(process.argv.slice(2));
  const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd());
  const cliSums = await readFile(resolve(cliSumsFile), 'utf8');
  const pin = await writeRhwpPin({ repoRoot, ...options, cliSums });
  console.log(
    `rhwp-core.lock written: ${pin.rhwp_release_tag} (${pin.rhwp_commit}), ${pin.artifacts.length} artifacts`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`rhwp pin write failed: ${error.message}`);
    process.exitCode = 1;
  });
}
