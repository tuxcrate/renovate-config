const assert = require('node:assert/strict');
const { test } = require('node:test');
const preset = require('../images.json');

const manager = preset.customManagers.find((m) => m.description.includes('baseImage'));
const digest = `sha256:${'a'.repeat(64)}`;

function extract(content) {
  return [...content.matchAll(new RegExp(manager.matchStrings[0], 'g'))].map((m) => ({ ...m.groups }));
}

test('base-image manager uses the Docker datasource and Docker versioning', () => {
  assert.equal(manager.customType, 'regex');
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

test('extracts each track base image without unrelated image references', () => {
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
  assert.deepEqual(extract(content), [
    { depName: 'debian', currentValue: '13-slim', currentDigest: digest },
    { depName: 'debian', currentValue: '14-slim', currentDigest: override },
  ]);
});

test('supports plain, single-quoted and double-quoted YAML values, comments and CRLF', () => {
  for (const value of [`debian:13.7-slim@${digest}`, `'debian:13.7-slim@${digest}'`, `"debian:13.7-slim@${digest}"`]) {
    for (const ending of ['', '\n', ' # base image\n', '\r\n']) {
      assert.deepEqual(extract(`    baseImage: ${value}${ending}`), [
        { depName: 'debian', currentValue: '13.7-slim', currentDigest: digest },
      ]);
    }
  }
});

test('preserves full registry paths and ports when splitting the tag', () => {
  assert.deepEqual(extract(`    baseImage: registry.example.com:5000/team/base:13.7-slim@${digest}\n`), [
    { depName: 'registry.example.com:5000/team/base', currentValue: '13.7-slim', currentDigest: digest },
  ]);
});

test('captures tag and digest independently for updates', () => {
  const content = `    baseImage: debian:13.7-slim@${digest}\n`;
  const dependency = extract(content)[0];
  const updatedDigest = `sha256:${'c'.repeat(64)}`;
  const digestUpdate = content.replace(dependency.currentDigest, updatedDigest);
  assert.deepEqual(extract(digestUpdate)[0], { ...dependency, currentDigest: updatedDigest });
  const tagUpdate = digestUpdate.replace(dependency.currentValue, '13.8-slim');
  assert.deepEqual(extract(tagUpdate)[0], { ...dependency, currentValue: '13.8-slim', currentDigest: updatedDigest });
});

test('does not extract malformed or unrelated values', () => {
  for (const content of [
    '    baseImage: debian:13-slim\n',
    '    baseImage: debian:13-slim@sha256:bad\n',
    `image: debian:13-slim@${digest}\n`,
    `    baseImage: debian:13-slim@${digest}extra\n`,
    `# baseImage: debian:13-slim@${digest}\n`,
  ]) {
    assert.deepEqual(extract(content), [], content);
  }
});
