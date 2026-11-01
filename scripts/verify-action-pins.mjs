import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isScalar, parseDocument, visit } from 'yaml';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const commitPattern = /^[0-9a-f]{40}$/;

export function validatePinInventory(inventory) {
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.pins) || !inventory.pins.length) {
    throw new Error('Action pin inventory schema is invalid');
  }
  const pins = new Map();
  for (const pin of inventory.pins) {
    if (!/^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?$/.test(pin.action)
      || !commitPattern.test(pin.sha) || typeof pin.version !== 'string'
      || !/^(v\d+\.\d+\.\d+|stable)$/.test(pin.version)) {
      throw new Error(`Invalid Action identity: ${pin.action}`);
    }
    const repository = pin.action.split('/').slice(0, 2).join('/');
    const stable = pin.version === 'stable';
    const expectedRef = `${stable ? 'refs/heads/' : 'refs/tags/'}${pin.version}`;
    const expectedUrl = `https://github.com/${repository}/${stable ? `tree/${pin.sha}` : `releases/tag/${pin.version}`}`;
    if (pin.sourceRef !== expectedRef || pin.sourceUrl !== expectedUrl || !pin.risk) {
      throw new Error(`Missing or inconsistent Action provenance: ${pin.action}`);
    }
    if (pins.has(pin.action)) throw new Error(`Duplicate Action pin: ${pin.action}`);
    pins.set(pin.action, pin);
  }
  return pins;
}

export function inspectActionSource(source, pins, file = 'workflow.yml') {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${file}: invalid YAML: ${document.errors[0].message}`);
  let count = 0;
  visit(document, {
    Pair(_key, pair) {
      if (!isScalar(pair.key) || pair.key.value !== 'uses') return;
      const value = pair.value;
      if (!isScalar(value) || typeof value.value !== 'string') {
        throw new Error(`${file}: uses must be a literal string`);
      }
      const reference = value.value;
      if (reference.startsWith('./')) {
        if (reference.includes('..') || reference.includes('@')) throw new Error(`${file}: invalid local uses`);
        return;
      }
      const match = /^([^@\s]+)@([0-9a-f]{40})$/.exec(reference);
      if (!match) throw new Error(`${file}: immutable full SHA required: ${reference}`);
      const pin = pins.get(match[1]);
      if (!pin || pin.sha !== match[2]) throw new Error(`${file}: unreviewed Action pin: ${reference}`);
      if (value.comment?.trim() !== pin.version) throw new Error(`${file}: version comment required: ${pin.version}`);
      count += 1;
    },
  });
  return count;
}

async function yamlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return yamlFiles(path);
    if (entry.isSymbolicLink()) throw new Error(`Workflow/action symlink is unsupported: ${path}`);
    return /\.ya?ml$/.test(entry.name) ? [path] : [];
  }));
  return files.flat();
}

export async function verifyActionPins(root = repoRoot) {
  const inventory = JSON.parse(await readFile(resolve(root, '.github/action-pins.json'), 'utf8'));
  const pins = validatePinInventory(inventory);
  // .github/actions(복합 액션)는 없을 수 있다 — 없으면 건너뛴다.
  const files = (await Promise.all(['workflows', 'actions'].map(
    (part) => yamlFiles(resolve(root, '.github', part)).catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }),
  ))).flat();
  let references = 0;
  for (const file of files) references += inspectActionSource(await readFile(file, 'utf8'), pins, file);
  if (!references) throw new Error('No external Action references inspected');
  return { files: files.length, references, pins: pins.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Action pins verified: ${JSON.stringify(await verifyActionPins())}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
