# LumenFlow Sub-Lanes

**Status:** Active (WU-906, expanded WU-1565)
**Last updated:** 2025-12-10

## Overview

Sub-lanes enable fine-grained parallelism within parent lanes by organizing work into focused domains. This allows multiple agents to work in parallel without violating WIP=1 constraints.

**Key principle:** WIP=1 applies at the **sub-lane level**, not parent lane level.

### Taxonomy

ExampleApp uses an 8-tier taxonomy with 33 sub-lanes across all parent lanes:

**Intelligence (4 sub-lanes)**

- **Prompts:** Prompt engineering, base prompts, overlays, instruction stacks
- **Classifiers:** LLM classification (mode, red-flag, PHI, entity recognition)
- **Orchestrator:** Conversation orchestration, streaming, header parsing
- **Evaluation:** Prompt evaluation, golden datasets, LLM-judge harness

**Operations (8 sub-lanes)**

- **Tooling:** WU lifecycle tools, linters, validators (legacy/mixed bucket)
- **CI/CD:** GitHub Actions, build pipelines, deployment, release automation
- **Security:** Authentication, authorization, PHI protection, secrets management
- **Governance:** LumenFlow framework, COS, workflow documentation, process improvement
- **CLI:** CLI commands (wu:_, metrics:_), argument parsing, output formatting, DX
- **Workflow Engine:** WU lifecycle invariants, validation logic, lane-checker, schema
- **Gates:** COS gates, pre-commit/pre-push hooks, quality gates wiring
- **Scripts:** One-off/recurring scripts, migrations, sync jobs, batch operations

**Core Systems (3 sub-lanes)**

- **API:** Next.js API routes, endpoints, request/response handling
- **Data:** Database schemas, migrations, models, data persistence
- **Infra:** Infrastructure config, monitoring, logging, observability

**Experience (6 sub-lanes)**

- **Chat:** Beacon chat experience (chat UI, composer, attachments, content blocks)
- **Space:** Space area (widgets, tabs, timeline, journal, letters)
- **Settings:** Settings area (account, preferences, care profile, documents, collaboration)
- **Web:** Next.js web app, React components, pages, routing
- **Mobile:** Mobile app development (React Native, iOS, Android)
- **Design System:** Design tokens, UI component library, theming, accessibility

**Discovery (3 sub-lanes)**

- **Research:** User/clinical/market research, investigations
- **Prototypes:** Spikes, POCs, experiments
- **Analysis:** Synthesis, comparison, decision documents

**Customer (3 sub-lanes)**

- **Onboarding:** Setup, playbooks, in-product onboarding flows
- **Support:** Incident handling, troubleshooting, helpdesk
- **Success:** Health checks, adoption programs, success metrics

**Revenue Ops (3 sub-lanes)**

- **Pricing:** Price/packaging changes, discount policies, revenue model
- **Sales:** Pipeline tooling, enablement collateral, CRM
- **Analytics:** Funnel/retention/ARR dashboards, revenue reporting

**Comms (3 sub-lanes)**

- **Marketing:** Site copy, campaigns, ads, launch plans
- **Community:** Events, communities, advocates, social
- **Content:** Blog posts, long-form content, docs-as-content

## Lane Inference System

### How It Works

When creating a new WU, the system automatically suggests a sub-lane based on:

1. **Code paths:** Files modified/created by the WU (higher weight)
2. **Description keywords:** Words in WU title/description (lower weight)
3. **Confidence score:** 0-100% indicating match strength

The suggestion is **NOT enforcement**—you can always override it.

### Example Inference

```bash
# WU modifying tools/wu-claim.mjs and docs/04-operations/tasks/
pnpm wu:create --id WU-123 --title "Fix wu:claim validation"

# System suggests: "Operations: Tooling" (confidence: 85%)
# - Code path matches: tools/ (match)
# - Keyword matches: "wu:claim", "validation"
```

