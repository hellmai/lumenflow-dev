---
sections:
  ready:
    heading: '## 🚀 Ready (pull from here)'
    insertion: after_heading_blank_line
  in_progress:
    heading: '## 🔧 In progress'
    insertion: after_heading_blank_line
  blocked:
    heading: '## ⛔ Blocked'
    insertion: after_heading_blank_line
  done:
    heading: '## ✅ Done'
    insertion: after_heading_blank_line
---

> Agent: Read **docs/04-operations/\_frameworks/lumenflow/agent/onboarding/starting-prompt.md** first, then follow **docs/04-operations/\_frameworks/lumenflow/lumenflow-complete.md** for execution.

# Backlog (single source of truth)

## 🚀 Ready (pull from here)

(No items ready)

## 🔧 In progress

- [WU-1099 — INIT-003 Phase 1: Sync CLI documentation to lumenflow.dev](wu/WU-1099.yaml) — Content: Documentation

## ⛔ Blocked

(No items currently blocked)

## ✅ Done

- [WU-1079 — Migrate stamps from ._legacy to .lumenflow](wu/WU-1079.yaml)
- [WU-1078 — Fix wu:repair to use micro-worktree isolation](wu/WU-1078.yaml)
- [WU-1077 — Fix release script to work entirely in micro-worktree](wu/WU-1077.yaml)
- [WU-1080 — Add wu:release command to recover orphaned WUs](wu/WU-1080.yaml)
- [WU-1081 — Remove prerelease npm script and add LUMENFLOW_FORCE to micro-worktree push](wu/WU-1081.yaml)
- [WU-1082 — Agent branch patterns registry with fetch + cache](wu/WU-1082.yaml)
- [WU-1083 — Scaffold agent onboarding docs and skills in lumenflow init](wu/WU-1083.yaml)
- [WU-1084 — wu:done should fail if main has uncommitted changes after merge](wu/WU-1084.yaml)
- [WU-1085 — CLI best practices audit: --help, --no-color, exports](wu/WU-1085.yaml)
- [WU-1086 — Fix gates-pre-commit module resolution to support .mjs extension](wu/WU-1086.yaml)
- [WU-1087 — CLI Best Practices Phase 2: Command Migrations, Docs Rebalance, npm Publish](wu/WU-1087.yaml)
- [WU-1088 — Fix circular dependency in dependency-graph.ts causing top-level await warning](wu/WU-1088.yaml)
- [WU-1089 — Agent branch patterns: merge mode, override, and airgapped support](wu/WU-1089.yaml)
- [WU-1090 — Context-aware state machine for WU lifecycle commands](wu/WU-1090.yaml)
- [WU-1091 — P1: Fix ensureOnMain() blocking all web agent commands](wu/WU-1091.yaml)
- [WU-1097 — P3: Fix shell escaping in wu-recover CLI](wu/WU-1097.yaml)
- [WU-1092 — P2: Fix worktreeCleanPredicate checking wrong git state](wu/WU-1092.yaml)
- [WU-1093 — INIT-002 Phase 1: Define ports and domain schemas for context/validation/recovery](wu/WU-1093.yaml)
- [WU-1094 — INIT-002 Phase 2: Implement adapters and dependency injection](wu/WU-1094.yaml)
- [WU-1096 — P3: Fix recovery commands and DETACHED location type in Core](wu/WU-1096.yaml)
- [WU-1095 — INIT-002 Phase 3: ADR for hex architecture + migration guide](wu/WU-1095.yaml)
- [WU-1100 — INIT-003 Phase 1: Sync CLI docs to lumenflow.dev](wu/WU-1100.yaml)
- [WU-1101 — INIT-003 Phase 2a: Migrate tools/lib/core/ to @lumenflow/core](wu/WU-1101.yaml)
- [WU-1102 — INIT-003 Phase 2b: Migrate WU helpers to @lumenflow/core](wu/WU-1102.yaml)
- [WU-1103 — INIT-003 Phase 2c: Migrate git & validator modules](wu/WU-1103.yaml)
- [WU-1106 — INIT-003 Phase 3b: Migrate backlog:prune command](wu/WU-1106.yaml)
- [WU-1104 — INIT-003 Phase 2d: Migrate utility modules](wu/WU-1104.yaml)
- [WU-1108 — INIT-003 Phase 4a: Migrate file operations (4 tools)](wu/WU-1108.yaml)
- [WU-1105 — INIT-003 Phase 3a: Migrate init:plan command](wu/WU-1105.yaml)
- [WU-1110 — INIT-003 Phase 5a: Migrate metrics commands](wu/WU-1110.yaml)
- [WU-1111 — INIT-003 Phase 5b: Migrate guards & validation (7 tools)](wu/WU-1111.yaml)
- [WU-1112 — INIT-003 Phase 6: Migrate remaining Tier 1 tools](wu/WU-1112.yaml)
- [WU-1109 — INIT-003 Phase 4b: Migrate git operations (5 tools)](wu/WU-1109.yaml)
- [WU-1107 — INIT-003 Phase 3c: Migrate state:bootstrap command](wu/WU-1107.yaml)
- [WU-1113 — INIT-003 Phase 7: Publish @lumenflow/cli update](wu/WU-1113.yaml)
- [WU-1114 — Enforce context exhaustion prevention via WU sizing and spawn-fresh policy](wu/WU-1114.yaml)
- [WU-1118 — Docs Audit: CLI Presets - Java/Ruby/PHP gate presets](wu/WU-1118.yaml)
- [WU-1115 — Docs Audit: What & Why - Fix broken link + positioning](wu/WU-1115.yaml)
- [WU-1122 — Docs Audit: Language Support - Java, Ruby, and PHP guides](wu/WU-1122.yaml)
- [WU-1121 — Docs Audit: Language Support - Go and Rust guides](wu/WU-1121.yaml)
- [WU-1117 — Docs Audit: Language Support - Python and .NET guides](wu/WU-1117.yaml)
- [WU-1126 — Export constants/enums for string literals in port interfaces](wu/WU-1126.yaml)
- [WU-1123 — INIT-004 Phase 1: Template sync script](wu/WU-1123.yaml)
- [WU-1125 — INIT-004 Phase 3: Document upgrade path](wu/WU-1125.yaml)
- [WU-1116 — Docs Audit: Internal to Public - Agent onboarding + constraints](wu/WU-1116.yaml)
- [WU-1119 — Docs Audit: Adoption Paths - existing projects + migration + solo dev](wu/WU-1119.yaml)
- [WU-1124 — INIT-004 Phase 2: Refactor docs-sync to read from templates](wu/WU-1124.yaml)
- [WU-1120 — Docs Audit: Advanced & Polish - skills tutorial + TypeDoc + cookbook](wu/WU-1120.yaml)
- [WU-1127 — lumenflow:upgrade must use micro-worktree (users blocked from upgrading)](wu/WU-1127.yaml)
- [WU-1128 — Add upgrade guide to lumenflow.dev](wu/WU-1128.yaml)
- [WU-1130 — Fix guard-\* commands to recognize worktree context](wu/WU-1130.yaml)
- [WU-1133 — Fix doc alignment: constraints-capsule reference and vendor overlays](wu/WU-1133.yaml)
- [WU-1132 — Harden worktree validation hook to fail-closed](wu/WU-1132.yaml)
- [WU-1136 — Docs: memory path fix + agent invocation guide + pre-clear checkpoint hook](wu/WU-1136.yaml)
- [WU-1137 — Add mem:export CLI for human-readable memory output](wu/WU-1137.yaml)
- [WU-1131 — Fix wu:spawn output truncation causing agent degradation](wu/WU-1131.yaml)
- [WU-1138 — Fix Prettier failures in docs reference pages](wu/WU-1138.yaml)
- [WU-1139 — Remove dead gate stubs and wire to TypeScript implementations](wu/WU-1139.yaml)
