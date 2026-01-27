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

- [WU-1134 — Add worktree block recovery guidance to wu:spawn output](wu/WU-1134.yaml) — Framework: CLI

## 🔧 In progress

- [WU-1073 — Add --risks option to wu:edit command](wu/WU-1073.yaml) — Framework: CLI
- [WU-1135 — Add vendor-agnostic pre-write checks to constraints and agent templates](wu/WU-1135.yaml) — Content: Documentation

## ⛔ Blocked

- [WU-1007 — List LumenFlow GitHub App on Marketplace (Free tier)](wu/WU-1007.yaml) — Core

## ✅ Done

- [WU-1001 — Complete LumenFlow dogfooding setup](wu/WU-1001.yaml) — Infrastructure
- [WU-1002 — Publish @lumenflow packages to npm](wu/WU-1002.yaml) — Infrastructure
- [WU-1003 — Add rate limiting to Gates Action](wu/WU-1003.yaml) — Infrastructure
- [WU-1005 — Add lumenflow init scaffolding command](wu/WU-1005.yaml) — CLI
- [WU-1006 — Refactor codebase to use well-known libraries (Library-First)](wu/WU-1006.yaml) — Core
- [WU-1008 — Create lumenflow.dev docs site](wu/WU-1008.yaml) — Core
- [WU-1009 — Write quickstart guide](wu/WU-1009.yaml) — Core
- [WU-1010 — Create example repos (Node/Python/Go)](wu/WU-1010.yaml) — Documentation
- [WU-1011 — Fix circular dependency between core and memory packages](wu/WU-1011.yaml) — Core
- [WU-1012 — Add --docs-only flag to wu:done for documentation WUs](wu/WU-1012.yaml) — CLI
- [WU-1013 — Deploy docs to Vercel (lumenflow.dev)](wu/WU-1013.yaml) — Documentation
- [WU-1014 — Add error logging to worktreeRemove fallback rmSync](wu/WU-1014.yaml) — CLI
- [WU-1015 — Add missing CLI command wrappers](wu/WU-1015.yaml) — CLI
- [WU-1016 — Implement configurable WIP limits per lane](wu/WU-1016.yaml) — Core
- [WU-1017 — Add vendor-agnostic git hooks via Husky](wu/WU-1017.yaml) — Infrastructure
- [WU-1018 — Migrate missing CLI commands from ExampleApp to @lumenflow/cli](wu/WU-1018.yaml) — CLI
- [WU-1019 — Add .lumenflow.lane-inference.yaml for sublane taxonomy](wu/WU-1019.yaml) — Infrastructure
- [WU-1020 — Fix TypeScript error in metrics-snapshot.ts for readonly array cast](wu/WU-1020.yaml) — CLI
- [WU-1022 — Enforce parent:sublane format for lanes](wu/WU-1022.yaml) — Framework: CLI
- [WU-1023 — Auto-setup worktree dependencies on wu:claim](wu/WU-1023.yaml) — Framework: CLI
- [WU-1024 — Pre-push hook should allow CLI tool pushes to main](wu/WU-1024.yaml) — Operations: Infrastructure
- [WU-1025 — Block wu:create and wu:claim if spec contains PLACEHOLDER markers](wu/WU-1025.yaml) — Framework: Core
- [WU-1026 — Allow agent branches to bypass worktree requirements](wu/WU-1026.yaml) — Framework: Core
- [WU-1027 — Block agents from deleting worktrees](wu/WU-1027.yaml) — Operations: Infrastructure
- [WU-1028 — Fix agent wu:done amnesia - docs and distribution](wu/WU-1028.yaml) — Content: Documentation
- [WU-1029 — Fix wu:claim fallback to symlink nested node_modules](wu/WU-1029.yaml) — Framework: CLI
- [WU-1030 — Fix wu:create/wu:edit pre-push block leaving main ahead](wu/WU-1030.yaml) — Operations: Infrastructure
- [WU-1031 — Make wu:done resilient to missing worktree](wu/WU-1031.yaml) — Framework: CLI
- [WU-1032 — Upgrade Core Dependencies and Fix Documentation](wu/WU-1032.yaml) — Operations: Infrastructure
- [WU-1033 — Canonicalize LumenFlow framework docs under operations](wu/WU-1033.yaml) — Content: Documentation
- [WU-1035 — Update core references to new documentation paths](wu/WU-1035.yaml) — Framework: Core
- [WU-1036 — Update CLI references to new documentation paths](wu/WU-1036.yaml) — Framework: CLI
- [WU-1038 — Ensure worktree gates can locate CLI dist](wu/WU-1038.yaml) — Framework: CLI
- [WU-1039 — Allow exposure edits on completed WUs](wu/WU-1039.yaml) — Framework: CLI
- [WU-1040 — Allow safe metadata edits on done WUs](wu/WU-1040.yaml) — Framework: CLI
- [WU-1041 — Auto-assign exposure on wu:done when missing](wu/WU-1041.yaml) — Framework: Core
- [WU-1042 — Reduce gates friction](wu/WU-1042.yaml) — Framework: CLI
- [WU-1043 — Enforce complete specs at wu:create](wu/WU-1043.yaml) — Framework: CLI
- [WU-1044 — Vendor-Agnostic wu:spawn Refactor](wu/WU-1044.yaml) — Framework: Core
- [WU-1045 — Define lumenflow:init project scaffolding](wu/WU-1045.yaml) — Framework: CLI
- [WU-1046 — Consolidate YAML handling on yaml package](wu/WU-1046.yaml) — Framework: Core
- [WU-1047 — Configurable methodology defaults](wu/WU-1047.yaml) — Framework: Core
- [WU-1048 — Fix Vitest coverage provider gaps](wu/WU-1048.yaml) — Operations: Infrastructure
- [WU-1049 — Refactor wu-done validators](wu/WU-1049.yaml) — Framework: Core
- [WU-1050 — Restore canonical claim state](wu/WU-1050.yaml) — Framework: CLI
- [WU-1051 — Make wu:spawn skills guidance config-driven](wu/WU-1051.yaml) — Framework: Core
- [WU-1052 — Migrate remaining tests from ExampleApp](wu/WU-1052.yaml) — Framework: Core
- [WU-1053 — Claude Code Full Optimization](wu/WU-1053.yaml) — Framework: Core
- [WU-1054 — Fix npm publish and document release process](wu/WU-1054.yaml) — Operations: CI/CD
- [WU-1055 — Fix Starlight docs](wu/WU-1055.yaml) — Content: Documentation
- [WU-1056 — Harden wu:cleanup](wu/WU-1056.yaml) — Framework: Core
- [WU-1057 — Update LumenFlow docs](wu/WU-1057.yaml) — Content: Documentation
- [WU-1058 — Documentation overhaul](wu/WU-1058.yaml) — Content: Documentation
- [WU-1059 — Auto-generate CLI and config documentation](wu/WU-1059.yaml) — Framework: CLI
- [WU-1061 — Integrate docs:generate into wu:done](wu/WU-1061.yaml) — Framework: CLI
- [WU-1062 — External plan storage](wu/WU-1062.yaml) — Framework: Core
- [WU-1063 — Fix wu:edit dropping spec_refs](wu/WU-1063.yaml) — Framework: Core
- [WU-1064 — Fix CLI silent failure](wu/WU-1064.yaml) — Framework: CLI
- [WU-1065 — Bug: mem:inbox fails with missing ms dependency](wu/WU-1065.yaml) — Framework: CLI
- [WU-1067 — Make gates language-agnostic](wu/WU-1067.yaml) — Operations: CI/CD
- [WU-1068 — LumenFlow Framework Cleanup](wu/WU-1068.yaml) — Framework: Core
- [WU-1069 — Validate spec-refs](wu/WU-1069.yaml) — Framework: CLI
- [WU-1070 — Add audit logging for LUMENFLOW_FORCE](wu/WU-1070.yaml) — Operations: Infrastructure
- [WU-1071 — Fix CLI entry guard](wu/WU-1071.yaml) — Framework: CLI
- [WU-1072 — Fix wu:done staging whitelist](wu/WU-1072.yaml) — Framework: CLI
- [WU-1074 — Add release command](wu/WU-1074.yaml) — Framework: CLI
- [WU-1075 — Rename .beacon to .lumenflow](wu/WU-1075.yaml) — Framework: Core
- [WU-1076 — Block direct main branch commits](wu/WU-1076.yaml) — Framework: CLI
- [WU-1077 — Fix release script](wu/WU-1077.yaml) — Framework: CLI
- [WU-1078 — Fix wu:repair](wu/WU-1078.yaml) — Framework: CLI
- [WU-1079 — Migrate stamps from .beacon to .lumenflow](wu/WU-1079.yaml) — Framework: Core
- [WU-1080 — Add wu:release command](wu/WU-1080.yaml) — Framework: Core
- [WU-1081 — Remove prerelease npm script](wu/WU-1081.yaml) — Framework: CLI
- [WU-1082 — Agent branch patterns registry](wu/WU-1082.yaml) — Framework: Core
- [WU-1083 — Scaffold agent onboarding docs](wu/WU-1083.yaml) — Framework: CLI
- [WU-1084 — wu:done should fail if main has uncommitted changes](wu/WU-1084.yaml) — Framework: CLI
- [WU-1085 — CLI best practices audit](wu/WU-1085.yaml) — Framework: CLI
- [WU-1086 — Fix gates-pre-commit module resolution](wu/WU-1086.yaml) — Framework: Core
- [WU-1087 — CLI Best Practices Phase 2](wu/WU-1087.yaml) — Framework: CLI
- [WU-1088 — Fix circular dependency](wu/WU-1088.yaml) — Framework: Core
- [WU-1089 — Agent branch patterns](wu/WU-1089.yaml) — Framework: Core
- [WU-1090 — Context-aware state machine](wu/WU-1090.yaml) — Framework: Core
- [WU-1091 — P1: Fix ensureOnMain()](wu/WU-1091.yaml) — Framework: Core
- [WU-1092 — P2: Fix worktreeCleanPredicate](wu/WU-1092.yaml) — Framework: Core
- [WU-1093 — INIT-002 Phase 1](wu/WU-1093.yaml) — Framework: Core
- [WU-1094 — INIT-002 Phase 2](wu/WU-1094.yaml) — Framework: Core
- [WU-1095 — INIT-002 Phase 3](wu/WU-1095.yaml) — Content: Documentation
- [WU-1096 — P3: Fix recovery commands](wu/WU-1096.yaml) — Framework: Core
- [WU-1097 — P3: Fix shell escaping](wu/WU-1097.yaml) — Framework: CLI
- [WU-1100 — INIT-003 Phase 1](wu/WU-1100.yaml) — Content: Documentation
- [WU-1101 — INIT-003 Phase 2a](wu/WU-1101.yaml) — Framework: Core
- [WU-1102 — INIT-003 Phase 2b](wu/WU-1102.yaml) — Framework: Core
- [WU-1103 — INIT-003 Phase 2c](wu/WU-1103.yaml) — Framework: Core
- [WU-1104 — INIT-003 Phase 2d](wu/WU-1104.yaml) — Framework: Core
- [WU-1105 — INIT-003 Phase 3a](wu/WU-1105.yaml) — Framework: CLI
- [WU-1106 — INIT-003 Phase 3b](wu/WU-1106.yaml) — Framework: CLI
- [WU-1107 — INIT-003 Phase 3c](wu/WU-1107.yaml) — Framework: Core
- [WU-1108 — INIT-003 Phase 4a](wu/WU-1108.yaml) — Framework: CLI
- [WU-1109 — INIT-003 Phase 4b](wu/WU-1109.yaml) — Framework: CLI
- [WU-1110 — INIT-003 Phase 5a](wu/WU-1110.yaml) — Framework: Metrics
- [WU-1111 — INIT-003 Phase 5b](wu/WU-1111.yaml) — Framework: CLI
- [WU-1112 — INIT-003 Phase 6](wu/WU-1112.yaml) — Framework: CLI
- [WU-1113 — INIT-003 Phase 7](wu/WU-1113.yaml) — Framework: CLI
- [WU-1114 — Enforce context exhaustion prevention](wu/WU-1114.yaml) — Content: Documentation
- [WU-1115 — Docs Audit: What & Why](wu/WU-1115.yaml) — Content: Documentation
- [WU-1116 — Docs Audit: Internal to Public](wu/WU-1116.yaml) — Content: Documentation
- [WU-1117 — Docs Audit: Language Support - Python/.NET](wu/WU-1117.yaml) — Content: Documentation
- [WU-1118 — Docs Audit: CLI Presets](wu/WU-1118.yaml) — Framework: CLI
- [WU-1119 — Docs Audit: Adoption Paths](wu/WU-1119.yaml) — Content: Documentation
- [WU-1120 — Docs Audit: Advanced & Polish](wu/WU-1120.yaml) — Content: Documentation
- [WU-1121 — Docs Audit: Language Support - Go/Rust](wu/WU-1121.yaml) — Content: Documentation
- [WU-1122 — Docs Audit: Language Support - Java/Ruby/PHP](wu/WU-1122.yaml) — Content: Documentation
- [WU-1123 — INIT-004 Phase 1](wu/WU-1123.yaml) — Framework: CLI
- [WU-1124 — INIT-004 Phase 2](wu/WU-1124.yaml) — Framework: CLI
- [WU-1125 — INIT-004 Phase 3](wu/WU-1125.yaml) — Framework: CLI
- [WU-1126 — Export constants/enums](wu/WU-1126.yaml) — Framework: Core
- [WU-1127 — lumenflow:upgrade micro-worktree](wu/WU-1127.yaml) — Framework: CLI
- [WU-1128 — Add upgrade guide](wu/WU-1128.yaml) — Content: Documentation
- [WU-1130 — Fix guard-\* commands](wu/WU-1130.yaml) — Framework: CLI
- [WU-1131 — Fix wu:spawn output truncation](wu/WU-1131.yaml) — Framework: CLI
- [WU-1132 — Harden worktree validation hook](wu/WU-1132.yaml) — Operations: CI/CD
- [WU-1133 — Fix doc alignment](wu/WU-1133.yaml) — Content: Documentation
- [WU-1136 — Docs: memory path fix](wu/WU-1136.yaml) — Content: Documentation
- [WU-1137 — Add mem:export CLI](wu/WU-1137.yaml) — Operations: Infrastructure
- [WU-1138 — Fix Prettier failures](wu/WU-1138.yaml) — Content: Documentation
- [WU-1139 — Remove dead gate stubs](wu/WU-1139.yaml) — Framework: Core
- [WU-1140 — Fix backlog sync](wu/WU-1140.yaml) — Operations: Infrastructure
- [WU-1141 — Fix wu:cleanup PR merge verification](wu/WU-1141.yaml) — Framework: CLI
- [WU-1142 — Make wu:spawn prompts type-aware](wu/WU-1142.yaml) — Framework: CLI
- [WU-1144 — Bug: wu:edit --notes and --acceptance overwrite](wu/WU-1144.yaml) — Framework: Core
- [WU-1145 — Bug: wu:done metadata update overwrites](wu/WU-1145.yaml) — Framework: Core
- [WU-1004 — Make gates script repo-agnostic](wu/WU-1004.yaml) — CLI (cancelled)
- [WU-1066 — Add .NET/C# preset to lumenflow-gates](wu/WU-1066.yaml) — Operations: CI/CD (cancelled)
- [WU-1098 — BUG: Fix Starlight docs formatting](wu/WU-1098.yaml) — Content: Documentation (cancelled)
- [WU-1129 — Fix pre-existing prettier format failures](wu/WU-1129.yaml) — Content: Documentation (cancelled)
- [WU-1143 — Fix backlog-sync gate](wu/WU-1143.yaml) — Operations: Infrastructure (cancelled)
- [WU-1146 — Regenerate backlog.md](wu/WU-1146.yaml) — Operations: Infrastructure (cancelled)
