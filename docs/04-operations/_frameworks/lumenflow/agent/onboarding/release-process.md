# LumenFlow Release Process

**Last updated:** 2026-03-03

This document covers the complete release process for LumenFlow, including versioning, npm publishing, and documentation updates.

---

## Overview

LumenFlow has several components that need to stay in sync:

| Component      | Location                    | Deployment                                          |
| -------------- | --------------------------- | --------------------------------------------------- |
| npm packages   | `packages/@lumenflow/*`     | Auto via GitHub Actions on tag push (`publish.yml`) |
| Starlight docs | `apps/docs/`                | Separate GitHub Actions workflow (`docs.yml`)       |
| Pack registry  | `apps/web/` + pack tarballs | Manual deploy + curl publish                        |

---

## Release Command

The `pnpm release` command automates version bump + tagging, and optionally npm publish:

```bash
pnpm release --release-version 1.3.0 --skip-publish
```

### What It Does

1. Validates semver version format
2. Ensures clean working directory on main branch
3. Syncs templates with source docs (`pnpm sync:templates`)
4. Bumps all `@lumenflow/*` package versions using micro-worktree isolation
5. Builds all packages
6. Creates and pushes git tag `vX.Y.Z`
7. Optionally publishes to npm (unless `--skip-publish`)

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
# Version bump and tag only (CI will publish)
pnpm release --release-version 1.3.0 --skip-publish

