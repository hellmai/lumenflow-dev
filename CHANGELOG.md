# Changelog

All notable changes to LumenFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Gitignore scaffold drift** (WU-2180): `lumenflow init` was missing four ephemeral paths from `REQUIRED_GITIGNORE_EXCLUSIONS`: `.lumenflow/checkpoints/`, `.lumenflow/locks/`, `.lumenflow/artifacts/`, and `.lumenflow/state/spawn-registry.jsonl`. Consumer repos that ran `lumenflow init` before this fix may have these files tracked in git, causing `wu:done` clean-tree checks to fail. See [Migration](#gitignore-scaffold-drift-remediation) below.

### Migration

#### Gitignore scaffold drift remediation

**Who is affected:** Any repo that ran `lumenflow init` before this fix and has since used `wu:prep` or agent checkpointing. If ephemeral files like `.lumenflow/checkpoints/` are tracked in your repo, you need to clean them up.

**Remediation steps:**

1. Upgrade to the version containing this fix.

2. Re-run init to backfill the missing `.gitignore` entries:

   ```bash
   pnpm exec lumenflow
   ```

   When a `.gitignore` already exists, init checks each entry in `REQUIRED_GITIGNORE_EXCLUSIONS` against the file and appends only the missing ones. This is safe to run on existing repos -- it will not duplicate entries or overwrite your custom exclusions.

3. If ephemeral files are already tracked in git, remove them from the index:

   ```bash
   git rm --cached -r .lumenflow/checkpoints/ .lumenflow/locks/ .lumenflow/artifacts/ 2>/dev/null
   git rm --cached .lumenflow/state/spawn-registry.jsonl 2>/dev/null
   ```

   The `-r` flag handles directories recursively. The `2>/dev/null` suppresses errors for paths that do not exist in your repo.

4. Commit the cleanup:

   ```bash
   git add .gitignore
   git commit -m "fix: remove tracked ephemeral files and backfill gitignore entries"
   ```

## [4.0.0] - 2026-02-21

### Added

- **Workspace-first bootstrap-all onboarding**: `npx lumenflow` is now the canonical onboarding
  path for creating and configuring `workspace.yaml`.
- **Cloud connect surfaced in canonical flow**: workspace control-plane configuration is now
  documented and supported via `cloud:connect` / `lumenflow cloud connect`.
- **Workspace-scoped config tooling**: `config:set` and `config:get` are now documented as
  workspace-first operations against `workspace.yaml > software_delivery`.

### Changed

- **Canonical config source**: runtime semantics now center on `workspace.yaml` instead of split
  onboarding/config paths.
- **Docs and migration messaging** updated across quickstart, CLI reference, and upgrade guides to
  reflect workspace-first behavior.

### Removed

- **Split onboarding as primary path**: `onboard`, `lumenflow-onboard`, and `workspace:init` are
  no longer primary setup commands.

### Breaking Changes

- **Major release**: v4.0.0 hard-cuts to workspace-first configuration and onboarding semantics.
- **Legacy onboarding entrypoints** now act as legacy guidance shims and should be replaced in user
  scripts/docs with `npx lumenflow`.

### Migration

1. Upgrade packages:

   ```bash
   pnpm lumenflow:upgrade --latest
   ```

2. Migrate legacy config if present:

   ```bash
   pnpm lumenflow:upgrade config:migrate-workspace
   ```

3. Re-run canonical bootstrap in merge mode:

   ```bash
   pnpm exec lumenflow --client <client> --merge
   ```

4. Verify runtime health:

   ```bash
   pnpm exec lumenflow-doctor
   ```

## [2.2.0] - 2026-01-30

### Added

- **Methodology Configurability (INIT-010)**: Configure your team's testing and architecture methodology via `workspace.yaml` (`software_delivery.methodology`). Choose between TDD, test-after, or no testing enforcement. Select hexagonal, layered, or no architecture guidance.

  ```yaml
  methodology:
    testing: 'tdd' # tdd | test-after | none
    architecture: 'hexagonal' # hexagonal | layered | none
    overrides:
      coverage_threshold: 85
      coverage_mode: 'warn'
  ```

  See [Choosing Your Methodology](https://lumenflow.dev/guides/choosing-methodology) for detailed guidance.

- **Methodology-aware spawn prompts**: Agent spawn prompts now include methodology-specific guidance based on your configuration. TDD methodology includes RED-GREEN-REFACTOR patterns; test-after allows implementation before tests; none removes testing ceremony for spikes and prototypes.

- **Template-based coverage thresholds**: Each methodology provides sensible defaults that can be overridden:

  | Methodology  | Coverage | Mode  | Tests Required |
  | ------------ | -------- | ----- | -------------- |
  | `tdd`        | 90%      | block | Yes            |
  | `test-after` | 70%      | warn  | Yes            |
  | `none`       | 0%       | off   | No             |

### Changed

- Nothing. This release is fully backwards compatible. Existing projects without `methodology` configuration continue to use TDD with 90% coverage enforcement.

### Deprecated

- Nothing deprecated in this release.

### Removed

- Nothing removed in this release.

### Fixed

- Nothing fixed in this release.

### Security

- Nothing security-related in this release.

### Breaking Changes

**None.** The methodology configuration is opt-in. Projects without explicit methodology configuration maintain identical behavior to v2.1.x.

### Migration

No migration required. To adopt methodology configurability:

1. Add the `methodology` section under `software_delivery` in `workspace.yaml`
2. Choose your testing methodology: `tdd`, `test-after`, or `none`
3. Choose your architecture methodology: `hexagonal`, `layered`, or `none`
4. Optionally override template defaults with `overrides`

See the [Migration Guide](https://lumenflow.dev/guides/migration) for detailed instructions.

---

## [2.1.2] - 2026-01-15

### Added

- **Micro-worktree upgrade**: The `lumenflow:upgrade` command now uses micro-worktree isolation, allowing package upgrades without creating a WU.
- **Skills tutorial**: Comprehensive documentation for creating and publishing custom skills.
- **TypeDoc API documentation**: Auto-generated API reference for all packages.
- **Cookbook examples**: Real-world patterns and recipes for common workflows.

### Fixed

- **guard-main-branch**: Now correctly allows operations when running from inside a worktree on a lane branch (WU-1130).

### Changed

- **lumenflow:upgrade**: Atomic package updates with automatic `pnpm-lock.yaml` regeneration.
- **Documentation**: Expanded guides for advanced workflows.
- **Gates**: Better error messages for common gate failures.

---

## [2.0.0] - 2026-01-01

### Breaking Changes

- **Config version bump**: LumenFlow configuration now requires `version: '2.0'`
- **Lane format**: Lanes now use "Parent: Sublane" format (e.g., `Framework: Core`)
- **Stamp location**: Stamps moved from `.lumenflow/stamps/` to `.lumenflow/stamps/`
- **State directory**: State files moved from `.lumenflow/` to `.lumenflow/`

### Added

- **Agent Pattern Registry**: Central registry for AI agent branch patterns at `lumenflow.dev/registry/`
- **Context-Aware Validation**: Commands now validate location, WU status, and git state
- **Memory Layer**: New `@lumenflow/memory` package for agent session tracking
- **Initiatives**: Multi-phase project orchestration with `@lumenflow/initiatives`
- **DORA Metrics**: Flow metrics and bottleneck analysis in `@lumenflow/metrics`
- **Skills System**: Modular knowledge bundles for AI agents in `.claude/skills/`
- **Language Presets**: Gate presets for Node, Python, Go, Rust, Java, Ruby, PHP, .NET

### Changed

- **wu:claim**: Now uses micro-worktree isolation for atomic state updates
- **wu:done**: Spec completeness validation prevents placeholder WUs
- **Gates**: Config-driven presets reduce boilerplate configuration
- **CLI**: Better error messages with copy-paste fix commands

---

## [1.6.0] - 2025-12-01

### Added

- **GitHub Action**: New `actions/lumenflow-gates` for CI/CD integration
- **Headless Mode**: `LUMENFLOW_HEADLESS=1` for CI environments
- **wu:recover**: Analyze and fix WU state inconsistencies

### Changed

- **Performance**: 40% faster worktree creation
- **Error messages**: More actionable error descriptions
- **Documentation**: Expanded agent onboarding docs

---

## [1.5.0] - 2025-11-01

### Added

- **wu:spawn**: Generate context-rich prompts for AI agents
- **Agent sessions**: Track agent work with `agent:session` commands
- **Flow analysis**: `flow:report` and `flow:bottlenecks` commands

### Changed

- **Validation**: Better WU YAML schema validation
- **Hooks**: More robust pre-commit and commit-msg hooks

---

## [1.0.0] - 2025-06-01

### Added

- **Core workflow**: `wu:create`, `wu:claim`, `wu:done`
- **Worktree isolation**: Automatic worktree management
- **Quality gates**: Format, lint, typecheck, test
- **Lane-based WIP**: One active WU per lane
- **Stamps**: Completion tracking with `.lumenflow/stamps/`
- **Hooks**: Pre-commit and commit-msg enforcement

---

[Unreleased]: https://github.com/hellmai/lumenflow-dev/compare/v4.0.0...HEAD
[4.0.0]: https://github.com/hellmai/lumenflow-dev/compare/v2.2.0...v4.0.0
[2.2.0]: https://github.com/hellmai/lumenflow-dev/compare/v2.1.2...v2.2.0
[2.1.2]: https://github.com/hellmai/lumenflow-dev/compare/v2.0.0...v2.1.2
[2.0.0]: https://github.com/hellmai/lumenflow-dev/compare/v1.6.0...v2.0.0
[1.6.0]: https://github.com/hellmai/lumenflow-dev/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/hellmai/lumenflow-dev/compare/v1.0.0...v1.5.0
[1.0.0]: https://github.com/hellmai/lumenflow-dev/releases/tag/v1.0.0
