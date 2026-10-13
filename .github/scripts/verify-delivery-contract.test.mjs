import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const command = fileURLToPath(new URL('./verify-delivery-contract.mjs', import.meta.url));

function check(body, base = 'main', enforce = 'true') {
  const { status, stdout, stderr } = spawnSync(process.execPath, [command], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PR_BODY: body,
      PR_BASE: base,
      DELIVERY_METADATA_ENFORCE: enforce,
      GITHUB_STEP_SUMMARY: '',
    },
  });
  assert.equal(stderr, '');
  return { status, stdout };
}

const metadata = (overrides = {}) => Object.entries({
  'Delivery target': 'main',
  'Odelco impact': 'yes',
  'Backport plan': 'https://github.com/HDNG-AI/odelco-storefront/issues/26',
  'Database migration': 'no',
  'External integration': 'no',
  'Verification owner': 'release-owner',
  ...overrides,
}).map(([name, value]) => name + ': ' + value).join('\n');

test('main changes with a tracked Odelco backport pass', () => {
  const result = check(metadata());
  assert.equal(result.status, 0);
  assert.match(result.stdout, /All metadata checks passed/);
});

test('main changes without a backport disposition fail in strict mode', () => {
  const result = check(metadata({ 'Backport plan': 'none' }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /requires a staging issue/);
});

test('staging changes explicitly routed to staging pass', () => {
  const result = check(metadata({
    'Delivery target': 'odelco-staging',
    'Backport plan': 'direct-to-staging',
  }), 'odelco-staging');
  assert.equal(result.status, 0);
});

test('missing declarations warn but do not fail during advisory rollout', () => {
  const result = check('', 'main', 'false');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Missing: Delivery target/);
});

test('missing declarations fail when enforcement is enabled', () => {
  assert.equal(check('', 'main', 'true').status, 1);
});

test('different declared delivery target and actual PR base fail in strict mode', () => {
  const result = check(metadata({'Delivery target': 'production'}));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /must equal PR base/);
});
