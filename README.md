# renovate-config

Shared [Renovate](https://docs.renovatebot.com/) configuration for Tuxcrate.

[Documentation](https://github.com/tuxcrate/website/blob/main/docs/maintainers/dependency-updates.md)

## Automerge policy

The default preset enables PR-based, platform-native automerge for minor, patch,
pin, pin-digest, digest, and lock-file maintenance updates. Major updates and
other update types require manual merging. This does not enable lock-file
maintenance itself. The `images` preset inherits the same policy.

Pre-1.0 dependencies are intentionally included to maximize automation, although
even their non-major updates can contain breaking changes. Passing CI is the
safety gate, not a guarantee of compatibility. Container builds should cover all
supported architectures; runtime smoke tests provide additional confidence.

For each consuming GitHub repository:

- Enable **Allow auto-merge** in repository settings.
- Protect the default branch and require the relevant PR validation/build checks.
  With platform-native automerge, GitHub must enforce those checks before merging.
- Ensure required reviews do not block the intended unattended merges, without
  granting Renovate a blanket bypass of required checks.

Keep common policy in the shared presets and use repository-level `packageRules`
only for exceptions. For example, append this rule in a repository to keep a
specific package manual:

```json
{
  "matchPackageNames": ["example-package"],
  "automerge": false
}
```

## Renovate validator image

The validator workflow follows the Renovate image's major tag (`44`) without a
digest pin to avoid frequent patch and digest update PRs. This exception lives in
this repository's `renovate.json` and applies only to `ghcr.io/renovatebot/renovate`;
shared presets and other dependencies retain their existing pinning policies.
Renovate can still propose updates to the next major image tag.
