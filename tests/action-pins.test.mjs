import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inspectActionSource, validatePinInventory, verifyActionPins } from '../scripts/verify-action-pins.mjs';

const inventory = JSON.parse(await readFile(new URL('../.github/action-pins.json', import.meta.url), 'utf8'));
const pins = validatePinInventory(inventory);
const pin = inventory.pins.find((entry) => entry.action === 'actions/checkout');
const reference = `${pin.action}@${pin.sha}`;

test('all tracked workflows and nested composite actions use reviewed immutable pins', async () => {
  const result = await verifyActionPins();
  assert.ok(result.references >= 152);
  assert.equal(result.pins, 11);
});

for (const ref of ['actions/checkout@v7', 'actions/checkout@main', 'actions/checkout@latest',
  'actions/checkout@1234567', 'actions/checkout@${{ inputs.ref }}',
  'docker://alpine:latest', `docker://alpine@sha256:${'a'.repeat(64)}`]) {
  test(`rejects mutable or unreviewed reference ${ref}`, () => {
    assert.throws(() => inspectActionSource(`steps:\n  - uses: '${ref}'\n`, pins), /SHA required/);
  });
}

test('quoted YAML keys and flow syntax cannot bypass SHA validation', () => {
  for (const source of ['steps: [{ "uses": "actions/checkout@v7" }]',
    "steps:\n  - 'uses': actions/checkout@main\n"]) {
    assert.throws(() => inspectActionSource(source, pins), /SHA required/);
  }
  assert.equal(inspectActionSource(`steps:\n  - "uses": '${reference}' # ${pin.version}\n`, pins), 1);
});

test('rejects unknown SHA, missing version and misleading version comments', () => {
  assert.throws(() => inspectActionSource(`uses: ${pin.action}@${'0'.repeat(40)} # ${pin.version}`, pins), /unreviewed/);
  for (const suffix of ['', ' # v1.0.0']) {
    assert.throws(() => inspectActionSource(`uses: ${reference}${suffix}`, pins), /version comment/);
  }
});

test('external reusable workflows and composite steps are inspected', () => {
  const workflow = 'example/ci/.github/workflows/check.yml';
  const extra = new Map(pins);
  extra.set(workflow, { ...pin, action: workflow });
  assert.equal(inspectActionSource(`jobs:\n  check:\n    uses: ${workflow}@${pin.sha} # ${pin.version}`, extra), 1);
  assert.throws(() => inspectActionSource(`runs:\n  using: composite\n  steps:\n    - uses: ${workflow}@main`, extra), /SHA required/);
});

test('local actions remain local and script text is not interpreted as YAML uses', () => {
  assert.equal(inspectActionSource('steps:\n  - uses: ./.github/actions/cargo-cache\n  - run: |\n      echo "uses: actions/checkout@main"\n', pins), 0);
  assert.throws(() => inspectActionSource('uses: ./../outside', pins), /invalid local/);
});

test('duplicate keys, aliases and non-string uses fail closed', () => {
  for (const source of ['uses: a\nuses: b', 'pin: &pin 123\nuses: *pin', 'uses: [a, b]']) {
    assert.throws(() => inspectActionSource(source, pins), /invalid YAML|literal string/);
  }
});

test('inventory rejects duplicate identities and altered provenance', () => {
  assert.throws(() => validatePinInventory({ ...inventory, pins: [...inventory.pins, pin] }), /Duplicate/);
  for (const patch of [{ sha: 'main' }, { sourceRef: 'refs/heads/main' }, { sourceUrl: 'https://example.com' }]) {
    assert.throws(() => validatePinInventory({ ...inventory, pins: [{ ...pin, ...patch }] }), /identity|provenance/);
  }
});
