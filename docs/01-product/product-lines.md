# LumenFlow Product Lines

This document describes the complete LumenFlow product architecture, distribution channels, and customer journeys.

---

## Repository Structure

```
hellmai/os                             hellmai/patientpath.co.uk
════════════                           ══════════════════════════
LumenFlow source                       Consumer (uses LumenFlow)

packages/                              package.json
├── @lumenflow/core                      └── "@lumenflow/core": "^1.0.0"
├── @lumenflow/cli        ──────►          (from npm, not file:)
├── @lumenflow/memory
├── @lumenflow/agent
├── @lumenflow/metrics
├── @lumenflow/initiatives
└── @lumenflow/shims

apps/
└── github-app/           ──────►      Vercel: lumenflow-app.vercel.app
    ├── api/webhook.ts                 (handles PR events)
    └── src/lib/

.github/actions/
└── lumenflow-gates/      ──────►      Customers use in their workflows
    └── action.yml
```

---

## Distribution Channels

```
                        ┌──────────────────┐
                        │   hellmai/os     │
                        │   (source code)  │
                        └────────┬─────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
                 ▼                               ▼
    ┌────────────────────┐          ┌────────────────────┐
    │    npm publish     │          │   Vercel deploy    │
    │                    │          │                    │
    │  @lumenflow/core   │          │  GitHub App        │
    │  @lumenflow/cli    │          │  (webhooks)        │
    │  @lumenflow/memory │          │                    │
    │  ...               │          │  + Gates Action    │
    └─────────┬──────────┘          └─────────┬──────────┘
              │                               │
              ▼                               ▼
    ┌────────────────────┐          ┌────────────────────┐
    │  CHANNEL 1: npm    │          │  CHANNEL 2: GitHub │
    │                    │          │  Marketplace       │
    │  For: You          │          │                    │
    │  For: Pro tier     │          │  For: Free/Team    │
    │  For: Power users  │          │  For: Teams        │
    └────────────────────┘          └────────────────────┘
```

---

## Product Tiers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  FREE (GitHub App only)              TEAM ($29/mo)        PRO ($99/mo)      │
│  ═════════════════════               ════════════         ═══════════       │
│                                                                             │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────┐ │
│  │ ✓ WU spec validation│    │ Everything in Free  │    │ Everything in   │ │
│  │ ✓ WIP enforcement   │    │ +                   │    │ Team +          │ │
│  │ ✓ Lane labels       │    │ ✓ Gates Action      │    │ ✓ npm CLI       │ │
│  │ ✓ Stamps on merge   │    │ ✓ Language presets  │    │ ✓ Memory layer  │ │
│  │ ✓ 10 WUs/month      │    │ ✓ Unlimited WUs     │    │ ✓ Initiatives   │ │
│  │                     │    │                     │    │ ✓ Agent coord   │ │
│  │ Runs: Vercel        │    │ Runs: Their CI      │    │ Runs: Local     │ │
│  │ Cost to you: $0     │    │ Cost to you: $0     │    │ Cost to you: $0 │ │
│  └─────────────────────┘    └─────────────────────┘    └─────────────────┘ │
│                                                                             │
│         │                           │                           │           │
│         └───────────────────────────┼───────────────────────────┘           │
│                                     │                                       │
│                                     ▼                                       │
│                          All run on THEIR infra                             │
│                          You pay $0 to operate                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Customer Journeys

### Journey A: Team discovers LumenFlow (SaaS path)

```
1. Find on GitHub Marketplace
          │
          ▼
2. Click "Install" on their repo
          │
          ▼
3. App creates setup PR with:
   • .lumenflow.config.yaml
   • .github/workflows/lumenflow.yml
          │
          ▼
4. They merge PR, start using:
   • Create PRs with "## WU-123: Title" format
   • App validates, adds labels
   • Gates Action runs format/lint/test
   • Merge creates stamp
          │
          ▼
5. Hit 10 WU/month limit → Upgrade to Team ($29)
          │
          ▼
6. Want CLI tools? → Upgrade to Pro ($99), get npm access
```

