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

> Agent: Read **docs/04-operations/_frameworks/lumenflow/agent/onboarding/starting-prompt.md** first, then follow **docs/04-operations/\_frameworks/lumenflow/lumenflow-complete.md** for execution.

# Backlog (single source of truth)

## 🚀 Ready (pull from here)

(No items ready)

## 🔧 In progress

- [WU-1008 — Create lumenflow.dev docs site](wu/WU-1008.yaml) — Core
- [WU-1013 — Deploy docs to Vercel (lumenflow.dev)](wu/WU-1013.yaml) — Documentation
- [WU-1016 — Implement configurable WIP limits per lane](wu/WU-1016.yaml) — Core
- [WU-1052 — Migrate remaining tests from ExampleApp tools/ to hellmai/os packages](wu/WU-1052.yaml) — Framework: Core
- [WU-1062 — External plan storage and no-main-write mode for wu:create](wu/WU-1062.yaml) — Framework: Core
- [WU-1064 — Fix CLI silent failure - async main() without catch handler](wu/WU-1064.yaml) — Framework: CLI
- [WU-1065 — Bug: mem:inbox fails with missing ms dependency - breaks agent monitoring](wu/WU-1065.yaml) — Framework: CLI

## ⛔ Blocked

(No items currently blocked)

## ✅ Done

- [WU-1001 — Complete LumenFlow dogfooding setup](wu/WU-1001.yaml)
- [WU-1002 — Publish @lumenflow packages to npm](wu/WU-1002.yaml)
- [WU-1003 — Add rate limiting to Gates Action](wu/WU-1003.yaml)
- [WU-1005 — Add lumenflow init scaffolding command](wu/WU-1005.yaml)
- [WU-1006 — Refactor codebase to use well-known libraries (Library-First)](wu/WU-1006.yaml)
- [WU-1011 — Fix circular dependency between core and memory packages](wu/WU-1011.yaml)
- [WU-1014 — Add error logging to worktreeRemove fallback rmSync](wu/WU-1014.yaml)
- [WU-1015 — Add missing CLI command wrappers](wu/WU-1015.yaml)
- [WU-1012 — Add --docs-only flag to wu:done for documentation WUs](wu/WU-1012.yaml)
- [WU-1010 — Create example repos (Node/Python/Go)](wu/WU-1010.yaml)
- [WU-1019 — Add .lumenflow.lane-inference.yaml for sublane taxonomy](wu/WU-1019.yaml)
- [WU-1017 — Add vendor-agnostic git hooks via Husky](wu/WU-1017.yaml)
- [WU-1018 — Migrate missing CLI commands from ExampleApp to @lumenflow/cli](wu/WU-1018.yaml)
- [WU-1020 — Fix TypeScript error in metrics-snapshot.ts for readonly array cast](wu/WU-1020.yaml)
- [WU-1022 — Enforce parent:sublane format for lanes (Framework: CLI not CLI)](wu/WU-1022.yaml)
- [WU-1024 — Pre-push hook should allow CLI tool pushes to main](wu/WU-1024.yaml)
- [WU-1025 — Block wu:create and wu:claim if spec contains PLACEHOLDER markers](wu/WU-1025.yaml)
- [WU-1023 — Auto-setup worktree dependencies on wu:claim](wu/WU-1023.yaml)
- [WU-1026 — Allow agent branches to bypass worktree requirements](wu/WU-1026.yaml)
- [WU-1027 — Block agents from deleting worktrees](wu/WU-1027.yaml)
- [WU-1028 — Fix agent wu:done amnesia - docs and distribution](wu/WU-1028.yaml)
- [WU-1030 — Fix wu:create/wu:edit pre-push block leaving main ahead](wu/WU-1030.yaml)
- [WU-1029 — Fix wu:claim fallback to symlink nested node_modules](wu/WU-1029.yaml)
- [WU-1031 — Make wu:done resilient to missing worktree](wu/WU-1031.yaml)
- [WU-1032 — Upgrade Core Dependencies and Fix Documentation](wu/WU-1032.yaml)
- [WU-1038 — Ensure worktree gates can locate CLI dist](wu/WU-1038.yaml)
- [WU-1043 — Enforce complete specs at wu:create (schema + templates + docs)](wu/WU-1043.yaml)
- [WU-1044 — Vendor-Agnostic wu:spawn Refactor](wu/WU-1044.yaml)
- [WU-1046 — Consolidate YAML handling on yaml package (retire js-yaml)](wu/WU-1046.yaml)
- [WU-1047 — Configurable methodology defaults + client blocks for wu:claim/wu:spawn](wu/WU-1047.yaml)
- [WU-1041 — Auto-assign exposure on wu:done when missing](wu/WU-1041.yaml)
- [WU-1039 — Allow exposure edits on completed WUs](wu/WU-1039.yaml)
- [WU-1040 — Allow safe metadata edits on done WUs (exposure)](wu/WU-1040.yaml)
- [WU-1042 — Reduce gates friction (format guidance + worktree cleanup helper)](wu/WU-1042.yaml)
- [WU-1049 — Refactor wu-done validators + standardize errors](wu/WU-1049.yaml)
- [WU-1050 — Restore canonical claim state + global visibility for wu:claim (push-only)](wu/WU-1050.yaml)
- [WU-1048 — Fix Vitest coverage provider gaps](wu/WU-1048.yaml)
- [WU-1051 — Make wu:spawn skills guidance config-driven and vendor-agnostic](wu/WU-1051.yaml)
- [WU-1053 — Claude Code Full Optimization - Skills, Agents, Docs, Release](wu/WU-1053.yaml)
- [WU-1054 — Fix npm publish and document release process](wu/WU-1054.yaml)
- [WU-1055 — Fix Starlight docs - remove custom CSS, use defaults](wu/WU-1055.yaml)
- [WU-1057 — Update LumenFlow docs - Nova theme, logos, and content audit](wu/WU-1057.yaml)
- [WU-1056 — Harden wu:cleanup + add worktree-loss safeguards](wu/WU-1056.yaml)
- [WU-1058 — Documentation overhaul - fix critical gaps and inaccuracies](wu/WU-1058.yaml)
- [WU-1059 — Auto-generate CLI and config documentation from source](wu/WU-1059.yaml)
- [WU-1061 — Integrate docs:generate into wu:done for @lumenflow/* changes](wu/WU-1061.yaml)