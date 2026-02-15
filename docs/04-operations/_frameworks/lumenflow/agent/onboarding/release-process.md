# LumenFlow Release Process

**Last updated:** 2026-01-23

This document covers the complete release process for LumenFlow, including versioning, npm publishing, documentation updates, and the GitHub App.

---

## Overview

LumenFlow has several components that need to stay in sync:

| Component      | Location                | Deployment                          |
| -------------- | ----------------------- | ----------------------------------- |
| npm packages   | `packages/@lumenflow/*` | Auto via GitHub Actions on tag push |
| Starlight docs | `apps/docs/`            | Manual via Vercel CLI               |
| GitHub App     | `apps/github-app/`      | Auto via Vercel Git integration     |

---

## Release Command

The `pnpm release` command automates the entire release process:

```bash
pnpm release --release-version 1.3.0
```

### What It Does

1. Validates semver version format
2. Ensures clean working directory on main branch
3. Syncs templates with source docs (`pnpm sync:templates`)
4. Bumps all `@lumenflow/*` package versions using micro-worktree isolation
5. Builds all packages
6. Creates and pushes git tag `vX.Y.Z`
7. Publishes to npm

### Options

| Flag                        | Description                             |
| --------------------------- | --------------------------------------- |
| `--release-version <X.Y.Z>` | **Required.** Semver version to release |
| `--dry-run`                 | Preview changes without making them     |
| `--skip-publish`            | Bump and tag only (no npm publish)      |
| `--skip-build`              | Skip build step (use existing dist)     |
| `--version`, `-V`           | Show CLI version                        |
| `--help`, `-h`              | Show help                               |

### Examples

```bash
# Full release
pnpm release --release-version 1.3.0

# Preview what would happen
pnpm release --release-version 1.3.0 --dry-run

# Version bump and tag only (CI will publish)
pnpm release --release-version 1.3.0 --skip-publish
```

### Authentication

For npm publish, set one of these environment variables:

```bash
export NPM_TOKEN=<your-npm-token>
# or
export NODE_AUTH_TOKEN=<your-npm-token>
```

Get a token at: https://www.npmjs.com/settings/tokens

---

## Template Synchronization (WU-1353)

CLI templates (`packages/@lumenflow/cli/templates/`) are synced from source docs to ensure new projects get up-to-date onboarding content.

### Sync Templates

```bash
# Sync source docs to CLI templates
pnpm sync:templates

# Preview without writing files
pnpm sync:templates --dry-run
```

### Check for Drift (CI)

```bash
# Check if templates are out of sync with source
pnpm sync:templates --check-drift
```

The `--check-drift` flag compares templates with their source files. If drift is detected:

- Exit code 1 (fails CI)
- Lists drifting files
- Suggests running `pnpm sync:templates`

### What Gets Synced

| Source                           | Template                                                      |
| -------------------------------- | ------------------------------------------------------------- |
| `.lumenflow/constraints.md`      | `templates/core/.lumenflow/constraints.md.template`           |
| `LUMENFLOW.md`                   | `templates/core/LUMENFLOW.md.template`                        |
| `docs/.../agent/onboarding/*.md` | `templates/core/ai/onboarding/*.md.template`                  |
| `.claude/skills/*/SKILL.md`      | `templates/vendors/claude/.claude/skills/*/SKILL.md.template` |

### Template Variables

During sync, content is transformed:

- `YYYY-MM-DD` dates become `{{DATE}}`
- Absolute paths become `{{PROJECT_ROOT}}` (when applicable)

### When to Sync

- Before every release (included in release checklist)
- After updating source onboarding docs
- After modifying constraints or workflow rules
- CI drift check runs on every push to main

---

## Version Bumping (Manual)

If you need to bump versions manually without the release command:

All `@lumenflow/*` packages share the same version number for simplicity.

### Packages to Update

