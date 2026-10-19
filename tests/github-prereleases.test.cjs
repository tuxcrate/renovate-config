const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const requireRenovate = createRequire('/usr/local/renovate/package.json');
const jsonata = requireRenovate('jsonata');
const preset = require('../images.json');
const customConfigModule = import('/usr/local/renovate/dist/modules/datasource/custom/utils.js');
const packageRulesModule = import('/usr/local/renovate/dist/util/package-rules/index.js');
const versioningModule = import('/usr/local/renovate/dist/modules/versioning/loose/index.js');
const filterModule = import('/usr/local/renovate/dist/workers/repository/process/lookup/filter.js');

async function datasourceFor(packageName) {
  const { massageCustomDatasourceConfig } = await customConfigModule;
  return massageCustomDatasourceConfig('github-prereleases', {
    customDatasources: preset.customDatasources,
    packageName,
  });
}

async function transform(releases, packageName = 'example/app') {
  const config = await datasourceFor(packageName);
  let result = releases;
  for (const expression of config.transformTemplates) {
    result = await jsonata(expression).evaluate(result);
  }
  return JSON.parse(JSON.stringify(result));
}

test('the prerelease datasource templates the API and source URLs for any repository', async () => {
  for (const packageName of ['example/app', 'another-owner/Another.App']) {
    const config = await datasourceFor(packageName);
    assert.equal(config.defaultRegistryUrlTemplate, `https://api.github.com/repos/${packageName}/releases?per_page=100`);
    assert.equal(config.format, 'json');
    assert.equal((await transform([], packageName)).sourceUrl, `https://github.com/${packageName}`);
  }
});

test('discovery excludes newer stable releases, drafts, and incomplete release metadata', async () => {
  const result = await transform([
    { tag_name: 'v2.6.5.5623', draft: false, prerelease: false },
    { tag_name: 'v2.6.6.5630', draft: true, prerelease: true },
    { tag_name: 'v2.6.4.5611', draft: false, prerelease: true, published_at: '2026-09-06T11:41:32Z', html_url: 'https://github.com/example/app/releases/tag/v2.6.4.5611' },
    { tag_name: 'v2.6.3.5592', draft: false, prerelease: true },
    { tag_name: 'v2.6.7.5640', draft: false },
    { tag_name: 'v2.6.8.5650', prerelease: true },
    { tag_name: 'v2.6.9.5660', draft: false, prerelease: 'true' },
  ]);
  assert.deepEqual(result.releases, [
    { version: 'v2.6.4.5611', releaseTimestamp: '2026-09-06T11:41:32Z', changelogUrl: 'https://github.com/example/app/releases/tag/v2.6.4.5611', isStable: false },
    { version: 'v2.6.3.5592', isStable: false },
  ]);
});

test('discovery always returns an array, even for zero or one prerelease', async () => {
  for (const input of [[], [{ tag_name: 'v2.6.5.5623', draft: false, prerelease: false }]]) {
    assert.deepEqual((await transform(input)).releases, []);
  }
  assert.deepEqual((await transform([{ tag_name: 'v2.6.4.5611', draft: false, prerelease: true }])).releases,
    [{ version: 'v2.6.4.5611', isStable: false }]);
});

test('the datasource supports both suffixed prereleases and numeric upstream prereleases', async () => {
  const result = await transform([
    { tag_name: 'v1.2.3-rc.1', draft: false, prerelease: true },
    { tag_name: 'v2.6.4.5611', draft: false, prerelease: true },
  ]);
  assert.deepEqual(result.releases.map((release) => release.version), ['v1.2.3-rc.1', 'v2.6.4.5611']);
});

test('the shared preset leaves GitHub release-channel selection opt-in', async () => {
  const { applyPackageRules } = await packageRulesModule;
  for (const depType of ['stable', 'prerelease', 'develop']) {
    const resolved = await applyPackageRules({
      datasource: 'github-releases',
      depName: 'example/app',
      packageName: 'example/app',
      depType,
      manager: 'custom.jsonata',
      packageFile: 'meta.yaml',
      packageRules: preset.packageRules,
    }, 'test');
    assert.equal(resolved.datasource, 'github-releases');
  }
});

test('a local track rule can advance prereleases without selecting a newer stable release', async () => {
  const { applyPackageRules } = await packageRulesModule;
  const { api: versioning } = await versioningModule;
  const { filterVersions } = await filterModule;
  for (const depType of ['prerelease', 'develop']) {
    const resolved = await applyPackageRules({
      datasource: 'github-releases',
      depName: 'example/app',
      packageName: 'example/app',
      depType,
      manager: 'custom.jsonata',
      packageFile: 'meta.yaml',
      customDatasources: preset.customDatasources,
      packageRules: [...preset.packageRules, {
        matchDatasources: ['github-releases'],
        matchDepTypes: [depType],
        overrideDatasource: 'custom.github-prereleases',
        extractVersion: '^v(?<version>[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+)$',
        versioning: 'loose',
        ignoreUnstable: false,
        respectLatest: false,
      }],
    }, 'test');
    assert.equal(resolved.datasource, 'custom.github-prereleases');
    assert.ok(resolved.customDatasources['github-prereleases']);
    const result = await transform([
      { tag_name: 'v2.6.6.5640', draft: false, prerelease: false },
      { tag_name: 'v2.6.5.5620', draft: false, prerelease: true },
      { tag_name: 'v2.6.4.5611', draft: false, prerelease: true },
    ]);
    const extractVersion = new RegExp(resolved.extractVersion);
    const releases = result.releases.map((release) => ({
      ...release,
      version: extractVersion.exec(release.version).groups.version,
    }));
    const candidates = filterVersions(resolved, '2.6.4.5611', undefined, releases, versioning);
    assert.deepEqual(candidates.map((release) => release.version), ['2.6.5.5620']);
  }
});
