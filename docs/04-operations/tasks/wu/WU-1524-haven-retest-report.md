# WU-1524: Haven Re-Test Report

**Date:** 2026-02-07
**Tester:** Agent (claude-opus-4-6)
**Initiative:** INIT-018 (Launch-1: Haven Pre-Launch Scaffolding Fixes)
**Test type:** End-to-end verification of all INIT-018 fixes in a fresh greenfield project

---

## Test Environment

- Fresh temporary directory: `/tmp/haven-retest-wu1524/`
- Git repo initialized with a bare local origin at `/tmp/haven-retest-origin/`
- `lumenflow init --preset node --client claude` run from the repo
- `@lumenflow/cli` installed from local worktree (v2.13.0)
- Package manager: npm (not pnpm)
- No test runner installed (vitest/jest/mocha)

---

## Prerequisites Verification

All 7 INIT-018 prerequisite WUs verified as `done`:

| WU | Title | Status |
|---|---|---|
| WU-1517 | Scaffold prettier + format infrastructure | done |
| WU-1518 | Scaffold spec:linter and remaining gate scripts | done |
| WU-1519 | Stop gitignoring .lumenflow/state/ in scaffold template | done |
| WU-1520 | Gates graceful degradation for missing optional scripts | done |
| WU-1521 | wu:claim transaction safety - rollback YAML on partial failure | done |
| WU-1522 | Auto-commit or untrack flow.log in wu:claim lifecycle | done |
| WU-1523 | Render backlog.md and status.md from state events | done |

---

## Overall Result: FAIL

**The end-to-end workflow does NOT complete without manual intervention.**

Multiple scaffolding gaps and runtime issues required manual fixes at various
stages. WU-1 (documentation WU) could not be completed via `wu:done` without
at least 6 manual workarounds.

WU-2 (second lane) was not tested because WU-1 could not complete cleanly.

---

## Issues Found (Ordered by Severity)

### CRITICAL: 3 Issues

#### C1. Config path mismatch between scaffolded files and config values

- **Symptom:** `wu:create` fails with "Backlog not found" at
  `docs/04-operations/tasks/backlog.md`
- **Root cause:** `.lumenflow.config.yaml` defaults to
  `docs/04-operations/tasks/` paths, but `lumenflow init` scaffolds files at
  `docs/tasks/`
- **Manual fix required:** Edit config to change 5 path values
- **Impact:** Blocks all WU lifecycle commands immediately after scaffolding
- **Prerequisite WU:** None addressed this -- it is a new finding

#### C2. `cos:gates` script not scaffolded but required by `wu:done`

- **Symptom:** `wu:done` fails with "COS governance gates failed" because
  `pnpm cos:gates` command not found
- **Root cause:** `wu:done` unconditionally runs `pnpm run cos:gates` but
  `lumenflow init` does not scaffold this script in `package.json`
- **Manual fix required:** Add `"cos:gates": "echo stub && exit 0"` to
  `package.json`
- **Impact:** Blocks all WU completion in fresh projects
- **Error message also suggests non-existent `--skip-cos-gates` flag**
- **Prerequisite WU:** WU-1520 (graceful degradation) did not cover cos:gates

#### C3. `wu:done` pre-flight runs full gates for docs-only WUs

- **Symptom:** After docs-only gates pass, `wu:done` runs a second "pre-flight
  validation" gate check that uses full mode (including tests)
- **Root cause:** The pre-flight hook in `wu:done` does not inherit the
  docs-only flag from the WU type detection
- **Impact:** Documentation WUs blocked by test failures even when the
  configured docs-only gates pass
- **Prerequisite WU:** None addressed this specific pre-flight behavior

### HIGH: 3 Issues

#### H1. Scaffolded template files not pre-formatted with prettier

- **Symptom:** `format:check` gate fails immediately in a fresh project with
  16 unformatted files (all from `lumenflow init`)
- **Root cause:** Template files in the CLI package are not run through
  prettier before being written
- **Manual fix required:** Run `pnpm format` and commit
- **Impact:** First gates run always fails in a fresh project
- **Prerequisite WU:** WU-1517 scaffolded prettier infrastructure but did not
  ensure templates are pre-formatted