```text
packages/@lumenflow/core/package.json
packages/@lumenflow/cli/package.json
packages/@lumenflow/memory/package.json
packages/@lumenflow/agent/package.json
packages/@lumenflow/metrics/package.json
packages/@lumenflow/initiatives/package.json
packages/@lumenflow/shims/package.json
```

### Manual Version Bump

```bash
# Update all package.json files
# Change "version": "1.2.0" to "1.3.0" in each file

# Verify versions match
grep '"version"' packages/@lumenflow/*/package.json
```

### Semantic Versioning

- **Patch** (1.2.x): Bug fixes, docs updates
- **Minor** (1.x.0): New features, non-breaking changes
- **Major** (x.0.0): Breaking changes (rare)

---

## npm Publishing

### Trigger

Publishing is triggered by pushing a git tag matching `v*`:

```bash
git tag -a v1.3.0 -m "v1.3.0 - Description of changes"
git push origin v1.3.0
```

### Workflow

The `.github/workflows/publish.yml` workflow:

1. Checks out the tagged commit
2. Installs dependencies
3. Builds all packages
4. Publishes to npm with `pnpm -r publish --access public`

### Required Secrets

- **`NPM_TOKEN`**: npm automation token with publish access to `@lumenflow` scope
  - Generate at: <https://www.npmjs.com/settings/tokens>
  - Type: Automation token (bypasses 2FA)
  - Store in: GitHub repo settings → Secrets → Actions

### Troubleshooting npm Publish

#### Token Issues

If you see "Access token expired or revoked":

- Regenerate npm token and update `NPM_TOKEN` secret

#### Package Not Found (404)

If you see "404 Not Found" for a package:

- Check if package has `"private": true` (should NOT be published)
- Apps (`apps/*`) should have `"private": true`
- Only `packages/@lumenflow/*` should be published

#### Re-running Failed Workflow

```bash
gh run list --workflow=publish.yml --limit 5
gh run rerun <run-id>
```

### Verifying Publication

```bash
npm view @lumenflow/cli versions --json | tail -5
```

---

## Starlight Documentation

The public docs at <https://lumenflow.dev> are built from `apps/docs/`.

**Automatic Generation:** CLI and config reference docs are automatically generated from code. See [Automatic Docs Generation](./docs-generation.md) for details on the single-source-of-truth pattern.

### Deployment

Starlight docs are deployed **manually** via Vercel CLI:

```bash
cd apps/docs
pnpm build
vercel --prod
```

### When to Deploy

- After any changes to `apps/docs/src/content/docs/**`
- After version bumps (to update any version references)
- After adding new features documented in Starlight

### Vercel Project

- **Project**: `lumenflow-docs` (ID: `prj_myK4BzfHKctGhxfvALJaMOXVLx4g`)
- **Domain**: lumenflow.dev
- **Team**: hellm-ai

### Important Notes

- **No private repo links**: Starlight docs are public; never link to `github.com/hellmai/lumenflow`
- **Link to GitHub App**: Use <https://github.com/apps/lumenflow-by-hellmai> for GitHub links
- **Link to npm**: Use <https://www.npmjs.com/org/lumenflow> for package links

---

## GitHub App

The LumenFlow GitHub App provides workflow enforcement for teams.

### Components

- **App manifest**: `apps/github-app/app.yml`
- **Webhook handler**: `apps/github-app/api/webhook.ts`
- **Validation endpoints**: `apps/github-app/api/validate-token.ts`

### Deployment

The GitHub App is deployed **automatically** via Vercel Git integration when changes are pushed to `main`.

- **Project**: `lumenflow-app` (ID: `prj_JKfcHVb4QjzAxdjCIJwaUf5PWusG`)
- **URL**: <https://lumenflow-app.vercel.app>

### Package Configuration

The `apps/github-app/package.json` must have `"private": true` to prevent npm publish attempts.

### Environment Variables (Vercel)

