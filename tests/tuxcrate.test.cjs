const assert = require('node:assert/strict');
const { test } = require('node:test');
const preset = require('../tuxcrate.json');

// Exercise Renovate's actual comparison and compatibility behavior in the CI image.
const versioningModule = import('/usr/local/renovate/dist/modules/versioning/regex/index.js');

function rulesFor(currentValue) {
  return preset.packageRules.filter((rule) => new RegExp(rule.matchCurrentValue.slice(1, -1)).test(currentValue));
}

async function versioningFor(currentValue) {
  const rules = rulesFor(currentValue);
  assert.equal(rules.length, 1, currentValue);
  const { api: RegexVersioning } = await versioningModule;
  return new RegexVersioning(rules[0].versioning.slice('regex:'.length));
}

test('the tuxcrate preset only configures versioning for Tuxcrate Docker images', () => {
  assert.deepEqual(Object.keys(preset).sort(), ['$schema', 'description', 'packageRules']);
  assert.equal(preset.packageRules.length, 4);
  for (const rule of preset.packageRules) {
    assert.deepEqual(Object.keys(rule).sort(), ['description', 'matchCurrentValue', 'matchDatasources', 'matchPackageNames', 'versioning']);
    assert.deepEqual(rule.matchDatasources, ['docker']);
    assert.deepEqual(rule.matchPackageNames, ['ghcr.io/tuxcrate/**']);
  }
});

test('supports numeric aliases, exact application versions, and immutable revisions on both channels', async () => {
  for (const version of ['6', '6.4', '1.32.17', '6.4.4.10684']) {
    for (const channel of ['', '-prerelease']) {
      for (const revision of version.split('.').length >= 3 ? ['', '-r0', '-r10'] : ['']) {
        const tag = `${version}${channel}${revision}`;
        const api = await versioningFor(tag);
        assert.ok(api.isVersion(tag), tag);
        // The channel is compatibility, not an unstable version that Renovate skips.
        assert.ok(api.isStable(tag), tag);
      }
    }
  }
});

test('Tuxcrate versions sort by application version before numeric image revision', async () => {
  for (const [older, newer] of [
    ['6', '7'],
    ['6.4', '6.5'],
    ['0.7.0-r8', '0.7.0-r9'],
    ['0.7.0-r9', '0.7.0-r10'],
    ['1.32.17-r10', '1.32.18-r0'],
    ['1.32.17-r10', '1.33.0-r0'],
    ['1.32.17-r10', '2.0.0-r0'],
    ['4.0.20.3014-r9', '4.0.20.3014-r10'],
    ['4.0.20.3014-r10', '4.0.20.3015-r0'],
  ]) {
    for (const channel of ['', '-prerelease']) {
      const withChannel = (tag) => tag.replace(/(-r\d+)?$/, `${channel}$1`);
      const current = withChannel(older);
      const candidate = withChannel(newer);
      const api = await versioningFor(current);
      assert.ok(api.isCompatible(candidate, current), `${current} -> ${candidate}`);
      assert.ok(api.isGreaterThan(candidate, current), `${current} < ${candidate}`);
    }
  }
});

test('stable and prerelease tags never switch channels, even when stable is newer', async () => {
  for (const [prerelease, stable] of [
    ['6-prerelease', '7'],
    ['6.4-prerelease', '6.5'],
    ['1.32.17-prerelease-r0', '1.32.18-r0'],
    ['6.4.4.10684-prerelease-r0', '6.4.4.10685-r0'],
    ['5.0.0.2668-prerelease', '5.0.0.2669'],
  ]) {
    const prereleaseApi = await versioningFor(prerelease);
    assert.equal(prereleaseApi.isCompatible(stable, prerelease), false);
    const stableApi = await versioningFor(stable);
    assert.equal(stableApi.isCompatible(prerelease, stable), false);
  }
});

test('updates retain the number of application version components', async () => {
  const tags = ['6', '6.4', '6.4.4', '6.4.4.10684'];
  for (const channel of ['', '-prerelease']) {
    for (const current of tags) {
      const api = await versioningFor(`${current}${channel}`);
      for (const candidate of tags) {
        assert.equal(api.isVersion(`${candidate}${channel}`), candidate === current);
      }
    }
  }
});

test('the tuxcrate preset excludes named aliases, unsupported suffixes, and malformed revisions', async () => {
  for (const version of [
    'latest', 'stable', 'develop', 'prerelease', '1-rc1', '1.32-preview',
    '1.32.17-rc1-r0', '1.32.17-r', '1.32.17-rx', '1.32.17-r-1',
    '1.32.17-r1-extra', '1.32.17-r0-prerelease', '1.2.3.4.5-r0',
    '6-prerelease-r0', '6.4-prerelease-r0',
  ]) {
    assert.equal(rulesFor(version).length, 0, version);
    for (const rule of preset.packageRules) {
      const { api: RegexVersioning } = await versioningModule;
      const api = new RegexVersioning(rule.versioning.slice('regex:'.length));
      assert.equal(api.isVersion(version), false, version);
    }
  }
});
