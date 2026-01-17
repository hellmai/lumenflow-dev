# LumenFlow Distribution Packaging

**Status:** In Progress
**Last Updated:** 2026-01-17

This document tracks the work to package LumenFlow for consultancy distribution.

---

## Goals

1. **Compiled npm packages** - Distribute JS + .d.ts without source code
2. **GitHub App (SaaS)** - Cloud-native workflow enforcement via webhooks
3. **Language presets** - Polyglot support (TypeScript, Python, Go, Rust)
4. **Marketplace billing** - GitHub Marketplace for subscription management

---

## Why Cloud Mode? (Local vs SaaS)

Local LumenFlow doesn't work in cloud/CI environments:

| Component | Local Mode | Cloud Blocker | SaaS Solution |
|-----------|------------|---------------|---------------|
| PID locks | File-based locks | Container restart = PID mismatch | GitHub labels |
| Worktrees | Isolated directories | Ephemeral filesystem | Branch-only mode |
| Memory layer | Session tracking | Lost on restart | Not needed (single agent) |
| Lane locks | `.beacon/locks/` | Multiple runners = race conditions | Label-based WIP |

**Key insight:** The memory layer is already ephemeral (git-ignored). No database needed for cloud mode.

---

## What's Persisted vs Ephemeral

### Git-Tracked (Source of Truth)

These survive container restarts and are the audit trail:

```
.beacon/stamps/WU-*.done      # Completion proof
.beacon/agent-runs/*.stamp    # Mandatory agent audit trail
docs/04-operations/tasks/wu/  # WU specs (YAML)
```

### Git-Ignored (Session-Local)

These are ephemeral and rebuilt per session:

```
.beacon/memory/               # Memory layer (checkpoints, sessions)
.beacon/locks/                # Lane locks (PID-based)
.beacon/sessions/             # Active session state
worktrees/                    # Git worktrees for isolation
```

**Implication:** Cloud mode only needs to create stamps - everything else is disposable.

---

## Value Proposition

| Pitch | What It Means |
|-------|---------------|
| **"AI That Ships"** | Gates catch broken code before merge |
| **"Structured AI"** | WU specs prevent scope creep |
| **"Compliance-Ready"** | Mandatory agent stamps as audit trail |
| **"Right-Sized Tasks"** | Lane + sizing guide = predictable work |

---

## Cost Model

| Item | Cost | Notes |
|------|------|-------|
| GitHub App hosting | $0 | Vercel free tier (Edge Functions) |
| GitHub API | $0 | Clients use their own quota |
| Actions minutes | $0 | Runs in client's repo |
| Domain | ~$15/year | lumenflow.dev |
| **Total** | **~$30/month** | Mostly optional extras |

**Margin:** 90%+ (GitHub Marketplace takes 25% first year, negotiable after)

---

## Update Propagation

| Layer | How Updates Reach Clients | Client Action Required |
|-------|---------------------------|------------------------|
| Webhook App | `vercel --prod` | None (instant) |
| Gates Action | `git tag v1.x` | Auto via semver pin (`@v1`) |
| Templates | Changelog announcement | Manual copy |

**Example:** Bug fix in WU validation → deploy webhook → all 100 clients get it instantly.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    DISTRIBUTION CHANNELS                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │   npm Packages   │    │   GitHub App     │                   │
│  │   (compiled)     │    │   (SaaS)         │                   │
│  └────────┬─────────┘    └────────┬─────────┘                   │
│           │                       │                             │
│           ▼                       ▼                             │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │ Local CLI        │    │ Webhook Handler  │                   │
│  │ - wu:claim       │    │ - PR validation  │                   │
│  │ - wu:done        │    │ - WIP limits     │                   │
│  │ - gates          │    │ - Stamps         │                   │
│  │ - worktrees      │    │ - Billing        │                   │
│  └──────────────────┘    └──────────────────┘                   │
│           │                       │                             │
│           └───────────┬───────────┘                             │
│                       ▼                                         │
│           ┌──────────────────────┐                              │
│           │  lumenflow-gates     │                              │
│           │  (GitHub Action)     │                              │
│           │  - Language presets  │                              │
│           │  - Auto-detection    │                              │
│           └──────────────────────┘                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Completed Work

### 1. Build Configuration for npm Distribution ✅

**Commit:** `e6c6803` (2026-01-17)

Added distribution build tooling that produces compiled packages without source maps:

| File | Purpose |
|------|---------|
| `tsconfig.build.json` (root) | Base config: declarations=true, sourceMap=false |
| `packages/*/tsconfig.build.json` | Per-package build configs |
| `turbo.json` tasks | `build:dist`, `pack:dist`, `clean` |
| `package.json` scripts | `build:dist`, `pack:all`, `clean` |

**Usage:**
```bash
pnpm build:dist   # Build all packages (JS + .d.ts, no source maps)
pnpm pack:all     # Create .tgz files for each package
```

**Output:** `packages/@lumenflow/*/*.tgz` files ready for npm publish

### 2. GitHub App Scaffold ✅

**Commit:** `6d29bb0` (2026-01-17)

Added `apps/github-app/` with cloud-native workflow enforcement:

| File | Purpose |
|------|---------|
| `src/webhooks/handler.ts` | Main webhook handler (~140 lines) |
| `src/lib/billing.ts` | GitHub Marketplace subscription tiers |
| `src/lib/wu-validator.ts` | Parse WU spec from PR body |
| `src/lib/lane-enforcer.ts` | WIP limits via GitHub labels |
| `src/lib/stamp-creator.ts` | Commit completion stamps on merge |
| `templates/workflows/lumenflow-gates.yml` | Client CI workflow template |
| `templates/PULL_REQUEST_TEMPLATE.md` | Client PR template |

