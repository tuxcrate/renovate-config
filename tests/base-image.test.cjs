const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
// Run inside the pinned Renovate image, using its actual dependency versions.
const requireRenovate = createRequire('/usr/local/renovate/package.json');
const jsonata = requireRenovate('jsonata');
const YAML = requireRenovate('yaml');
const preset = require('../images.json');

const manager = preset.customManagers.find((m) => m.description.includes('baseImage'));
const digest = `sha256:${'a'.repeat(64)}`;

async function extract(content) {
  // Renovate parses YAML as an array of documents before evaluating JSONata.
  const documents = YAML.parseAllDocuments(content).map((d) => d.toJSON());
  const result = await jsonata(manager.matchStrings[0]).evaluate(documents);
  const deps = result === undefined ? [] : Array.isArray(result) ? [...result] : [result];
  return deps.map((dep) => ({ ...dep }));
}

test('base-image manager uses the Docker datasource and Docker versioning', () => {
  assert.equal(manager.customType, 'jsonata');
  assert.equal(manager.fileFormat, 'yaml');
  assert.equal(manager.datasourceTemplate, 'docker');
  assert.equal(manager.versioningTemplate, 'docker');
  assert.ok(preset.packageRules.some((r) => r.matchDatasources?.includes('docker') && r.pinDigests));
});

test('matches only meta.yaml, including nested configurations', () => {
  const pattern = manager.managerFilePatterns[0];
  const fileRE = new RegExp(pattern.slice(1, -1));
  for (const name of ['meta.yaml', 'containers/app/meta.yaml']) {
    assert.ok(fileRE.test(name), name);
  }
  for (const name of ['images.json', 'image.json', 'catalog.json', 'renovate.json', 'meta.yaml.bak', 'meta.yml']) {
    assert.ok(!fileRE.test(name), name);
  }
});

test('extracts each track base image without unrelated image references', async () => {
  const override = `sha256:${'b'.repeat(64)}`;
  const content = `image: ghcr.io/tuxcrate/app
tracks:
  - name: stable
    version: "1.2.3"
    baseImage: debian:13-slim@${digest}
    aliases: [latest]
  - name: preview
    version: "2.0.0-rc.1"
    baseImage: debian:14-slim@${override}
    aliases: [preview]
`;
  assert.deepEqual(await extract(content), [
    { depName: 'debian', currentValue: '13-slim', currentDigest: digest },
    { depName: 'debian', currentValue: '14-slim', currentDigest: override },
  ]);
});

test('supports plain, single-quoted and double-quoted YAML values, comments and CRLF', async () => {
  for (const value of [`debian:13.7-slim@${digest}`, `'debian:13.7-slim@${digest}'`, `"debian:13.7-slim@${digest}"`]) {
    for (const ending of ['', '\n', ' # base image\n', '\r\n']) {
      assert.deepEqual(await extract(`tracks:\n  - name: stable\n    baseImage: ${value}${ending}`), [
        { depName: 'debian', currentValue: '13.7-slim', currentDigest: digest },
      ]);
    }
  }
});

test('preserves full registry paths and ports when splitting the tag', async () => {
  assert.deepEqual(await extract(`tracks:\n  - baseImage: registry.example.com:5000/team/base:13.7-slim@${digest}\n`), [
    { depName: 'registry.example.com:5000/team/base', currentValue: '13.7-slim', currentDigest: digest },
  ]);
});

test('captures tag and digest independently for updates', async () => {
  const content = `# preserve comments\ntracks:\n  - baseImage: debian:13.7-slim@${digest}\n    aliases: [latest]\n`;
  const dependency = (await extract(content))[0];
  const updatedDigest = `sha256:${'c'.repeat(64)}`;
  const digestUpdate = content.replace(dependency.currentDigest, updatedDigest);
  assert.deepEqual((await extract(digestUpdate))[0], { ...dependency, currentDigest: updatedDigest });
  const tagUpdate = digestUpdate.replace(dependency.currentValue, '13.8-slim');
  assert.deepEqual((await extract(tagUpdate))[0], { ...dependency, currentValue: '13.8-slim', currentDigest: updatedDigest });
  assert.ok(tagUpdate.startsWith('# preserve comments\n'));
  assert.ok(tagUpdate.includes('    aliases: [latest]\n'));
});

test('does not extract malformed or unrelated values', async () => {
  for (const content of [
    'tracks:\n  - baseImage: debian:13-slim\n',
    'tracks:\n  - baseImage: debian:13-slim@sha256:bad\n',
    `image: debian:13-slim@${digest}\n`,
    `tracks:\n  - baseImage: debian:13-slim@${digest}extra\n`,
    `baseImage: debian:13-slim@${digest}\n`,
    `other:\n  baseImage: debian:13-slim@${digest}\n`,
    `tracks:\n  - nested:\n      baseImage: debian:13-slim@${digest}\n`,
    'tracks:\n  - name: stable\n',
    'tracks:\n  - baseImage: null\n',
    'tracks:\n  - baseImage: 123\n',
    `tracks:\n  - baseImage: [debian:13-slim@${digest}]\n`,
    `# baseImage: debian:13-slim@${digest}\n`,
  ]) {
    assert.deepEqual(await extract(content), [], content);
  }
});

test('supports flow mappings, reordered keys and multiple YAML documents', async () => {
  const tracks = [{ aliases: ['latest'], baseImage: `debian:13-slim@${digest}`, name: 'stable' }];
  const expected = [{ depName: 'debian', currentValue: '13-slim', currentDigest: digest }];
  for (const content of [
    YAML.stringify({ tracks }, { indent: 4 }),
    YAML.stringify({ tracks }, { collectionStyle: 'flow' }),
  ]) assert.deepEqual(await extract(content), expected, content);

  const content = `${YAML.stringify({ tracks })}---\n${YAML.stringify({ tracks })}`;
  assert.deepEqual(await extract(content), [...expected, ...expected]);
});
