const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
// Run inside the pinned Renovate image, using its actual dependency versions.
const requireRenovate = createRequire('/usr/local/renovate/package.json');
const jsonata = requireRenovate('jsonata');
const YAML = requireRenovate('yaml');
const preset = require('../images.json');

const manager = preset.customManagers.find((m) => !m.datasourceTemplate);
const registryUrl = 'https://zrepl.cschwarz.com/apt/debian?suite=trixie&components=main&binaryArch=amd64';
const upstream = { datasource: 'deb', depName: 'zrepl', registryUrl, version: '0.7.0-1' };

async function extract(content) {
  // Renovate parses YAML as an array of documents before evaluating JSONata.
  const documents = YAML.parseAllDocuments(content).map((d) => d.toJSON());
  const result = await jsonata(manager.matchStrings[0]).evaluate(documents);
  const deps = result === undefined ? [] : Array.isArray(result) ? [...result] : [result];
  return deps.map((dep) => ({ ...dep }));
}

test('APT manager parses YAML and discovers the full package version using Debian versioning', async () => {
  assert.equal(manager.fileFormat, 'yaml');
  assert.equal(preset.packageRules.find((r) => r.matchDatasources?.includes('deb')).versioning, 'deb');
  const content = YAML.stringify({ tracks: [{ name: 'stable', upstream }] });
  assert.deepEqual(await extract(content), [{ datasource: 'deb', depName: 'zrepl', depType: 'stable', registryUrl, currentValue: '0.7.0-1' }]);
});

test('key order, indentation, quoting, flow mappings, comments and CRLF do not affect discovery', async () => {
  const expected = [{ datasource: 'deb', depName: 'zrepl', depType: 'stable', registryUrl, currentValue: '0.7.0-1' }];
  const reordered = Object.fromEntries(Object.entries(upstream).reverse());
  for (const content of [
    YAML.stringify({ tracks: [{ upstream: reordered, tags: ['${version}', 'latest'], name: 'stable' }] }, { indent: 4 }),
    YAML.stringify({ tracks: [{ upstream, name: 'stable' }] }, { collectionStyle: 'flow' }),
    `# any order is fine\ntracks:\n- tags: ['\${version}', '\${major}.\${minor}', latest]\n  upstream:\n    version: '0.7.0-1' # exact APT pin\n    registryUrl: '${registryUrl}'\n    depName: zrepl\n    datasource: deb\n  name: stable\n`.replaceAll('\n', '\r\n'),
  ]) assert.deepEqual(await extract(content), expected, content);
});

test('package-only and application updates round trip while preserving YAML text', async () => {
  for (const version of ['0.7.0-2', '0.8.0-1', '1.12.34-12']) {
    const content = `# keep comments\ntracks:\n  - name: stable\n    upstream: ${JSON.stringify(upstream)}\n    tags: ["\${version}", "\${major}.\${minor}", latest]\n`;
    const [dep] = await extract(content);
    // JSONata's updater replaces the extracted currentValue in the source text.
    const updated = content.replace(dep.currentValue, version);
    assert.equal((await extract(updated))[0].currentValue, version);
    assert.ok(updated.startsWith('# keep comments\n'));
    assert.ok(updated.includes('tags: ["${version}", "${major}.${minor}", latest]'));
  }
});

test('each track has its own package metadata, with no hard-coded package name', async () => {
  const other = { ...upstream, depName: 'other-package', version: '1.2.3-4' };
  const content = YAML.stringify({ tracks: [{ name: 'stable', upstream }, { name: 'other', upstream: other }] });
  const deps = await extract(content);
  assert.deepEqual(deps.map((d) => [d.depName, d.currentValue]), [['zrepl', '0.7.0-1'], ['other-package', '1.2.3-4']]);
  assert.equal((await extract(content.replace('1.2.3-4', '1.2.4-1')))[0].currentValue, '0.7.0-1');
});

test('unannotated tracks and incomplete upstream metadata are not extracted', async () => {
  for (const track of [
    { name: 'stable', version: '0.7.0' },
    { upstream: { ...upstream, datasource: undefined } },
    { upstream: { ...upstream, datasource: '' } },
    { upstream: { ...upstream, depName: undefined } },
    { upstream: { ...upstream, depName: '' } },
    { upstream: { ...upstream, version: undefined } },
    { upstream: { ...upstream, version: '' } },
    { upstream: { ...upstream, version: 123 } },
  ]) assert.deepEqual(await extract(YAML.stringify({ tracks: [track] })), []);
});

test('unsupported Debian version shapes are excluded from update proposals', () => {
  const rule = preset.packageRules.find((r) => r.matchDatasources?.includes('deb'));
  const allowed = new RegExp(rule.allowedVersions.slice(1, -1));
  for (const value of ['0.7.0-1', '0.8.0-12']) assert.ok(allowed.test(value), value);
  for (const value of ['0.8.0', '0.8.0-rc.1-1', '1:0.8.0-1', '0.8.0-1+b1', '0.8.0-1~deb13']) {
    assert.ok(!allowed.test(value), value);
  }
});
