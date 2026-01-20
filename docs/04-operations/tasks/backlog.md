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

> Agent: Read **ai/onboarding/starting-prompt.md** first, then follow **docs/04-operations/\_frameworks/lumenflow/lumenflow-complete.md** for execution.

# Backlog (single source of truth)

## 🚀 Ready (pull from here)

- [WU-1035 — Update core references to new documentation paths](wu/WU-1035.yaml) — Framework: Core
- [WU-1034 — Move agent onboarding docs into operations framework](wu/WU-1034.yaml) — Content: Documentation
- [WU-1033 — Canonicalize LumenFlow framework docs under operations](wu/WU-1033.yaml) — Content: Documentation
  (No items ready)

## 🔧 In progress

- [WU-1008 — Create lumenflow.dev docs site](wu/WU-1008.yaml) — Core
- [WU-1013 — Deploy docs to Vercel (lumenflow.dev)](wu/WU-1013.yaml) — Documentation
- [WU-1016 — Implement configurable WIP limits per lane](wu/WU-1016.yaml) — Core

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