**Features:**
- PR validation on open (WU spec, lane, acceptance criteria)
- WIP limit enforcement via labels (no PID locks needed)
- Automatic stamp creation on PR merge
- Subscription tier checking (free: 10 WUs/month)

### 3. lumenflow-gates Action ✅

**Commit:** (2026-01-17)

Added `actions/lumenflow-gates/` with polyglot language presets:

```yaml
# Client usage
- uses: hellmai/lumenflow-gates@v1
  with:
    preset: auto  # Detects from package.json, pyproject.toml, go.mod
```

**Presets implemented:**

| Preset | Detection | Gates |
|--------|-----------|-------|
| `node` | package.json | format, lint, typecheck, test |
| `python` | pyproject.toml | ruff format, ruff check, mypy, pytest |
| `go` | go.mod | gofmt, golangci-lint, go test |
| `rust` | Cargo.toml | cargo fmt, cargo clippy, cargo test |
| `auto` | All above | Detect and run appropriate preset |

### 4. GitHub App Manifest ✅

**Commit:** (2026-01-17)

Added `apps/github-app/app.yml` for one-click GitHub App registration:
- Webhook events: `pull_request`, `check_run`, `check_suite`
- Permissions: `checks:write`, `contents:write`, `pull_requests:read`, `issues:write`
- Marketplace categories: continuous-integration, code-quality, project-management

### 5. Vercel Deployment Config ✅

**Commit:** (2026-01-17)

Added deployment configuration:
- `apps/github-app/vercel.json` - Vercel project config
- `apps/github-app/api/webhook.ts` - Vercel API route
- `apps/github-app/api/health.ts` - Health check endpoint
- `apps/github-app/.env.example` - Environment variables template

---

## Remaining Work

### 6. GitHub Marketplace Listing ⏳

**Priority:** Low (after deployment)
**Effort:** 1 hour

Create Marketplace listing with pricing tiers:

| Tier | Price | WUs/month | Features |
|------|-------|-----------|----------|
| Free | $0 | 10 | Basic validation, 1 lane |
| Team | $29/mo | 100 | All lanes, email support |
| Business | $99/mo | 500 | Priority support, custom lanes |
| Enterprise | Custom | Unlimited | SSO, SLA, dedicated support |

### 7. Register GitHub App ⏳

**Priority:** High (blocks deployment)
**Effort:** 30 minutes

Register app at https://github.com/settings/apps/new using the manifest.
Required before Vercel deployment can receive webhooks.

### 8. Landing Page & Docs ⏳

**Priority:** Low (marketing)
**Effort:** 2-3 days

- Landing page at lumenflow.dev
- Documentation site
- Quickstart guide for clients
- API reference

---

## Package Status

| Package | Build | Tests | Ready for npm |
|---------|-------|-------|---------------|
| @lumenflow/core | ✅ | ✅ | ✅ |
| @lumenflow/cli | ✅ | ✅ | ✅ |
| @lumenflow/memory | ✅ | ✅ | ✅ |
| @lumenflow/agent | ✅ | ✅ | ✅ |
| @lumenflow/metrics | ✅ | ✅ | ✅ |
| @lumenflow/initiatives | ✅ | ✅ | ✅ |
| @lumenflow/shims | ✅ | ✅ | ✅ |

---

## Client Integration Modes

### Mode 1: Local CLI (Full)

For teams wanting full LumenFlow with worktrees and local enforcement:

```bash
npm install -g @lumenflow/cli
lumenflow init
lumenflow wu:claim --id WU-123 --lane "Core Systems"
# Work in worktree...
lumenflow wu:done --id WU-123
```

### Mode 2: GitHub App (Lite)

For teams wanting cloud-native enforcement without local tooling:

1. Install GitHub App from Marketplace
2. Copy `lumenflow-gates.yml` to `.github/workflows/`
3. Copy `PULL_REQUEST_TEMPLATE.md` to `.github/`
4. Create PRs with WU spec in body
5. App validates, enforces WIP, creates stamps

### Mode 3: Hybrid

Use local CLI for development, GitHub App for CI enforcement:
- Local: `wu:claim`, `wu:done`, worktrees
- Cloud: PR validation, WIP limits, stamps

---

## Internal Use (PatientPath)

PatientPath continues using `file:` links to local packages:

```json
{
  "dependencies": {
    "@lumenflow/core": "file:../packages/@lumenflow/core"
  }
}
```

This is unaffected by distribution packaging. The `file:` links point to source, not compiled output.

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-17 | Compiled-only distribution | Protect IP while enabling external use |
| 2026-01-17 | GitHub App for SaaS | ~$0 infrastructure, instant updates |
| 2026-01-17 | GitHub Marketplace billing | Zero billing code, GitHub handles invoices |
| 2026-01-17 | Apps in monorepo | `apps/github-app/` keeps related code together |

---

## References

- [tsconfig.build.json](../tsconfig.build.json) - Distribution build config
- [GitHub App README](../apps/github-app/README.md) - SaaS webhook handler
- [GitHub App Manifest](../apps/github-app/app.yml) - One-click registration
- [lumenflow-gates Action](../actions/lumenflow-gates/README.md) - Language presets
- [Vercel Config](../apps/github-app/vercel.json) - Deployment config
