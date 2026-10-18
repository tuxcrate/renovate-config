const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const requireRenovate = createRequire('/usr/local/renovate/package.json');
const jsonata = requireRenovate('jsonata');
const YAML = requireRenovate('yaml');
const preset = require('../images.json');

const manager = preset.customManagers.find((m) => !m.datasourceTemplate);
const upstream = { datasource: 'pypi', depName: 'gallery-dl', version: '1.32.16' };

async function extract(content) {
  const documents = YAML.parseAllDocuments(content).map((d) => d.toJSON());
  const result = await jsonata(manager.matchStrings[0]).evaluate(documents);
  const deps = result === undefined ? [] : Array.isArray(result) ? [...result] : [result];
  return deps.map((dep) => ({ ...dep }));
}

test('PyPI manager discovers structured upstream versions without requiring a registry URL', async () => {
  assert.equal(manager.fileFormat, 'yaml');
  assert.equal(preset.packageRules.find((r) => r.matchDatasources?.includes('pypi')).versioning, 'pep440');
  assert.deepEqual(await extract(YAML.stringify({ tracks: [{ upstream }] })), [
    { datasource: 'pypi', depName: 'gallery-dl', currentValue: '1.32.16' },
  ]);
});

test('PyPI metadata is independent of YAML formatting and preserves optional registry URLs', async () => {
  const registryUrl = 'https://pypi.org/simple';
  const expected = [{ datasource: 'pypi', depName: 'gallery-dl', registryUrl, currentValue: '1.32.16' }];
  for (const content of [
    YAML.stringify({ tracks: [{ upstream: { ...upstream, registryUrl } }] }, { collectionStyle: 'flow' }),
    `# comment\ntracks:\n- upstream:\n    version: '1.32.16' # exact PyPI pin\n    registryUrl: ${registryUrl}\n    depName: gallery-dl\n    datasource: pypi\n`.replaceAll('\n', '\r\n'),
  ]) assert.deepEqual(await extract(content), expected);
});

test('upstream discovery handles mixed datasources without extracting unannotated tracks', async () => {
  const content = YAML.stringify({ tracks: [
    { upstream },
    { upstream: { ...upstream, depName: 'other-package', version: '2.3.4' } },
    { upstream: { datasource: 'deb', depName: 'zrepl', version: '0.7.0-1' } },
    { version: '1.2.3' },
    { upstream: { datasource: 'pypi', depName: 'missing-pin' } },
  ] });
  assert.deepEqual((await extract(content)).map((d) => [d.depName, d.currentValue]), [
    ['gallery-dl', '1.32.16'], ['other-package', '2.3.4'], ['zrepl', '0.7.0-1'],
  ]);
  const updated = content.replace('1.32.16', '1.33.0');
  assert.equal((await extract(updated))[0].currentValue, '1.33.0');
  assert.equal((await extract(updated))[1].currentValue, '2.3.4');
});

test('upstream datasource is dynamic rather than restricted to APT and PyPI', async () => {
  assert.equal(preset.customManagers.length, 2);
  assert.equal(manager.versioningTemplate, undefined);
  const content = YAML.stringify({ tracks: [{
    upstream: { datasource: 'github-releases', depName: 'example/app', version: '1.2.3' },
  }] });
  assert.deepEqual(await extract(content), [
    { datasource: 'github-releases', depName: 'example/app', currentValue: '1.2.3' },
  ]);
});

test('track names distinguish stable and prerelease updates for the same upstream', async () => {
  const content = YAML.stringify({ tracks: [
    { name: 'stable', upstream: { datasource: 'github-releases', depName: 'Sonarr/Sonarr', version: '4.0.20.3014' } },
    { name: 'develop', prerelease: true, upstream: { datasource: 'github-releases', depName: 'Sonarr/Sonarr', version: '5.0.0.2668' } },
  ] });
  assert.deepEqual(await extract(content), [
    { datasource: 'github-releases', depName: 'Sonarr/Sonarr', depType: 'stable', currentValue: '4.0.20.3014' },
    { datasource: 'github-releases', depName: 'Sonarr/Sonarr', depType: 'develop', currentValue: '5.0.0.2668' },
  ]);
  const updated = content.replace('5.0.0.2668', '5.0.0.2700');
  assert.equal((await extract(updated))[0].currentValue, '4.0.20.3014');
  assert.equal((await extract(updated))[1].currentValue, '5.0.0.2700');
});

test('PyPI updates only propose stable X.Y.Z versions supported by the release planner', () => {
  const rule = preset.packageRules.find((r) => r.matchDatasources?.includes('pypi'));
  const allowed = new RegExp(rule.allowedVersions.slice(1, -1));
  for (const value of ['0.1.0', '1.32.16', '2.0.0']) assert.ok(allowed.test(value), value);
  for (const value of ['1.32', '01.32.16', '1.32.16rc1', '1.32.16-rc.1', '1.32.16.post1', '1.32.16.dev1', '1!1.32.16', '1.32.16+local']) {
    assert.ok(!allowed.test(value), value);
  }
});
