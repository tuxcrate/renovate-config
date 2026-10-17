# renovate-config

Shared [Renovate](https://docs.renovatebot.com/) configuration for Tuxcrate.

[Documentation](https://github.com/tuxcrate/website/blob/main/docs/maintainers/dependency-updates.md)

The validator workflow follows the Renovate image's major tag (`44`) without a
digest pin to avoid frequent patch and digest update PRs. This exception lives in
this repository's `renovate.json` and applies only to `ghcr.io/renovatebot/renovate`;
shared presets and other dependencies retain their existing pinning policies.
Renovate can still propose updates to the next major image tag.