# Preview what would happen
pnpm release --release-version 1.3.0 --skip-publish --dry-run
```

### Authentication

For direct CLI npm publish (without `--skip-publish`), set one of these environment variables:

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
3. Builds publishable workspace packages only (`./packages/**`)
4. Publishes to npm with `pnpm -r --filter "./packages/**" publish --access public --no-git-checks`
5. Creates the GitHub release object (`gh release create ... --generate-notes`)

`publish.yml` intentionally does **not** build `apps/docs` or `apps/web`, so docs/tooling dependencies cannot block npm publishing.

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

### Build Workflow

Starlight docs build in a separate workflow: `.github/workflows/docs.yml`.

Trigger:

- Tag push (`v*`)
- Manual run (`workflow_dispatch`)

The workflow:

1. Installs D2 (`astro-d2` prerequisite)
2. Builds docs with `pnpm --filter @lumenflow/docs build`
3. Uploads `apps/docs/dist` as a workflow artifact
4. Deploys to Vercel when `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` secrets are configured

### Deployment

Production deploy is still manual via Vercel CLI:

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

- **No private repo links**: Starlight docs are public; never link to `github.com/hellmai/lumenflow-dev`
- **Link to npm**: Use <https://www.npmjs.com/org/lumenflow> for package links

---

## Pack Registry Publishing

Packs are published to the registry at <https://registry.lumenflow.dev>. The registry is served by the `apps/web` Next.js app deployed to Vercel.

### Prerequisites

1. **Deploy `apps/web` to Vercel** before publishing. The registry API runs on the deployed app, so any code fixes (e.g. blob storage changes) must be live first.
2. **Build the pack tarball** with `pnpm pack` from the pack directory.
3. **Authenticate** with a GitHub token (`gh auth token`).

### Step 1: Deploy the Registry

The `apps/web` Vercel project has `Root Directory: apps/web` configured. To deploy from the CLI, link the repo root to the `web` project:

```bash
# From repo root — link to the 'web' project (not 'lumenflow-dev')
vercel link --project web --scope hellm-ai --yes

# Deploy to production
vercel --prod --yes
```

**Gotcha:** Do NOT run `vercel` from inside `apps/web/` — the Vercel root directory setting doubles the path (`apps/web/apps/web`). Always deploy from the repo root.

**Gotcha:** The repo root `.vercel/project.json` may be linked to `lumenflow-dev` (the monorepo project). You must re-link to `web` before deploying the registry.

After deploying, restore the link if needed:

```bash
vercel link --project lumenflow-dev --scope hellm-ai --yes
```

### Step 2: Build the Tarball

```bash
cd packages/@lumenflow/packs/software-delivery  # or sidekick, etc.
pnpm pack
# Creates: lumenflow-packs-software-delivery-X.Y.Z.tgz
```

### Step 3: Publish to Registry

```bash
curl -s -X POST \
  -H "Authorization: Bearer $(gh auth token)" \
  -H "Origin: https://registry.lumenflow.dev" \
  -F "tarball=@packages/@lumenflow/packs/software-delivery/lumenflow-packs-software-delivery-X.Y.Z.tgz" \
  -F "description=Software delivery pack for LumenFlow" \
  -F "version=X.Y.Z" \
  "https://registry.lumenflow.dev/api/registry/packs/software-delivery/versions"
```

Replace `software-delivery` with the pack ID and `X.Y.Z` with the version.

**Important:** The `Origin` header must match `https://registry.lumenflow.dev` — CSRF validation will reject requests without it.

### Step 4: Verify

```bash
# List all packs
curl -s https://registry.lumenflow.dev/api/registry/packs

# Check a specific pack
curl -s https://registry.lumenflow.dev/api/registry/packs/software-delivery
```

### Step 5: Cleanup

```bash
rm packages/@lumenflow/packs/software-delivery/lumenflow-packs-software-delivery-X.Y.Z.tgz
```

### Vercel Projects Reference

| Project           | Domain                   | Purpose                 |
| ----------------- | ------------------------ | ----------------------- |
| `web`             | registry.lumenflow.dev   | Pack registry + web app |
| `docs`            | lumenflow.dev            | Starlight documentation |
| `lumenflow-dev`   | lumenflow-dev.vercel.app | Monorepo preview        |
| `lumenflow-cloud` | cloud.lumenflow.dev      | Control plane           |

### Troubleshooting Pack Publishing

#### "Pack not found" after publish returns success

The deploy running at publish time was using old code. Deploy first, then publish.

#### Version conflict (409)

The version already exists. Pack versions are immutable — bump the version number.

#### CSRF error (403)

Missing or wrong `Origin` header. Must be `https://registry.lumenflow.dev`.

#### Vercel build fails with d2 error

The `@lumenflow/docs` package requires `d2` (diagramming tool) which is not available on Vercel. Ensure you are deploying the `web` project (which uses `turbo build --filter=@lumenflow/web`) not the `lumenflow-dev` project (which builds all packages).

---

## Release Checklist

### Before Release

- [ ] All acceptance criteria met
- [ ] Gates pass (`pnpm gates`)
- [ ] Pre-release checks pass (`pnpm pre-release:check`)
- [ ] Templates synced (`pnpm sync:templates` - ensures CLI templates match source docs)
- [ ] CHANGELOG updated (if maintained)

### Release Steps (Automated)

Use this as the standard workflow:

```bash
# Preview first
pnpm release --release-version 1.3.0 --skip-publish --dry-run

# Execute (version bump + tag, publish delegated to GitHub Actions)
pnpm release --release-version 1.3.0 --skip-publish
```

This handles version bump and tag locally; GitHub Actions handles npm publish, docs build, and GitHub release creation.

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

3. **Verify npm publish + GitHub release**

   ```bash
   gh run list --workflow=publish.yml --limit 1
   # Wait for completion, then verify
   npm view @lumenflow/cli version
   gh release view v1.3.0
   ```

4. **Verify docs workflow** (if docs changed)

   ```bash
   gh run list --workflow=docs.yml --limit 1
   ```

5. **Deploy Starlight docs** (if content changed and you are deploying manually)

   ```bash
   cd apps/docs && pnpm build && vercel --prod
   ```

### After Release

- [ ] Verify npm packages accessible: `npm view @lumenflow/cli`
- [ ] Verify docs updated: <https://lumenflow.dev>
- [ ] Verify packs published: `curl -s https://registry.lumenflow.dev/api/registry/packs`

---

## Keeping Components in Sync

| Change Type      | npm           | Docs                    | Packs   |
| ---------------- | ------------- | ----------------------- | ------- |
| Bug fix in CLI   | Tag + publish | Auto\*                  | No      |
| New CLI command  | Tag + publish | Auto\*                  | No      |
| Pack changes     | Tag + publish | No                      | Publish |
| Docs-only update | No            | Build workflow + deploy | No      |
| Full release     | Tag + publish | Build workflow + deploy | Publish |

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
