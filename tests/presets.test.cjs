const assert = require('node:assert/strict');
const { test } = require('node:test');
const general = require('../default.json');
const images = require('../images.json');
const repository = require('../renovate.json');

test('the default preset contains only general repository policy', () => {
  assert.deepEqual(general.extends, [
    'config:recommended',
    ':disableRateLimiting',
    'helpers:pinGitHubActionDigests',
  ]);
  assert.equal(general.automerge, false);
  assert.equal(general.customManagers, undefined);
  assert.equal(general.packageRules, undefined);
});

test('the opt-in images preset inherits general policy and adds container rules', () => {
  assert.deepEqual(images.extends, ['github>tuxcrate/renovate-config']);
  assert.ok(images.customManagers.some((m) => m.customType === 'jsonata'));
  assert.ok(images.packageRules.some((r) => r.matchDatasources?.includes('docker') && r.pinDigests));
  assert.ok(images.packageRules.some((r) => r.matchPackageNames?.includes('tuxcrate/github-actions') && r.pinDigests === false));
});

test('only the repository config opts the Renovate image out of pinning', () => {
  assert.deepEqual(repository.extends, ['github>tuxcrate/renovate-config']);
  assert.equal(repository.packageRules.length, 1);
  const rule = repository.packageRules[0];
  assert.deepEqual(rule.matchDatasources, ['docker']);
  assert.deepEqual(rule.matchPackageNames, ['ghcr.io/renovatebot/renovate']);
  assert.equal(rule.pinDigests, false);
  assert.equal(rule.rangeStrategy, 'replace');
  assert.equal(rule.enabled, undefined);
});