### Journey B: Direct consumer (npm path)

```
1. package.json: "@lumenflow/core": "^1.0.0"
          │
          ▼
2. pnpm install (pulls from private npm)
          │
          ▼
3. Use CLI directly:
   • pnpm wu:claim --id WU-123
   • pnpm gates
   • pnpm wu:done
          │
          ▼
4. Trunk-based, no PRs needed
   (GitHub App optional)
```

---

## Feature Matrix

### @lumenflow/cli (30+ commands)

| Category | Commands |
|----------|----------|
| **WU Workflow** | `wu-claim`, `wu-done`, `wu-create`, `wu-edit`, `wu-block`, `wu-unblock` |
| **Quality Gates** | `gates` (format, lint, typecheck, tests) |
| **Memory Layer** | `mem-init`, `mem-checkpoint`, `mem-ready`, `mem-inbox`, `mem-signal` |
| **Multi-WU Initiatives** | `initiative-create`, `initiative-status`, `initiative-add-wu` |
| **Agent Coordination** | `wu-spawn`, `spawn-list`, `mem-triage` |
| **Maintenance** | `wu-validate`, `wu-preflight`, `wu-repair`, `wu-prune`, `wu-cleanup` |

### GitHub App

| Feature | Implementation |
|---------|----------------|
| WU Spec Validation | Parses PR body for `## WU-123: Title`, lane, acceptance criteria |
| Lane WIP Enforcement | Blocks PR if lane already has one in progress |
| Lane Labels | Adds `lane:core`, `lane:infrastructure`, etc. |
| Stamp Creation | Creates completion stamp on merge |
| Billing | Tracks WU usage per tier |

### Feature Comparison

| LumenFlow Feature | CLI | GitHub App | Notes |
|-------------------|-----|------------|-------|
| WU specs | ✅ | ✅ (parse only) | App validates PR body |
| Lanes/WIP | ✅ | ✅ | App uses labels |
| Gates (format/lint/test) | ✅ | ✅ (via Action) | Action runs in their CI |
| Memory layer | ✅ | ❌ | CLI-only feature |
| Agent coordination | ✅ | ❌ | CLI-only feature |
| Initiatives | ✅ | ❌ | CLI-only feature |
| Worktree isolation | ✅ | ❌ | CLI-only feature |
| Stamps | ✅ | ✅ | Both create stamps |

---

## Infrastructure Costs

| Tier | What Runs | Where | Cost to Operate |
|------|-----------|-------|-----------------|
| Free | App webhooks | Vercel (free tier) | $0 |
| Team | App + Gates Action | Their CI (GitHub Actions) | $0 |
| Pro | App + npm CLI | Their machine | $0 |

**Key insight:** All compute runs on customer infrastructure. LumenFlow has near-zero operational costs.

---

## Component Independence

| Component | Works Standalone? | What It Does Alone |
|-----------|-------------------|-------------------|
| **CLI** (`@lumenflow/cli`) | ✅ Yes | Full local workflow: claim, gates, done, memory |
| **GitHub App** | ✅ Yes | PR validation, WIP enforcement, stamps |
| **Both together** | Best | CLI for local + App for team enforcement |

The CLI provides the workflow tools. The App enforces what it can observe (PRs, labels, merges). Neither requires the other, but together they provide complete enforcement.

---

## SaaS Architecture (Zero Backend)

```
Customer installs GitHub App
         ↓
App auto-creates:
  - .github/workflows/lumenflow-gates.yml (runs gates on PR)
  - .lumenflow.config.yaml (via setup PR)
         ↓
On each PR:
  - Webhook validates WU spec
  - Action runs gates (format/lint/test)
  - Checks block merge until green
         ↓
On merge:
  - Stamp created
  - Usage tracked for billing
```

**Customer experience:** Install app → Configure lanes → Create PRs with WU specs → Gates run automatically → Done.

---

**Last Updated:** 2026-01-18
