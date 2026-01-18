# LumenFlow Distribution & Dogfooding Plan

**Created:** 2026-01-18
**Status:** Draft (Codex-reviewed)
**Goal:** Establish proper software engineering workflow for LumenFlow development, publish packages, and launch SaaS product
**Target Location:** `hellmai/os/docs/plans/distribution-dogfooding.md`

---

## Executive Summary

Four-phase plan to:

1. **Dogfood LumenFlow** in hellmai/os (use LumenFlow to build LumenFlow)
2. **Publish to npm** as @lumenflow/* packages (private)
3. **Migrate PatientPath** from file: links to npm packages
4. **Launch SaaS Product** with Gates Action, tiers, and Marketplace listing

---

## Decisions Made

| Question | Decision |
|----------|----------|
| npm org visibility | **Private** (requires paid npm org ~$7/user/month) |
| npm org name | **@lumenflow** (fallback: @hellm-ai) |
| npm publishConfig.access | **restricted** (not public) |
| Initial version | **1.0.0** (production-ready signal) |
| GitHub App | **For external customers** (PatientPath: optional) |
| Git workflow | **Trunk-only** for PatientPath, **PR-based** for customers |
| Bootstrap exception | **Yes** (hellmai/os only, one-time setup) |

### Important: PR Flow Required for GitHub App

The GitHub App can **only** validate/enforce via PR events:
- `pull_request.opened` → validates WU spec, checks WIP, adds labels
- `pull_request.closed` (merged) → creates stamp commit

**If you use trunk-only (direct push to main):**
- GitHub App won't fire (no PR events)
- No automatic WU validation
- No WIP enforcement
- No completion stamps

**Your personal repos:** Trunk-only with CLI. No GitHub App needed.
**Customer repos:** PR-based with GitHub App for team enforcement.

### Component Independence

| Component | Works Without Other? | What It Does Alone |
|-----------|---------------------|-------------------|
| **CLI** (`@lumenflow/cli`) | ✅ Yes | Local workflow: `wu:claim`, `wu:done`, `gates`, memory layer |
| **GitHub App** | ✅ Yes | PR validation, WIP enforcement, stamps (only observes PRs) |
| **Both together** | Best | CLI for local work + App for enforcement/automation |

The CLI provides the workflow tools. The App enforces what it can observe (PRs, labels, merges). Neither requires the other, but together they provide complete enforcement.

---

## Phase 1: Dogfood LumenFlow in hellmai/os

### Current State

- hellmai/os contains LumenFlow source code (7 packages)
- GitHub App deployed and working at `https://lumenflow-app.vercel.app`
- **NOT dogfooding:** No `.lumenflow.config.yaml`, no WU specs, no root `.beacon/`

### Bootstrap Problem (Chicken-and-Egg)

**Problem:** Can't use LumenFlow WU workflow to create LumenFlow WU workflow config, because the config doesn't exist yet.

**Solution:** Minimal config commit approach (avoids manual stamps):

1. **One-off commit to main** (tiny exception): Add only `.lumenflow.config.yaml` + directory structure
2. **Then use proper wu:claim/wu:done** for WU-OS-001 to complete setup

This keeps the exception minimal (just config files) and uses proper workflow for the actual WU work.

> **Governance Note:** This bootstrap exception applies **only to hellmai/os** before LumenFlow workflow is live. It is a one-time setup to enable the workflow itself. After Phase 1 completes, all future work (including in hellmai/os) follows standard WU workflow with PR-based flow. This exception does NOT apply to PatientPath or any other repo.

#### Step 1: Minimal Bootstrap Commit (one-off exception)

```bash
# Only these files committed directly to main:
.lumenflow.config.yaml
docs/tasks/wu/.gitkeep
docs/tasks/backlog.md
docs/tasks/status.md
.beacon/stamps/.gitkeep
```

#### Step 2: Proper WU Workflow

After the minimal commit, use standard workflow:

```bash
pnpm wu:create --id WU-OS-001 --lane Infrastructure --title "Complete LumenFlow dogfooding setup"
pnpm wu:claim --id WU-OS-001 --lane Infrastructure
cd worktrees/infrastructure-wu-os-001
# Make remaining changes (package.json scripts, .gitignore, memory init)
pnpm gates
cd ../..
pnpm wu:done --id WU-OS-001
```

**WU-OS-001 spec** (created via wu:create, uses correct schema):

```yaml
id: WU-OS-001
title: "Complete LumenFlow dogfooding setup"
lane: Infrastructure
type: chore
status: ready
locked: false
description: |
  Complete the LumenFlow dogfooding setup after minimal bootstrap commit.
  Adds wu:* scripts, .gitignore entries, and initializes memory layer.
acceptance:
  - "wu:* scripts wired in root package.json using pnpm exec"
  - "Memory layer initialized with pnpm mem:init"
  - ".gitignore updated with worktrees/, .beacon/memory/, etc."
  - "pnpm gates passes in worktree"
code_paths:
  - "package.json"
  - ".gitignore"
notes: ""
```

### Tasks

#### 1.1 Create LumenFlow Configuration

**File:** `/home/tom/source/hellmai/os/.lumenflow.config.yaml`

```yaml
version: "2.0"
project: lumenflow

lanes:
  - name: "Core"
    wip_limit: 1
    code_paths:
      - "packages/@lumenflow/core/**"
  - name: "CLI"
    wip_limit: 1
    code_paths:
      - "packages/@lumenflow/cli/**"
  - name: "Memory"
    wip_limit: 1
    code_paths:
      - "packages/@lumenflow/memory/**"
  - name: "Agent"
    wip_limit: 1
    code_paths:
      - "packages/@lumenflow/agent/**"
  - name: "Metrics"
    wip_limit: 1
    code_paths:
      - "packages/@lumenflow/metrics/**"
  - name: "Initiatives"
    wip_limit: 1
    code_paths:
      - "packages/@lumenflow/initiatives/**"
  - name: "Shims"
    wip_limit: 1
    code_paths:
      - "packages/@lumenflow/shims/**"
  - name: "Infrastructure"
    wip_limit: 1
    code_paths:
      - "apps/**"
      - "actions/**"
  - name: "Documentation"
    wip_limit: 1
    code_paths:
      - "docs/**"

git:
  main_branch: main
  branch_pattern: "lane/{lane}/{wu_id}"

directories:
  wu_specs: "docs/tasks/wu"
  backlog: "docs/tasks/backlog.md"
  stamps: ".beacon/stamps"

worktree_pattern: "worktrees/{lane}-{wu_id}"
```

#### 1.2 Create Directory Structure (Part of Bootstrap Commit)

```bash
mkdir -p /home/tom/source/hellmai/os/.beacon/stamps
mkdir -p /home/tom/source/hellmai/os/docs/tasks/wu
touch /home/tom/source/hellmai/os/docs/tasks/backlog.md
touch /home/tom/source/hellmai/os/docs/tasks/status.md
```

**status.md** (required by wu:* tooling):

```markdown
# LumenFlow Status Board

## In Progress

_None_

## Blocked

_None_

## Recently Completed

_None_
```

#### 1.3 Wire CLI Commands to Root package.json (Build-Safe)

**Solution:** Use explicit `setup` script (not postinstall) to avoid heavy builds on every install:

```json
{
  "scripts": {
    "setup": "pnpm install && turbo build --filter=@lumenflow/cli",
    "wu:claim": "pnpm exec wu-claim",
    "wu:done": "pnpm exec wu-done",
    "wu:create": "pnpm exec wu-create",
    "wu:edit": "pnpm exec wu-edit",
    "wu:block": "pnpm exec wu-block",
    "wu:unblock": "pnpm exec wu-unblock",
    "wu:validate": "pnpm exec wu-validate",
    "gates": "pnpm exec gates",
    "mem:init": "pnpm exec mem-init",
    "mem:checkpoint": "pnpm exec mem-checkpoint"
  }
}
```

**Why `setup` instead of `postinstall`?**

- `postinstall` runs on EVERY `pnpm install` (slow, annoying for contributors)
- `setup` is explicit: run once after clone, then only when needed
- Contributors run `pnpm setup` instead of `pnpm install`
- README documents: "First time? Run `pnpm setup`"

**Note:** `pnpm install` still works but won't build CLI — `wu:*` commands will fail until `turbo build --filter=@lumenflow/cli` runs. Use `pnpm setup` for a working dev environment.

**Fresh clone workflow:**

```bash
git clone https://github.com/hellmai/os.git
cd os
pnpm setup  # Installs deps AND builds CLI
pnpm wu:claim --id WU-OS-001  # Works immediately
```

#### 1.4 Add .gitignore Entries

```gitignore
/worktrees/
/.beacon/memory/
/.beacon/locks/
/.beacon/sessions/
```

#### 1.5 Initialize Memory Layer

```bash
cd /home/tom/source/hellmai/os
pnpm setup      # Installs deps AND builds CLI (see section 1.3)
pnpm mem:init
```

### Verification (Local Only - GitHub App tested in Phase 2/3)

- [ ] `pnpm setup` completes without errors
- [ ] `pnpm wu:create --id WU-OS-001 --lane Infrastructure --title "Test WU"` succeeds
- [ ] `pnpm wu:claim --id WU-OS-001 --lane Infrastructure` creates worktree
- [ ] `pnpm gates` runs in worktree
- [ ] `pnpm wu:done --id WU-OS-001` merges and creates stamp

---

## Phase 2: Publish to npm

### Current State

- Build tooling ready: `pnpm build:dist` produces JS + .d.ts
- Pack tooling ready: `pnpm pack:all` creates .tgz files
- **Missing:** npm organization @lumenflow (or use @hellmai)

### WU for This Phase

Create `docs/tasks/wu/WU-OS-002.yaml` tracking Phase 2 work.

### Tasks

#### 2.1 Create npm Organization

**Manual step:** Go to `https://www.npmjs.com/org/create`

- Organization name: `lumenflow` (or `hellmai` as fallback)
- Type: **Private** (paid, ~$7/user/month)

#### 2.2 Configure Package Publishing

Update each package's `package.json` (7 packages):

```json
{
  "name": "@lumenflow/core",
  "version": "1.0.0",
  "publishConfig": {
    "access": "restricted",
    "registry": "https://registry.npmjs.org/"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/hellmai/os.git",
    "directory": "packages/@lumenflow/core"
  }
}
```

**All 7 packages to update:**

- `@lumenflow/core`
- `@lumenflow/cli`
- `@lumenflow/memory`
- `@lumenflow/agent`
- `@lumenflow/metrics`
- `@lumenflow/initiatives`
- `@lumenflow/shims`

#### 2.3 Setup Changesets for Versioning

```bash
pnpm add -Dw @changesets/cli
pnpm changeset init
```

Configure `.changeset/config.json` with **explicit package names** (not glob):

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [
    [
      "@lumenflow/core",
      "@lumenflow/cli",
      "@lumenflow/memory",
      "@lumenflow/agent",
      "@lumenflow/metrics",
      "@lumenflow/initiatives",
      "@lumenflow/shims"
    ]
  ],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch"
}
```

#### 2.4 Add Release Scripts (with Gates)

Add to root `package.json`:

```json
{
  "scripts": {
    "prerelease": "pnpm gates && pnpm build:dist",
    "release": "changeset publish",
    "version": "changeset version"
  }
}
```

**Critical:** `prerelease` runs gates before publish to enforce LumenFlow DoD.

#### 2.5 npm Authentication

```bash
npm login --registry=https://registry.npmjs.org/
# OR use NPM_TOKEN in CI
```

#### 2.6 First Publish

```bash
pnpm gates              # Verify all gates pass
pnpm build:dist         # Build for distribution
pnpm changeset          # Create changeset for v1.0.0
pnpm changeset version  # Bump versions
pnpm changeset publish  # Publish to npm
```

### Verification

- [ ] `npm info @lumenflow/core` shows published package
- [ ] `npm install @lumenflow/cli` installs (requires npm org membership)
- [ ] Binaries work after install (`npx wu-claim --help`)

---

## Phase 3: Migrate PatientPath to npm Packages

### Current State

- PatientPath has `"@lumenflow/core": "file:/home/tom/source/hellmai/os/packages/@lumenflow/core"`
- CLI commands use local `tools/wu-*.mjs` wrappers (import from @lumenflow/core)
- GitHub App NOT installed on PatientPath repo

### WU for This Phase

Create `docs/04-operations/tasks/wu/WU-XXXX.yaml` in PatientPath tracking migration.

### Tasks

#### 3.1 Audit ALL @lumenflow Dependencies and Scripts

**Required audit commands (run before migration):**

```bash
# Find all @lumenflow references in package.json files
grep -r "@lumenflow" --include="package.json" /home/tom/source/hellmai/patientpath.co.uk/

# Find all imports from @lumenflow in source code
grep -rn "from '@lumenflow" --include="*.ts" --include="*.mjs" /home/tom/source/hellmai/patientpath.co.uk/
grep -rn "from \"@lumenflow" --include="*.ts" --include="*.mjs" /home/tom/source/hellmai/patientpath.co.uk/

# Find any file: links that might be missed
grep -r "file:/home/tom/source/hellmai/os" /home/tom/source/hellmai/patientpath.co.uk/
```

**Expected findings (verified 2026-01-18):**

| Location | Reference | Action |
|----------|-----------|--------|
| `package.json` | `"@lumenflow/core": "file:..."` | Replace with `^1.0.0` |
| `tools/wu-*.mjs` | `import from '@lumenflow/core'` | No change needed (uses installed package) |

**If additional @lumenflow/* packages found:**

- Add each to package.json dependencies
- Update to `^1.0.0` (same version as core)
- Ensure all packages published in Phase 2

**Migration checklist:**

- [ ] Run all three grep commands above
- [ ] Document any findings not in expected list
- [ ] Update ALL file: links to npm versions
- [ ] Verify no hardcoded paths remain

#### 3.2 Update PatientPath Dependencies

In `/home/tom/source/hellmai/patientpath.co.uk/package.json`:

```diff
- "@lumenflow/core": "file:/home/tom/source/hellmai/os/packages/@lumenflow/core"
+ "@lumenflow/core": "^1.0.0"
```

Then:

```bash
pnpm install  # Will pull from npm registry
```

#### 3.3 GitHub App (Not Needed for Solo Work)

PatientPath uses trunk-only workflow with CLI enforcement:
```
wu:claim → worktree → implement → gates → wu:done → pushes to main
```

**What you get with CLI alone:**
- ✅ WU specs (right-sized work)
- ✅ Lanes (domain separation)
- ✅ Gates (quality enforcement)
- ✅ Memory layer (context recovery)
- ✅ Stamps (completion proof)

**GitHub App is for customers** who need:
- Team coordination (multiple people)
- Automated PR validation
- Label-based WIP enforcement

> **Future option:** If you add collaborators, install from `https://github.com/apps/lumenflow-by-hellmai`

#### 3.4 ~~Update Workflow Docs for PR-Based Flow~~ (SKIPPED)

**No changes needed.** PatientPath keeps trunk-only workflow. Current docs remain valid.

#### 3.5 Verify CLI Still Works (Required)

- [ ] `pnpm install` pulls from npm (not file: link)
- [ ] `pnpm wu:claim --id WU-XXXX` works (local tools/ still function)
- [ ] `pnpm gates` runs successfully
- [ ] `pnpm wu:done --id WU-XXXX` completes and pushes to main
- [ ] Existing WU YAMLs validate correctly

---

## Phase 4: SaaS Product Launch

### Overview

Transform LumenFlow from internal tooling to revenue-generating SaaS product.

**Key deliverables:**
- lumenflow-gates GitHub Action (enables Team tier)
- Product tiers with billing integration
- GitHub Marketplace listing

### Product Tiers

| Tier | Price | Includes |
|------|-------|----------|
| **Free** | $0/mo | GitHub App (PR validation, WIP limits), 10 WUs/month |
| **Team** | $29/mo | App + Gates Action, unlimited WUs |
| **Pro** | $99/mo | App + Gates + npm CLI access (@lumenflow/*) |

### Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CUSTOMER INFRASTRUCTURE                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ GitHub App  │    │ Gates Action│    │  npm CLI    │     │
│  │   (Free)    │    │   (Team)    │    │   (Pro)     │     │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │
│         │                  │                  │             │
│         ▼                  ▼                  ▼             │
│  ┌─────────────────────────────────────────────────┐       │
│  │              Customer's CI / Local              │       │
│  │         (runs on their infrastructure)          │       │
│  └─────────────────────────────────────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Token validation only
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    HELLMAI INFRASTRUCTURE                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐                         │
│  │ Vercel Edge │    │  Supabase   │                         │
│  │ (App API)   │◄───│ (billing,   │                         │
│  │             │    │  usage)     │                         │
│  └─────────────┘    └─────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

**Zero backend compute:** All gates/CLI runs on customer infrastructure. We only validate tokens and track usage.

### Tasks

#### 4.1 Build lumenflow-gates GitHub Action

**Location:** `hellmai/os/.github/actions/lumenflow-gates/` (monorepo, not separate repo)

**Structure:**
```
.github/actions/lumenflow-gates/
├── action.yaml          # Action metadata
├── src/
│   ├── index.ts         # Entry point
│   ├── detect.ts        # Auto-detect project type
│   ├── gates.ts         # Run gates based on type
│   └── report.ts        # Report to Checks API
├── dist/                # Compiled JS (committed)
└── README.md            # Usage documentation
```

**action.yaml:**
```yaml
name: 'LumenFlow Gates'
description: 'Run LumenFlow quality gates in CI'
branding:
  icon: 'check-circle'
  color: 'blue'
inputs:
  token:
    description: 'LumenFlow API token for tier validation'
    required: true
  config:
    description: 'Path to .lumenflow.config.yaml'
    required: false
    default: '.lumenflow.config.yaml'
runs:
  using: 'node20'
  main: 'dist/index.js'
```

**Customer usage:**
```yaml
# .github/workflows/gates.yaml
name: LumenFlow Gates
on: [pull_request]
jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hellmai/os/.github/actions/lumenflow-gates@v1
        with:
          token: ${{ secrets.LUMENFLOW_TOKEN }}
```

**Features:**
- Auto-detects project type (package.json → Node, pyproject.toml → Python, go.mod → Go)
- Runs appropriate gates for detected type
- Reports results to GitHub Checks API
- Validates token against tier (free=10 WUs/mo, team=unlimited)
- Fails gracefully if token invalid or quota exceeded

#### 4.2 Billing Integration

**Already scaffolded in:** `apps/github-app/src/lib/billing.ts`

**Current state:**
```typescript
const TIERS = {
  free: { wusPerMonth: 10, price: 0 },
  team: { wusPerMonth: 100, price: 29 },
  business: { wusPerMonth: 500, price: 99 },
  enterprise: { wusPerMonth: Infinity, price: 'custom' },
};
```

**Required updates:**
- [ ] Rename `business` → `pro` for consistency
- [ ] Wire to Supabase for usage tracking
- [ ] Add token validation endpoint for Gates Action
- [ ] Integrate with GitHub Marketplace billing webhooks

#### 4.3 GitHub Marketplace Listing

**Steps:**
1. Go to `https://github.com/marketplace`
2. Register LumenFlow app (already created: App ID 2681145)
3. Configure pricing plans matching tiers
4. Create landing page assets
5. Submit for review

**Marketplace plan mapping:**

| GitHub Plan | Our Tier | Price |
|-------------|----------|-------|
| Free | Free | $0 |
| Team | Team | $29/mo |
| Pro | Pro | $99/mo |

#### 4.4 Landing Page (lumenflow.dev)

**Minimal viable landing page:**
- Hero: "AI-native workflow for software teams"
- Feature comparison table (Free/Team/Pro)
- "Install from GitHub Marketplace" CTA
- Link to docs (hellmai/os/docs/)

**Tech:** Static site on Vercel (or GitHub Pages)

### Verification

- [ ] Gates Action runs in customer CI
- [ ] Token validation works (rejects invalid/expired)
- [ ] Usage tracking increments in Supabase
- [ ] GitHub Marketplace listing approved
- [ ] Free tier limits enforced (10 WUs/mo)
- [ ] Team/Pro tiers get unlimited access

---

## File Changes Summary

### hellmai/os (Phase 1 - Bootstrap Commit, direct to main)

| File | Action |
|------|--------|
| `.lumenflow.config.yaml` | Create (9 lanes covering all packages) |
| `.beacon/stamps/.gitkeep` | Create directory placeholder |
| `docs/tasks/wu/.gitkeep` | Create directory placeholder |
| `docs/tasks/backlog.md` | Create |
| `docs/tasks/status.md` | Create |
| `docs/plans/distribution-dogfooding.md` | Create (this plan) |

### hellmai/os (Phase 1 - WU-OS-001, via wu:claim/wu:done)

| File | Action |
|------|--------|
| `docs/tasks/wu/WU-OS-001.yaml` | Created by `wu:create` command |
| `package.json` | Add setup + wu:* scripts using `pnpm exec` |
| `.gitignore` | Add worktrees/, .beacon/memory/, etc. |

### hellmai/os (Phase 2)

| File | Action |
|------|--------|
| `packages/@lumenflow/*/package.json` | Add publishConfig (7 files) |
| `.changeset/config.json` | Create with explicit package list |
| `package.json` | Add release scripts with gates |
| `docs/tasks/wu/WU-OS-002.yaml` | Create (meta-WU for Phase 2) |

### patientpath.co.uk (Phase 3)

| File | Action |
|------|--------|
| `package.json` | Change @lumenflow/core from file: to ^1.0.0 |
| `docs/04-operations/tasks/wu/WU-XXXX.yaml` | Create (migration WU) |

### hellmai/os (Phase 4)

| File | Action |
|------|--------|
| `.github/actions/lumenflow-gates/action.yaml` | Create action metadata |
| `.github/actions/lumenflow-gates/src/index.ts` | Create entry point |
| `.github/actions/lumenflow-gates/src/detect.ts` | Create project type detection |
| `.github/actions/lumenflow-gates/src/gates.ts` | Create gates runner |
| `.github/actions/lumenflow-gates/src/report.ts` | Create Checks API reporter |
| `.github/actions/lumenflow-gates/dist/` | Compiled JS (committed) |
| `apps/github-app/src/lib/billing.ts` | Update tiers, add Supabase integration |
| `apps/github-app/api/validate-token.ts` | Create token validation endpoint |
| `docs/tasks/wu/WU-OS-003.yaml` | Create (Gates Action WU) |
| `docs/tasks/wu/WU-OS-004.yaml` | Create (Marketplace listing WU) |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| npm org name `@lumenflow` taken | Use `@hellmai` scope as fallback |
| Breaking changes post-1.0.0 | PatientPath can pin to exact version |
| Private npm requires auth | Document team onboarding for npm access |
| CLI bin not found after install | Verify bin entries in @lumenflow/cli package.json (confirmed: 30+ bins exist) |
| Changesets glob pattern fails | Use explicit package names in linked array (fixed) |
| Gates skipped before publish | prerelease script enforces gates (fixed) |
| Marketplace approval delayed | Ship Gates Action first, add Marketplace later |
| Token validation adds latency | Edge function on Vercel (~50ms) |
| Multi-language gates complexity | Start with Node.js only, add Python/Go later |

---

## Execution Order

1. **Phase 1** - Bootstrap + dogfood setup in hellmai/os
2. **Phase 2** - Create npm org + first publish
3. **Phase 3** - PatientPath migration
4. **Phase 4** - Gates Action + billing + Marketplace

**Dependency chain:**
- Phase 2 depends on Phase 1 (need working workflow)
- Phase 3 depends on Phase 2 (need published packages)
- Phase 4 can start after Phase 1 (GitHub App already deployed)

---

## Backlog Alignment (LumenFlow Compliance)

Per "Backlog is Law" principle, create WUs before execution:

| Phase | WU ID | Title | Lane |
|-------|-------|-------|------|
| 1 | WU-OS-001 | Dogfood LumenFlow in hellmai/os | Infrastructure |
| 2 | WU-OS-002 | Publish @lumenflow packages to npm | Infrastructure |
| 3 | WU-PP-XXX | Migrate PatientPath to npm packages | Operations |
| 4 | WU-OS-003 | Build lumenflow-gates GitHub Action | Infrastructure |
| 4 | WU-OS-004 | GitHub Marketplace listing + billing | Infrastructure |

Each WU should include:

- Lane assignment
- Acceptance criteria (verification checklists from this plan)
- Code paths
- Status tracking

---

## CLI Binary Availability

**Verification step (run during Phase 2):**

```bash
# Count bin entries in @lumenflow/cli package.json
cat /home/tom/source/hellmai/os/packages/@lumenflow/cli/package.json | jq '.bin | keys | length'

# List all bin names
cat /home/tom/source/hellmai/os/packages/@lumenflow/cli/package.json | jq '.bin | keys[]'
```

**Expected bins** (verify exists before publish):

- `wu-claim`, `wu-done`, `wu-block`, `wu-unblock`, `wu-create`, `wu-edit`
- `wu-spawn`, `wu-validate`, `wu-preflight`, `wu-repair`, `wu-prune`, `wu-cleanup`
- `mem-init`, `mem-checkpoint`, `mem-start`, `mem-ready`, `mem-signal`, `mem-inbox`
- `initiative-create`, `initiative-list`, `initiative-status`, `initiative-add-wu`
- `gates`, `lumenflow-gates`, `spawn-list`

After `npm install @lumenflow/cli`, these are available via `npx wu-claim` or in scripts.