| Variable                | Description                  |
| ----------------------- | ---------------------------- |
| `GITHUB_APP_ID`         | GitHub App ID                |
| `GITHUB_PRIVATE_KEY`    | PEM private key for app auth |
| `GITHUB_WEBHOOK_SECRET` | Webhook signature secret     |

---

## Release Checklist

### Before Release

- [ ] All acceptance criteria met
- [ ] Gates pass (`pnpm gates`)
- [ ] Pre-release checks pass (`pnpm pre-release:check`)
- [ ] Templates synced (`pnpm sync:templates` - ensures CLI templates match source docs)
- [ ] CHANGELOG updated (if maintained)

### Release Steps (Automated)

Use the release command for the standard workflow:

```bash
# Preview first
pnpm release --release-version 1.3.0 --dry-run

# Execute release
pnpm release --release-version 1.3.0
```

This handles version bump, build, tag, and npm publish automatically.

### Release Steps (Manual)

If you need more control:

1. **Complete WU** (includes version bump commit)

   ```bash
   pnpm pre-release:check
   pnpm wu:done --id WU-XXXX
   ```

2. **Create and push tag**

   ```bash
   git tag -a v1.3.0 -m "v1.3.0 - Summary of changes"
   git push origin v1.3.0
   ```

3. **Verify npm publish**

   ```bash
   gh run list --workflow=publish.yml --limit 1
   # Wait for completion, then verify
   npm view @lumenflow/cli version
   ```

4. **Create GitHub release**

   ```bash
   gh release create v1.3.0 --title "v1.3.0 - Title" --notes "Release notes..."
   ```

5. **Deploy Starlight docs** (if content changed)

   ```bash
   cd apps/docs && pnpm build && vercel --prod
   ```

### After Release

- [ ] Verify npm packages accessible: `npm view @lumenflow/cli`
- [ ] Verify docs updated: <https://lumenflow.dev>
- [ ] Verify GitHub App functional (if changed)

---

## Keeping Components in Sync

| Change Type      | npm           | Docs   | GitHub App   |
| ---------------- | ------------- | ------ | ------------ |
| Bug fix in CLI   | Tag + publish | Auto\* | No           |
| New CLI command  | Tag + publish | Auto\* | No           |
| Docs-only update | No            | Deploy | No           |
| GitHub App fix   | No            | No     | Auto on push |
| Full release     | Tag + publish | Deploy | Auto         |

\* CLI/config reference docs regenerate automatically during `wu:done` when trigger files change. See [Automatic Docs Generation](./docs-generation.md).

---

## Troubleshooting Deployments

### npm publish fails

1. Check `NPM_TOKEN` secret is valid
2. Check all `apps/*/package.json` have `"private": true`
3. Re-run: `gh run rerun <run-id>`

### Vercel deploy fails

1. Check build locally: `cd apps/docs && pnpm build`
2. Check Vercel CLI auth: `vercel whoami`
3. Check project link: `vercel link`

### GitHub App webhook failures

1. Check Vercel deployment logs
2. Verify environment variables set
3. Check webhook secret matches GitHub App settings

---

## Known Warnings

These warnings appear during `pnpm install` and are expected:

### Cyclic workspace dependencies

```
WARN  There are cyclic workspace dependencies: @lumenflow/core, @lumenflow/memory
```

**Why:** `@lumenflow/core` has `@lumenflow/memory` as an **optional peer dependency** for advanced features, while `@lumenflow/memory` depends on `@lumenflow/core` for base utilities. This is intentional architecture.

### Deprecated subdependencies

```
WARN  5 deprecated subdependencies found: glob@7.2.3, inflight@1.0.6, path-match@1.2.4, ...
```

**Why:** These come from transitive dependencies of packages like `vercel`. They cannot be fixed without upstream updates.

### Ignored build scripts

```
Ignored build scripts: esbuild@..., sharp@...
```

**Why:** pnpm ignores build scripts by default for security. These packages work correctly without their postinstall scripts in our use case.