#### H2. `.gitignore` does not include runtime files that cause dirty-tree blocks

- **Symptom:** `wu:claim` and `wu:done` fail with "working tree is not clean"
  due to untracked `.lumenflow/flow.log`, `.lumenflow/memory/`,
  `.lumenflow/sessions/`
- **Root cause:** `.gitignore` template only ignores `.lumenflow/telemetry/`
  but not other runtime files
- **Manual fix required:** Add flow.log, memory/, sessions/ to .gitignore
- **Impact:** Every CLI command that writes to flow.log causes a dirty tree,
  blocking subsequent wu:claim/wu:done
- **Prerequisite WU:** WU-1522 addressed flow.log lifecycle but the fix did
  not extend to the scaffolded `.gitignore` template

#### H3. `.prettierignore` does not include `.logs/` directory

- **Symptom:** `format:check` gate fails because prettier cannot parse `.log`
  files in the `.logs/` directory created by gates
- **Root cause:** Gates create `.logs/` for log output, but `.prettierignore`
  does not exclude this directory
- **Manual fix required:** Add `.logs/` and `*.log` to `.prettierignore`
- **Impact:** Gates fail due to their own log output
- **Prerequisite WU:** WU-1517 created prettierignore but missed the .logs/
  pattern

### MEDIUM: 3 Issues

#### M1. `wu:claim --no-push` (local-only) fails referencing `origin/main`

- **Symptom:** `wu:claim` with `requireRemote: false` and `--no-push` fails
  with "fatal: ambiguous argument 'origin/main': unknown revision"
- **Root cause:** Code references `origin/main` even in local-only mode
- **Workaround:** Create a local bare repo as origin
- **Impact:** Local-only development mode is broken for wu:claim

#### M2. Gate test commands assume pnpm + vitest

- **Symptom:** Test gate fails with "Command 'vitest' not found" and
  "Command 'turbo' not found"
- **Root cause:** `gates.commands.test_incremental` defaults to
  `pnpm vitest run --changed origin/main` and `test_full` to
  `pnpm turbo run test` regardless of package manager or test runner
- **Manual fix required:** Edit config to use project-appropriate test
  commands
- **Impact:** Test gates always fail in non-pnpm/vitest projects
- **Note:** WU-1520 graceful degradation should have caught this

#### M3. Prettier not available in worktree micro-environment

- **Symptom:** `wu:create` and `wu:recover` warn "Skipping formatting:
  prettier not available" when running in micro-worktrees
- **Root cause:** Micro-worktrees at `/tmp/wu-create-*/` do not have
  `node_modules` or access to the project's prettier
- **Impact:** WU YAML files committed unformatted, contributing to H1

### LOW: 2 Issues

#### L1. `wu:recover --action reset` does not clean up lane branch

- **Symptom:** After `wu:recover --action reset`, the lane branch persists,
  blocking the next `wu:claim` with "Branch already exists"
- **Manual fix required:** `git branch -D lane/content-documentation/wu-1`
- **Impact:** Cannot re-claim after recovery without manual cleanup

#### L2. Gates includes `node_modules` in incremental file list

- **Symptom:** Gate log shows `node_modules` in the list of files passed to
  prettier
- **Root cause:** Incremental mode lists changed files but does not filter
  the node_modules symlink
- **Impact:** Minor -- prettier ignores node_modules, but the diagnostic
  output is confusing

---

## Acceptance Criteria Assessment

| Criterion | Result | Notes |
|---|---|---|
| Fresh lumenflow init project created | PASS | Init runs and scaffolds files |
| First WU claimed, gates pass with no skip, wu:done succeeds on first attempt | FAIL | Required 6 manual fixes before wu:done could even reach COS gates stage |
| Second WU in different lane - same result | NOT TESTED | Blocked by WU-1 failures |
| No manual fixes applied at any point | FAIL | At least 6 manual fixes required |
| flow.log does not block wu:done | FAIL | flow.log causes dirty-tree blocks (H2) |
| backlog.md and status.md reflect completed work | NOT VERIFIED | wu:done never completed |
| Any remaining issues documented as new WUs | PASS | See below |

