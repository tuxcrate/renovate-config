const assert = require('node:assert/strict');
const { test } = require('node:test');
const preset = require('../tuxcrate.json');

const rule = preset.packageRules[0];
const pattern = new RegExp(rule.versioning.slice('regex:'.length));

function parse(version) {
  const match = pattern.exec(version);
  assert.ok(match, version);
  return ['major', 'minor', 'patch', 'build', 'revision'].map((key) => Number(match.groups[key] ?? 0));
}

test('the tuxcrate preset only configures versioning for Tuxcrate Docker images', () => {
  assert.deepEqual(Object.keys(preset).sort(), ['$schema', 'description', 'packageRules']);
  assert.equal(preset.packageRules.length, 1);
  assert.deepEqual(Object.keys(rule).sort(), ['description', 'matchDatasources', 'matchPackageNames', 'versioning']);
  assert.deepEqual(rule.matchDatasources, ['docker']);
  assert.deepEqual(rule.matchPackageNames, ['ghcr.io/tuxcrate/**']);
});

test('the tuxcrate preset captures numeric application versions and image revisions', () => {
  assert.deepEqual(parse('1.32.17-r3'), [1, 32, 17, 0, 3]);
  assert.deepEqual(parse('0.7.0-r8'), [0, 7, 0, 0, 8]);
  assert.deepEqual(parse('4.0.20.3014-r10'), [4, 0, 20, 3014, 10]);
});

test('Tuxcrate versions sort by application version before numeric image revision', () => {
  for (const [older, newer] of [
    ['0.7.0-r8', '0.7.0-r9'],
    ['0.7.0-r9', '0.7.0-r10'],
    ['1.32.17-r10', '1.32.18-r0'],
    ['1.32.17-r10', '1.33.0-r0'],
    ['1.32.17-r10', '2.0.0-r0'],
    ['4.0.20.3014-r9', '4.0.20.3014-r10'],
    ['4.0.20.3014-r10', '4.0.20.3015-r0'],
  ]) {
    const left = parse(older);
    const right = parse(newer);
    const differingPart = left.findIndex((value, index) => value !== right[index]);
    assert.ok(differingPart >= 0 && left[differingPart] < right[differingPart], `${older} < ${newer}`);
  }
});

test('the tuxcrate preset excludes aliases, prereleases, and malformed revisions', () => {
  for (const version of [
    'latest', 'develop', '1', '1.32', '1.32.17', '4.0.20.3014',
    '1.32.17-rc1-r0', '1.32.17-r', '1.32.17-rx', '1.32.17-r-1',
    '1.32.17-r1-extra', '1.2.3.4.5-r0',
  ]) assert.equal(pattern.test(version), false, version);
});