### Overriding Suggestions

If the suggested sub-lane is incorrect:

```bash
# Accept suggestion (default)
pnpm wu:create --id WU-123 --lane "Operations: Tooling" --title "..."

# Override with different sub-lane
pnpm wu:create --id WU-123 --lane "Operations: Security" --title "..."

# Use parent-only format (legacy, not recommended)
pnpm wu:create --id WU-123 --lane "Operations" --title "..."
```

### Agent Instructions for Lane Selection

**For LLM agents creating WUs:** Read `.lumenflow.lane-inference.yaml` and choose the appropriate sub-lane based on code paths and WU description. The taxonomy defines 33 sub-lanes across all 8 parents:

**Intelligence (4 sub-lanes):**

- **Prompts** — `ai/prompts/**`, keywords: prompt, overlay, instruction, warmth
- **Classifiers** — `packages/classifiers/**`, keywords: classifier, mode detection, PHI, red flag
- **Orchestrator** — `apps/web/src/lib/orchestrator/**`, keywords: orchestrator, streaming, conversation
- **Evaluation** — `tools/prompts-eval/**`, keywords: evaluation, golden, llm-judge

**Operations (8 sub-lanes):**

- **Tooling** — `tools/**`, `.claude/**`, keywords: wu:claim, wu:done, validator, linter (legacy/mixed bucket)
- **CI/CD** — `.github/workflows/**`, keywords: pipeline, workflow, CI, deployment, build
- **Security** — `docs/04-operations/security/**`, keywords: auth, PHI, secrets, encryption, HIPAA
- **Governance** — `docs/04-operations/_frameworks/**`, `CLAUDE.md`, keywords: lumenflow, COS, workflow, governance
- **CLI** — `tools/wu-*.mjs`, `tools/metrics/**`, keywords: cli, command, flags, developer experience
- **Workflow Engine** — `tools/lib/lane-*.mjs`, `tools/lib/wu-*.mjs`, keywords: validation, schema, lane, inference
- **Gates** — `tools/gates*.mjs`, `.husky/**`, keywords: gate, hook, cos, pre-commit, quality gate
- **Scripts** — `tools/scripts/**`, keywords: script, cron, batch, migrate, sync, repair

**Core Systems (3 sub-lanes):**

- **API** — `apps/web/src/app/api/**`, keywords: API, endpoint, route, request, response
- **Data** — `packages/database/**`, `migrations/**`, `supabase/supabase/**`, keywords: database, schema, migration, model
- **Infra** — `infrastructure/**`, `docker/**`, keywords: infrastructure, deployment, monitoring, logging

**Experience (6 sub-lanes):**

- **Chat** — `apps/web/src/components/ui/BeaconChat*.tsx`, `apps/web/src/lib/assistant-ui/**`, keywords: chat, composer, assistant, stream
- **Space** — `apps/web/src/app/space/**`, keywords: space, widget, timeline, journal, letters
- **Settings** — `apps/web/src/app/settings/**`, keywords: settings, preferences, account, care profile
- **Web** — `apps/web/src/app/**`, `apps/web/src/components/**`, keywords: component, page, UI, React
- **Mobile** — `apps/mobile/**`, keywords: mobile, iOS, Android, React Native
- **Design System** — `packages/design-system/**`, keywords: design system, theming, accessibility

**Discovery (3 sub-lanes):**

- **Research** — `docs/research/**`, keywords: research, interview, discovery, user study, investigation
- **Prototypes** — `prototypes/**`, keywords: prototype, spike, poc, experiment, proof of concept
- **Analysis** — `docs/archive/decisions/**`, keywords: analysis, findings, comparison, trade-off

**Customer (3 sub-lanes):**

- **Onboarding** — `apps/web/src/app/onboarding/**`, keywords: onboarding, setup, welcome, tutorial
- **Support** — `docs/05-business/support/**`, keywords: support, incident, troubleshoot, helpdesk, ticket
- **Success** — `docs/05-business/success/**`, keywords: success, adoption, health check, retention, NPS

