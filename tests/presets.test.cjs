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
});

test('the default preset automerges non-major updates through platform pull requests', () => {
  assert.equal(general.automergeType, 'pr');
  assert.equal(general.platformAutomerge, true);
  assert.equal(general.ignoreTests, undefined);
  assert.equal(general.packageRules.length, 2);
  const rule = general.packageRules[0];
  assert.deepEqual(rule.matchUpdateTypes, [
    'minor',
    'patch',
    'pin',
    'pinDigest',
    'digest',
    'lockFileMaintenance',
  ]);
  assert.equal(rule.automerge, true);
  // Include pre-1.0 dependencies and all packages, not per-repository allowlists.
  assert.equal(rule.matchCurrentVersion, undefined);
  assert.equal(rule.matchPackageNames, undefined);
});

test('the default preset assigns only major updates for review', () => {
  assert.equal(general.assignees, undefined);
  const rules = general.packageRules.filter((rule) => rule.assignees !== undefined);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].matchUpdateTypes, ['major']);
  assert.deepEqual(rules[0].assignees, ['Skaronator']);
  assert.equal(rules[0].automerge, undefined);
});

test('the images preset retains the inherited automerge policy', () => {
  assert.equal(images.automerge, undefined);
  assert.ok(images.packageRules.every((rule) => rule.automerge === undefined));
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