---

## Recommended Follow-Up WUs

### Priority 1 (Must fix before Haven launch)

1. **Fix config path mismatch in lumenflow init** (C1)
   - Lane: Framework: CLI
   - Ensure `wuDir`, `backlogPath`, `statusPath`, `onboardingDir` in generated
     config match actual scaffolded paths

2. **Scaffold cos:gates stub in lumenflow init** (C2)
   - Lane: Framework: CLI
   - Add `cos:gates` stub to `package.json` scripts during init, or make
     wu:done gracefully skip cos:gates when script is missing

3. **Fix wu:done pre-flight to respect docs-only mode** (C3)
   - Lane: Framework: CLI WU Commands
   - Pre-flight validation should use docs-only gates when the WU type is
     documentation

4. **Pre-format scaffolded templates with prettier** (H1)
   - Lane: Framework: CLI
   - Ensure all template files pass prettier formatting before being written

5. **Add runtime files to .gitignore template** (H2)
   - Lane: Framework: CLI
   - Add `.lumenflow/flow.log`, `.lumenflow/memory/`, `.lumenflow/sessions/`
     to the scaffolded `.gitignore`

6. **Add .logs/ to .prettierignore template** (H3)
   - Lane: Framework: CLI
   - Add `.logs/` and `*.log` to the scaffolded `.prettierignore`

### Priority 2 (Should fix)

7. **Fix wu:claim local-only mode** (M1)
   - Lane: Framework: CLI WU Commands
   - Ensure `requireRemote: false` properly skips all origin/main references

8. **Use project-appropriate test commands in gate config** (M2)
   - Lane: Framework: CLI
   - Detect test runner during init and configure gates.commands accordingly,
     or use the project's `npm test` by default

9. **Fix wu:recover to clean up lane branches** (L1)
   - Lane: Framework: CLI WU Commands
   - `--action reset` should delete the lane branch

---

## Raw Test Log Summary

1. `lumenflow init --preset node --client claude` -- SUCCESS
2. Commit scaffolding -- SUCCESS
3. `wu:create` -- FAIL (C1: config path mismatch) -- manual fix applied
4. `wu:create` (retry) -- SUCCESS
5. `wu:claim` -- FAIL (M1: local-only mode broken) -- workaround: add local origin
6. `wu:claim` (retry) -- FAIL (H2: dirty tree from flow.log) -- manual fix applied
7. `wu:claim` (retry) -- FAIL (partial claim left lane branch) -- manual fix applied
8. `wu:claim` (retry) -- SUCCESS
9. Create README.md in worktree -- SUCCESS
10. `gates` -- FAIL (H1: unformatted templates, H3: .log files) -- manual fixes applied
11. `gates` (retry) -- FAIL (M2: vitest not found) -- manual fix applied
12. `wu:prep` -- SUCCESS (after all fixes)
13. `wu:done` -- FAIL (H2: dirty tree from memory files) -- manual fix applied
14. `wu:done` (retry) -- FAIL (C2: cos:gates not found) -- manual fix applied
15. `wu:done` (retry) -- FAIL (C3: pre-flight runs full gates) -- NOT RESOLVED

---

## Conclusion

The INIT-018 prerequisite WUs addressed important foundational issues (prettier
scaffolding, spec:linter stubs, state directory tracking, gates degradation,
transaction safety, flow.log lifecycle, backlog/status rendering). However, the
end-to-end experience in a fresh greenfield project still has 11 issues
requiring manual intervention.

The most critical gap is that the scaffolded config paths do not match the
actual scaffolded directory structure (C1), which breaks the very first
lifecycle command a user would run. Additionally, the missing `cos:gates`
script (C2) and the pre-flight gates behavior for docs-only WUs (C3) make it
impossible to complete even a single WU without manual workarounds.

A second round of fixes is needed, primarily in the `Framework: CLI` lane,
focused on the `lumenflow init` scaffolding templates and the `wu:done`
pre-flight behavior.