**Revenue Ops (3 sub-lanes):**

- **Pricing** — `docs/05-business/pricing/**`, keywords: pricing, package, discount, tier, subscription
- **Sales** — `docs/05-business/sales/**`, keywords: sales, pipeline, enablement, crm, lead, prospect
- **Analytics** — `docs/05-business/reports/**`, keywords: analytics, funnel, retention, arr, mrr, churn

**Comms (3 sub-lanes):**

- **Marketing** — `apps/web/src/app/(marketing)/**`, keywords: marketing, campaign, launch, ads, landing page
- **Community** — `docs/05-business/community/**`, keywords: community, event, advocate, social, discord
- **Content** — `blog/**`, keywords: blog, content, article, post, guide

**Usage:**

```bash
# Agent decides lane from taxonomy + code_paths
pnpm wu:create \
  --id WU-1234 \
  --lane "Operations: CLI" \
  --title "Fix wu:claim validation"
```

**Rules:**

- Use sub-lane format for ALL parent lanes (all 8 parents now have taxonomy)
- Parent-only format is deprecated; always specify a sub-lane

### Testing Inference

Test inference on existing WUs without creating them:

```bash
# Dry-run inference on specific WU
pnpm wu:infer-lane --id WU-906

# Output:
# WU-906: Operations: Tooling (confidence: 90%)
# - Matched patterns: tools/, .claude/
# - Matched keywords: tool, CLI, validator
```

## When to Add New Sub-Lanes

### Demand Threshold: 15-30%

Add a new sub-lane when:

1. **Volume threshold:** Sub-lane would contain 15-30% of parent lane's WUs
2. **Domain cohesion:** Work forms a distinct, cohesive domain
3. **Parallelism benefit:** Enables meaningful parallel work streams

### Examples

**✅ Good candidate:**

- Intelligence lane has 94 WUs
- 20 WUs focus on "Evaluation" (21% of lane)
- Work is cohesive (golden datasets, LLM-judge, metrics)
- **Decision:** Add "Intelligence: Evaluation" sub-lane

**❌ Poor candidate:**

- Operations lane has 185 WUs
- 5 WUs focus on "Documentation" (2.7% of lane)
- Work is scattered (various doc types, no common domain)
- **Decision:** Keep as "Operations: Governance" or parent-only

### Process for Adding Sub-Lanes

1. **Measure demand:** Count ready WUs that would belong to proposed sub-lane
2. **Validate cohesion:** Ensure work forms a natural, focused domain
3. **Update config:** Add sub-lane to `.lumenflow.lane-inference.yaml`
4. **Document:** Update this file's taxonomy section
5. **Migrate:** Use `pnpm wu:infer-lane` + `pnpm wu:edit` to update existing WUs

## Configuration

### Location

Sub-lane definitions live in `.lumenflow.lane-inference.yaml` at project root.

### Structure

```yaml
ParentLane:
  SubLane:
    description: 'Brief description of sub-lane scope'
    code_paths:
      - 'path/to/code/'
      - 'specific-file.md'
    keywords:
      - 'keyword1'
      - 'keyword2'
```

### Tuning Accuracy

If inference accuracy drops below 70%:

1. **Review mismatches:** Identify WUs with incorrect suggestions
2. **Refine patterns:** Add more specific code_paths or keywords
3. **Re-test:** Run `pnpm wu:infer-lane` on sample WUs
4. **Iterate:** Adjust config until accuracy ≥70%

## Accuracy Tracking

**Current baseline:** Not yet established (system just deployed)

**Target:** ≥70% accuracy on first-time suggestions

**Measurement:**

- Log all inference results during `wu:create`
- Track manual overrides (indicates wrong suggestion)
- Calculate accuracy = (accepted / total) × 100%

**Improvement process:**

1. Collect 50+ WU creations for statistical significance
2. Analyze patterns in overrides
3. Refine config patterns/keywords
4. Re-test and measure improvement

## Migration Strategy

### Retrofit Existing WUs

Use lane inference to suggest a sub-lane, then update the WU spec via `wu:edit`:

```bash
# Suggest lane from an existing WU spec
pnpm wu:infer-lane --id WU-123

# Or suggest lane from paths/description
pnpm wu:infer-lane --paths "apps/web/src/app/settings/**" --desc "Settings UI work"

# Apply update after review
pnpm wu:edit --id WU-123 --lane "Experience: Settings"
```

**What gets migrated:**

- ✅ **Ready WUs:** Automatically migrated (high-confidence only)
- ⚠️ **In Progress WUs:** Finish current work first, no migration
- ❌ **Done WUs:** Historical record, leave unchanged

### Manual Review

Low-confidence suggestions (<70%) are flagged for manual review:

```
Migration Report:
High Confidence (≥70%): 45 WUs → migrated
Low Confidence (<70%): 5 WUs → flagged for manual review

Low Confidence WUs Requiring Manual Review:
- WU-123: Operations → ??? (confidence: 42%)
- WU-124: Intelligence → ??? (confidence: 58%)
```

Manually review flagged WUs and update lane field in YAML.

## Format Specification

### Valid Formats

**Sub-lane format (preferred):**

```yaml
lane: 'Operations: Tooling'
```

**Parent-only format (legacy):**

```yaml
lane: 'Operations'
```

### Format Rules

1. **Colon spacing:** Space AFTER colon only (`Parent: Sub`, not `Parent : Sub` or `Parent :Sub`)
2. **Single colon:** Only one colon allowed
3. **Valid parents:** Parent must exist in `.lumenflow.config.yaml`
4. **Case-sensitive:** Use exact capitalization from config

### Validation

Format validation is automatic:

```bash
# wu:create validates format before YAML creation
pnpm wu:create --id WU-123 --lane "Operations : Tooling"
# Error: Invalid lane format (space before colon)

# wu:claim validates format before claiming
pnpm wu:claim --id WU-123 --lane "Unknown: Domain"
# Error: Unknown parent lane: "Unknown"
```

## Best Practices

### When Creating WUs

1. **Trust the suggestion:** Inference is usually correct (target: ≥70%)
2. **Review confidence:** Low confidence (<70%) suggests unclear scope—clarify WU description
3. **Override when needed:** Use domain knowledge to correct wrong suggestions
4. **Report mismatches:** Help improve accuracy by noting when suggestions are wrong

### When Migrating WUs

1. **Run dry-run first:** Always preview migrations before applying
2. **Review low-confidence:** Manually validate WUs flagged for review
3. **Check WU scope:** If inference is unclear, WU scope may be too broad—consider splitting
4. **Update descriptions:** Clear, keyword-rich descriptions improve future inference

### When Adding Sub-Lanes

1. **Measure demand first:** Ensure 15-30% threshold is met
2. **Start conservative:** Better to wait and validate demand than proliferate sub-lanes prematurely
3. **Document rationale:** Update this file with decision reasoning
4. **Migrate atomically:** Add config + migrate WUs + update docs in single WU

## See Also

- [lumenflow-complete.md](lumenflow-complete.md) — Complete LumenFlow framework
- [WU-900](../../tasks/wu/WU-900.yaml) — Sub-lane taxonomy specification
- [WU-902](../../tasks/wu/WU-902.yaml) — Format validation implementation
- [WU-903](../../tasks/wu/WU-903.yaml) — Migration tooling implementation
- [WU-906](../../tasks/wu/WU-906.yaml) — Infrastructure files
- [WU-1565](../../tasks/wu/WU-1565.yaml) — Lane taxonomy expansion (14 → 30 sub-lanes)
