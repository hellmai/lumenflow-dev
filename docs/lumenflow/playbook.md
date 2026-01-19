# LumenFlow Playbook

The playbook turns the **LumenFlow Manifesto** into daily practice. It is technology-agnostic and designed for teams where humans and AI agents collaborate.

---

## 1. Set Up the Flow System

1. **Publish lanes** – Start with the default set and adapt as needed.
   - `Experience`
   - `Core Systems`
   - `Intelligence`
   - `Operations`
   - `Discovery`
2. **Define states** – Boards must support: `ready`, `in_progress`, `blocked`, `waiting`, `done`.
3. **Expose ownership** – Each WU shows owner(s), lane, and next checkpoint.
4. **Link to evidence** – Attach specs, prompts, research notes, and telemetry dashboards directly on the WU.

> Tip: Document lane customisations in `./operating-manual.md` so everyone can trace changes.

---

## 2. Running a Work Unit

| Step | Action                                                                                              | Artefacts           |
| ---- | --------------------------------------------------------------------------------------------------- | ------------------- |
| 1    | Pull the next `ready` WU in your lane. Confirm no other WU is `in_progress` there.                  | WU card updates     |
| 2    | **Ports first:** define or extend interfaces in `@{PROJECT_NAME}/ports`.                            | Interface PR / diff |
| 3    | **Tests first:** add failing tests in `@{PROJECT_NAME}/application` (or equivalent domain package). | Test file           |
| 4    | Implement the use case until tests pass. Stay inside the lane.                                      | Passing test run    |
| 5    | Create/update adapters in `@{PROJECT_NAME}/infrastructure` (or target stack) to satisfy contracts.  | Adapter diff        |
| 6    | Run full gates (`pnpm gates` or project equivalent).                                                | Gate log            |
| 7    | Move to `waiting`, capture release notes, request reviews if needed.                                | Change summary      |
| 8    | Once accepted, move to `done`, update manifests, close telemetry tasks.                             | Updated docs        |

If a dependency blocks progress for more than a working session, move the WU to `blocked`, record the blocker, and free the lane.

### 2.5 LLM Integration WUs

LLM integration work requires special attention to avoid incomplete implementations. Use the template at `{PROJECT_ROOT}/tasks/templates/llm-integration-wu.yaml` when creating WUs that involve replacing hardcoded logic with actual LLM calls.

#### When to Use the LLM Integration Template

Use this template for any WU that involves:

- **Replacing regex/keyword patterns** with semantic LLM classification
- **Adding new LLM-powered features** (entity recognition, sentiment analysis, etc.)
- **Migrating mock/stub services** to actual OpenAI SDK integration
- **Prompt-driven functionality** that requires structured outputs

**Do NOT use for:**

- Pure infrastructure work (creating interfaces, service layers)
- Prompt management systems (template loading, version control)
- Documentation or research WUs

#### Key Requirements for LLM Integration WUs

All LLM integration WUs MUST include these acceptance criteria (copy from template):

1. **Actual LLM Implementation:**
   - Makes real OpenAI SDK calls (not mocked, not simulated)
   - Prompt template created in `{PROJECT_ROOT}/web/prompts/`
   - Uses OpenAI structured outputs with defined JSON schema
   - Returns confidence scores from actual LLM responses

2. **Code Quality:**
   - No TODO/FIXME/HACK comments in production code
   - No Mock/Stub/Fake classes in production paths
   - Remove hardcoded regex patterns from production (keep in fallback only)

3. **Testing:**
   - At least one integration test calling ACTUAL OpenAI (not mocked)
   - Use VCR (record/replay) for CI to avoid flaky tests
   - Golden dataset test with realistic examples
   - Accuracy metrics documented (vs baseline)

4. **Resilience:**
   - Fallback mechanism for LLM failures (tested)
   - Performance metrics documented (latency, cost per call)
   - Graceful degradation path

#### Good vs Bad Acceptance Criteria

**✅ GOOD (Specific, Verifiable, Evidence-Based):**

- "Makes OpenAI SDK calls with prompt template `classification/mode-detection.yaml`"
- "Integration test verifies actual OpenAI API response parsing (not mocked)"
- "Golden dataset test achieves ≥85% accuracy vs baseline regex detector"
- "Fallback to FallbackModeDetector on LLM error (tested with simulated timeout)"

**❌ BAD (Vague, Interface-Only, Unmeasurable):**

- "Uses LLM-powered detection" (satisfied by interface alone)
- "Provides confidence scores" (could be hardcoded heuristics)
- "Better accuracy than regex" (not measurable, no baseline defined)
- "Implemented correctly" (meaningless, always subjective)

#### STOP-AND-ASK Triggers

Per LumenFlow §7.2, LLM integration WUs that affect the following require explicit human approval before marking done:

- **Safety**: Self-harm, suicide, emergency detection
- **Privacy**: PHI, PII, GDPR compliance
- **Auth/Permissions**: Access control, sensitive operations
- **Spend/Budget**: High-cost LLM calls, budget impact

When any apply, add to acceptance criteria:

```yaml
acceptance:
  - 'STOP-AND-ASK: Human review completed before marking done'
```

Do not mark the WU done until explicit approval is documented in the `notes` field.

#### Template Usage Checklist

When using the LLM integration template:

- [ ] Copy template to `{PROJECT_ROOT}/tasks/wu/WU-[ID].yaml`
- [ ] Replace all `[bracketed placeholders]` with actual values
- [ ] Fill in all `YYYY-MM-DD` dates
- [ ] Customize acceptance criteria for your specific task
- [ ] Add specific edge cases relevant to your classification domain
- [ ] Document dependencies if WU depends on others
- [ ] Add STOP-AND-ASK criteria if safety/privacy/auth/spend applies
- [ ] Review "Good vs Bad" examples before finalizing criteria

**Why This Matters:**

The LLM-First Migration audit (see `{PROJECT_ROOT}/product/archive/llm-migration-audit-2025-10-15.md`) revealed that vague acceptance criteria allowed 4 WUs to be marked "done" when they only created interfaces with hardcoded regex, not actual LLM integration. This template prevents that failure mode by requiring specific, verifiable evidence of real LLM implementation.

---

## 3. LumenFlow States: Operational Detail

| State         | Meaning                                                            | Allowed transitions        | Required update                           |
| ------------- | ------------------------------------------------------------------ | -------------------------- | ----------------------------------------- |
| `ready`       | Approved scope, waiting for a free lane.                           | → `in_progress`            | Confirm prerequisites met.                |
| `in_progress` | Active delivery within a lane.                                     | → `blocked`, `waiting`     | Daily progress note or commit reference.  |
| `blocked`     | Waiting on external input or prerequisite. Lane becomes available. | → `in_progress`, `waiting` | Describe blocker + owner + ETA.           |
| `waiting`     | Implementation done; verifying gates, reviews, release steps.      | → `done`, `blocked`        | Link to gate results / MR / release plan. |
| `done`        | Definition of Done satisfied and documented.                       | –                          | Add `.done` stamp, update change logs.    |

Discovery WUs typically flow `ready → in_progress → waiting → done`, with `blocked` used only when external research access is delayed.

---

## 4. Collaboration Patterns

### 4.1 Pairing Handshake (Optional but Recommended)

When two people or agents share a WU:

1. Add a comment titled `Pairing Handshake`.
2. List participants, the split of work, and the next sync point.
3. Update the handshake whenever ownership changes.

### 4.2 Shadow WUs

Use `Discovery` lane WUs with the `shadow` tag for research spikes, model evaluations, or workshop prep. Keep them ≤2 days, summarise findings, and convert outcomes into implementation WUs.

### 4.3 Cross-Lane Dependencies

If one lane depends on another:

1. Link the blocking WU in the card description.
2. Add a `dependency:` bullet that states the handshake/action required.
3. The dependent WU stays `ready` until the upstream lane reports `waiting` or `done`.

### 4.4 Handling Blocking Issues During WU Work

If you encounter blocking issues during WU implementation (dependency vulnerabilities, missing prerequisites, broken tests), **expand the current WU scope to include the fix** rather than creating separate WUs or using bypass flags.

**Pattern: Fix-in-WU**

1. Identify blocker (e.g., HIGH/CRITICAL vulnerability in Gate 6)
2. Add fix to current WU's `code_paths` and `acceptance` criteria
3. Document scope expansion in WU `notes`
4. Fix both original task + blocker together in same commit
5. No bypass flags needed - proper fix merged atomically

**Example: Dependency Vulnerability During Feature Work**

```bash
# Working on WU-650 (new dashboard feature)
git commit -m "feat(wu-650): add metrics dashboard"
# Gate 6 fails: Playwright CVE-2025-59288 (HIGH)

# ❌ WRONG: Skip the audit check
SKIP_PNPM_AUDIT=1 git commit ...

# ✅ CORRECT: Expand WU-650 scope
# 1. Add to WU-650.yaml code_paths: apps/web/package.json
# 2. Upgrade Playwright: pnpm add -D @playwright/test@latest
# 3. Update WU-650.yaml notes: "Scope expanded to fix Playwright CVE-2025-59288"
# 4. Commit everything together
git commit -m "feat(wu-650): add dashboard + fix playwright cve"
```

**When to use --skip-gates instead:**

- Pre-existing failures unrelated to your WU (requires `--reason` + `--fix-wu`)
- Zero-day vulnerability with no patch available (document in notes)
- Never use `--skip-gates` to avoid fixing issues you introduced

### 4.5 Lane Worktrees (Parallel Execution)

Use Git worktrees when multiple humans or agents need active WUs at the same time. **Default:** spin up a dedicated worktree as soon as you start a WU so branch switches, installs, and dev servers stay isolated (even if you are the only person active right now). Always mark the WU `in_progress` (backlog + status) on the shared checkout **before** creating the worktree so other agents see the lane is occupied. Use the helper `pnpm wu:claim` to bundle the claim commit (to `main`) followed by worktree creation in one step.

- **One worktree per active lane WU** – e.g., `git worktree add worktrees/experience-wu341 -b lane/experience/wu-341`.
- **Keep everything isolated** – run installs, dev servers, and tests inside that worktree only.
- **Respect WIP** – when a WU moves to `blocked` or `done`, remove its worktree (`git worktree remove worktrees/experience-wu341`) before starting another.
- **Share conventions** – document lane worktree names in the WU card so teammates know where the branch lives.

This keeps parallel agents from stepping on each other’s builds while still honoring “one WU per lane”.

#### Helper: Atomic Claim + Worktree

- Claim on shared checkout, then create the worktree:
  - Stage your claim edits (update `{PROJECT_ROOT}/tasks/status.md`, the WU YAML, and adjust `backlog.md`).
  - Run: `pnpm wu:claim --id WU-341 --lane Experience [--worktree worktrees/experience-wu-341] [--branch lane/experience/wu-341]`.
  - The helper commits and pushes the claim to `main`, then creates the worktree and branch (default location: `worktrees/<lane>-wu-xxx`).
  - **IMMEDIATELY `cd` into the new worktree:** `cd worktrees/experience-wu-341`
  - **ALL subsequent work MUST happen inside this worktree directory** — edits, commits, testing, gates.
  - NEVER return to the main directory to make edits for this WU. Stay in the worktree until completion; hooks now fail WU commits attempted from the main checkout.

#### Helper: Complete + Cleanup

- After tests and gates are green:
  - Run: `pnpm wu:done --id WU-341`.
  - This helper performs a complete WU completion sequence:
    1. **Auto-merges** the lane branch (e.g., `lane/operations/wu-341`) to `main` if it exists
    2. Marks the WU `done` in the WU YAML (setting `status: done`, `locked: true`, `completed: YYYY-MM-DD`)
    3. Updates `status.md` and `backlog.md` (moves to Done with today's date)
    4. Creates `.beacon/stamps/WU-341.done`
    5. Commits and pushes to `main`
    6. Removes the associated worktree
  - Flags:
    - `--no-auto` (if you staged the edits manually)
    - `--worktree <path>` (override default worktree path)
    - `--no-remove` (skip worktree removal)
    - `--no-merge` (skip auto-merging lane branch; use if already merged or working directly on main)
    - `--delete-branch` (delete lane branch after merge, both local and remote)
  - **Important**: The helper expects to be run from the main worktree, on the `main` branch. It will merge your lane branch automatically.

#### Helper: Pause (Blocked)

- If a dependency halts progress:
  - Run: `pnpm wu:block --id WU-341 --reason "<dependency>"`.
  - The helper updates the WU YAML to `blocked`, moves the card from In Progress → Blocked in both `status.md` and `backlog.md`, commits/pushes to `main`, and (optionally) removes the worktree when `--remove-worktree` is passed.
  - Flags: `--no-auto` (manual edits already staged), `--remove-worktree`, `--worktree <path>` (override inferred worktree path).

#### Helper: Resume (Unblock)

- When the blocker clears:
  - Run: `pnpm wu:unblock --id WU-341 [--reason "<note>"] [--create-worktree]`.
  - This restores the WU to `in_progress`, updates `status.md` and `backlog.md`, commits/pushes to `main`, and optionally creates a fresh worktree/branch (`--create-worktree`, with overrides via `--worktree`/`--branch`).
  - Flags: `--no-auto` (manual edits staged), `--reason`, `--create-worktree`, `--worktree <path>`, `--branch <name>`.

#### Helper: Prune (Worktree Maintenance)

- To maintain worktree hygiene and detect issues:
  - Run: `pnpm wu:prune` (dry-run mode, shows issues without making changes).
  - Run: `pnpm wu:prune --execute` (actually runs `git worktree prune`).
  - This tool validates worktree ↔ WU ↔ lane mappings and detects:
    - **Orphaned worktrees**: Worktree exists but no matching WU YAML file
    - **Stale worktrees**: WU status is `done` or `blocked` but worktree still exists
    - **Invalid branches**: Branch doesn't follow `lane/<lane>/<wu-id>` convention
    - **Lane mismatches**: Branch lane doesn't match WU YAML lane field
  - Safe to run regularly (doesn't break active work).
  - Recommended: Run weekly or before claiming new WUs to keep workspace clean.

**When to run `pnpm wu:prune`:**

- **Weekly maintenance**: Part of regular housekeeping
- **Before claiming**: Ensure clean state before starting new WU
- **After bulk operations**: After marking multiple WUs done or cleaning up branches
- **Troubleshooting**: When worktree state seems inconsistent

**Example output:**

```bash
$ pnpm wu:prune
[wu-prune] Found 3 worktree(s)

[wu-prune] ⚠️  Warnings for /home/user/repo/worktrees/operations-wu-407:
    Stale worktree: WU WU-407 is marked 'done'
    Worktree: /home/user/repo/worktrees/operations-wu-407
    Action: Remove with 'git worktree remove /home/user/repo/worktrees/operations-wu-407'

[wu-prune] Summary
[wu-prune] Total worktrees: 3
[wu-prune] Warnings: 1
[wu-prune] Errors: 0
```

**Choosing the right setup**

| Situation                                                                       | Recommendation                                                                   |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Any claimed WU** (code, docs, YAML, tooling, prompts)                         | Use the lane worktree only. Main checkout is read-only once the WU is claimed.   |
| **Quick non-WU hygiene** (typo spotted while reviewing)                         | Main checkout allowed – document the reason in the commit and keep it surgical.  |
| **Multiple humans/agents active in parallel lanes**                             | One worktree + branch per WU so installs, caches, and dev servers stay isolated. |
| **External sub-agent (e.g., Claude) assisting on the same WU**                  | Keep everyone in the same worktree/branch to avoid diverging states.             |
| **CI or tooling needs clean environments (large `node_modules`, heavy caches)** | Prefer worktrees so each lane manages its own dependencies without churn.        |

Always remove the worktree once the WU is merged or blocked. Document the worktree path (e.g., `worktrees/wu-345`) in the WU notes so teammates know where to find it.

#### Common Worktree Mistakes & Fixes

**Mistake 1: Working in main directory after claiming WU**

**Symptoms:**

- Commits show up on `main` branch instead of `lane/<lane>/<wu-id>` branch
- Worktree directory exists but is empty or out of sync
- `pnpm wu:done` fails or skips merge step

**Root cause:** After running `pnpm wu:claim`, user stayed in main directory instead of `cd`-ing into worktree.

**Fix:**

```bash
# 1. Check where you are
pwd  # If you see /path/to/repo (not /path/to/repo/worktrees/...), you're in the wrong place

# 2. Check git status to see uncommitted changes
git status

# 3. ⚠️ ONLY if changes are YOURS: stash them
#    If changes are another agent's work, STOP and see §4.6 instead!
git stash

# 4. cd into the worktree
cd worktrees/<lane>-wu-<id>

# 5. Apply your stashed changes
git stash pop

# 6. Continue work here
```

**Prevention:** ALWAYS run `cd worktrees/<lane>-wu-<id>` immediately after `pnpm wu:claim`.

---

**Mistake 2: Manually merging lane branch instead of using pnpm wu:done**

**Symptoms:**

- WU YAML still shows `status: in_progress`
- No `.beacon/stamps/WU-<id>.done` file created
- `backlog.md` and `status.md` not updated
- Worktree still exists after merge

**Root cause:** User manually ran `git merge` or `git rebase` instead of using the `pnpm wu:done` helper.

**Fix:**

```bash
# 1. Ensure you're on main branch
git checkout main

# 2. Run the helper (it will detect existing merge and just update docs)
pnpm wu:done --id WU-<id> --no-merge

# 3. If worktree still exists, remove it manually
git worktree remove worktrees/<lane>-wu-<id>
```

**Prevention:** ALWAYS use `pnpm wu:done --id WU-<id>` for completion. Never manually merge lane branches.

---

**Mistake 3: Orphaned worktree after completion**

**Symptoms:**

- WU is marked `done` in YAML and backlog
- Worktree directory still exists
- `git worktree list` shows worktree with "done" WU

**Root cause:** Used `pnpm wu:done --no-remove` flag or manually merged without cleanup.

**Fix:**

```bash
# 1. List all worktrees to confirm
git worktree list

# 2. Remove the orphaned worktree
git worktree remove worktrees/<lane>-wu-<id>

# 3. Optionally delete the remote branch if it still exists
git push origin --delete lane/<lane>/wu-<id>
```

**Prevention:** Don't use `--no-remove` flag unless you have a specific reason. Let `pnpm wu:done` clean up automatically.

---

**Mistake 4: Lost work after blocking WU with --remove-worktree**

**Symptoms:**

- Ran `pnpm wu:block --remove-worktree` but forgot to push commits first
- Worktree removed but changes lost
- Lane branch doesn't exist on remote

**Root cause:** Blocked WU and removed worktree before pushing local commits.

**Fix:**

```bash
# 1. Check if branch still exists locally
git branch -a | grep lane/<lane>/wu-<id>

# 2. If branch exists locally, recreate worktree
git worktree add worktrees/<lane>-wu-<id> lane/<lane>/wu-<id>
cd worktrees/<lane>-wu-<id>

# 3. Push your commits
git push origin lane/<lane>/wu-<id>

# 4. Now you can safely block and remove
cd ../..
pnpm wu:block --id WU-<id> --reason "<reason>" --remove-worktree
```

**Prevention:** ALWAYS push commits before using `pnpm wu:block --remove-worktree`. Or don't use `--remove-worktree` flag if you have unpushed work.

---

**Mistake 5: Working in wrong worktree**

**Symptoms:**

- Making changes in `worktrees/experience-wu-341` but the active WU is WU-342
- Commits reference wrong WU ID
- Pre-commit hooks fail with WU mismatch

**Root cause:** Multiple worktrees exist and user cd'd into the wrong one.

**Fix:**

```bash
# 1. Check which worktree you're in
git branch --show-current  # Should be lane/<lane>/wu-<id>

# 2. Check which WU you should be working on
cat ../../{PROJECT_ROOT}/tasks/status.md  # See "In Progress" section

# 3. cd to correct worktree
cd ../../worktrees/<correct-lane>-wu-<correct-id>
```

**Prevention:**

- Only create worktree when claiming WU (respect WIP=1)
- Run `pnpm wu:prune` regularly to remove stale worktrees
- Check `git branch --show-current` before starting work

---

**Quick Reference: Worktree Discipline Checklist**

- [ ] After `pnpm wu:claim`, immediately `cd worktrees/<lane>-wu-<id>`
- [ ] ALL edits happen inside worktree (never in main directory)
- [ ] Commit and push regularly from inside worktree
- [ ] When done, `cd ../..` back to main, then run `pnpm wu:done`
- [ ] Never manually merge lane branches
- [ ] Push commits before blocking with `--remove-worktree`
- [ ] Run `pnpm wu:prune` weekly to catch stale worktrees

#### Worktree Safety Hooks

Git hooks (via Husky) enforce worktree discipline automatically. All hooks skip `tmp/*` branches used by CLI micro-worktrees.

**pre-commit:**

- **Blocks direct commits to `main`/`master`** (use `pnpm wu:claim` workflow)
- Respects Branch-Only mode: checks `claimed_mode: branch-only` in WU YAML
- Blocks lane branch work in main checkout unless Branch-Only mode is active

**commit-msg:**

- **On main:** Only allows LumenFlow commit formats:
  - `wu(wu-XXX): claim for <lane> lane`
  - `wu(wu-XXX): done - <title>`
  - `docs: create wu-XXX for <title>`
  - `docs: edit wu-XXX spec`
  - `wu(wu-XXX): spec update`
  - `wu(wu-XXX): block` / `wu(wu-XXX): unblock`
  - `fix(wu-XXX): repair ...`
  - `chore(repair): ...` / `chore(wu-XXX): ...`
  - `style: ...`
- **On lane branches:** Requires WU ID in commit message (e.g., `wu(wu-1017): ...`)

**prepare-commit-msg:**

- Auto-injects `wu(wu-XXX): ` prefix from branch name if not present
- Skips if source is message/commit/merge (user provided `-m`)
- Skips if message already has conventional commit prefix with WU ID

**pre-push:**

- **Blocks direct push to `main`/`master`** (use `pnpm wu:done` to merge)
- **Allows ALL lane branch pushes** (per WU-1255: protection at merge time)
- Parses stdin refs to catch bypasses like `git push origin HEAD:main`

**Escape hatch:**

For emergencies, bypass all hooks with:

```bash
LUMENFLOW_FORCE=1 git commit -m "emergency fix"
LUMENFLOW_FORCE=1 git push
```

**Hook setup:**

Hooks are installed automatically via Husky. The `.husky/` directory (including `_/husky.sh`) is tracked in git for worktree compatibility. To manually configure:

```bash
git config core.hooksPath .husky
```

### 4.5 Multi-Agent Workflows

When using Claude Code's Task tool or spawning multiple specialized agents (lumenflow-pm, lumenflow-doc-sync, lumenflow-enforcer, etc.), ALWAYS follow the agent invocation context loading protocol documented in [agent-invocation-guide.md](agent-invocation-guide.md).

**Critical Rule:** Every agent invocation MUST load LumenFlow context (CLAUDE.md, README.md, lumenflow.md §§1-7, WU YAML) BEFORE task-specific instructions, or agents will violate worktree discipline and coordination principles.

**Constraints block (append at the end of the prompt):**

- Place the **Critical Constraints** block from [agent-invocation-guide.md](agent-invocation-guide.md#append-these-constraints-at-the-end-mandatory) at the very end of every multi-agent prompt.
- The block enforces three immutable rules:
  1. Shell/Bash failure → STOP immediately and report **BLOCKED**.
  2. Run `node tools/lib/agent-verification.mjs WU-123` before claiming success.
     - Exit 0 → WU verified (git clean, stamp exists, commit landed on main).
     - Exit 1 → Verification failed → report **INCOMPLETE**, never "done".
  3. No fabricated success: if verification fails or context loads break, surface the issue instead of reporting success.

**Why This Matters:**

- During WU-509/WU-505-507 rehearsal, agents skipped git discipline, reported "success", and left uncommitted changes behind because verification was not enforced.
- Task-only prompts (no context) cause agents to work on main instead of worktrees, violate WIP=1 enforcement, and ignore DoD requirements.

**Required Reading Before Multi-Agent Work:**

1. Read [agent-invocation-guide.md](agent-invocation-guide.md) in full
2. Use the standard context loading preamble template
3. Define clear constraints (worktree vs main, Docs-Only mode, etc.)
4. Specify deliverables and acceptance criteria
5. Avoid hardcoding agent-type assumptions

**When to Use Multi-Agent:**

- Parallel work is safe (no file conflicts)
- Each agent has clear, non-overlapping scope
- Context loading is guaranteed for every agent
- Coordination is explicitly defined

**When to Avoid:**

- Work overlaps (two agents editing same file)
- Sequential dependencies (agent B needs agent A's output)
- Debugging is hard (too many agents complicate tracing)

**Default:** Single-agent execution with full context loading is safer and simpler for most WUs.

**Drafting future WUs (do this before running `wu:create`):**

- Capture follow-up ideas inside the `notes` field of the WU you already own.
- Flesh out the description + acceptance criteria there. Only run `pnpm wu:create`
  once the spec is ready for anyone to claim immediately.
- Never leave partially written WU YAML files or backlog entries on `main`. `wu:create`
  is the publication step, not the drafting step, and creating a WU does **not**
  reserve it for the author.
- After creation, use `pnpm wu:edit` to fill placeholders or update the spec.
  Do not manually edit WU YAML on `main`. Manual commits on `main` are blocked.
  See [workspace-modes.md](../../ai/onboarding/workspace-modes.md) for wu:edit usage.

### 4.6 Encountering Other Agents' Work on Main

**Scenario:** You run `git status` on main and see uncommitted changes you didn't create.

**Diagnosis:**

```bash
git status  # Shows modified files
git diff    # Check if changes are yours
```

**If changes are NOT yours:**

1. **STOP immediately**
2. **DO NOT**:
   - Run `git stash` (removes their work)
   - Run `git reset` (destroys their changes)
   - Run `git commit` (commits their work under your name)
   - Touch their files in any way
3. **DO**:
   - Ask the user: "I see uncommitted changes on main that aren't mine. How should I proceed?"
   - Wait for coordination instructions

**Why:** Another agent may be mid-task. The user needs to coordinate between agents to prevent data loss or workflow violations.

**Prevention:**

- Always work in worktrees after claiming (never on main)
- If you violated this and worked on main, commit YOUR changes before claiming a new WU
- Check `git status` is clean before claiming
- Activate git shim: `export PATH="$(pwd)/tools/shims:$PATH"` (blocks destructive commands)

**Remediation (if destructive command was run):**

If someone accidentally ran `git reset --hard`, `git stash`, or `git clean -fd` on main and destroyed uncommitted work:

1. **Assess the damage:**

   ```bash
   git status  # Check what was lost
   git reflog  # Shows recent HEAD movements
   git stash list  # Check if changes were stashed (not destroyed)
   ```

2. **Recovery options** (in order of likelihood):

   **Option A:** Work was stashed (not destroyed):

   ```bash
   git stash list  # Find the stash
   git stash show stash@{0}  # Preview changes
   git stash pop stash@{0}  # Restore the work
   ```

   **Option B:** Work was reset but not pushed:

   ```bash
   git reflog  # Find commit before reset
   git reset --hard <commit-sha>  # Restore to that point
   ```

   **Option C:** Work was in a worktree (check worktree list):

   ```bash
   git worktree list  # Find associated worktree
   cd worktrees/<lane>-wu-xxx  # Navigate to it
   git status  # Check if changes are there
   ```

   **Option D:** Work was truly destroyed:
   - Check if other agent has pushed to their lane branch: `git fetch origin && git log origin/lane/<lane>/wu-xxx`
   - Inform human immediately - may need agent re-run or manual recovery

3. **Document the incident:**

   ```bash
   # Log to audit file
   echo "$(date): Destructive command run on main. Recovery: [describe]" >> .beacon/incidents.log

   # Create incident WU if data loss occurred
   pnpm wu:create --title "INCIDENT: Data loss from <command> on main" --priority P0 --lane Operations
   ```

4. **Prevent recurrence:**
   - Ensure git shim is active for all agent sessions (see [ai/onboarding/agent-invocation-guide.md](../../../ai/onboarding/agent-invocation-guide.md))
   - Update starting prompt to front-load forbidden commands warning (WU-629)
   - Add session command logger for forensics (WU-630)

**Git Shim Protection:**

As of WU-628, a git shim at `tools/shims/git` blocks these commands on main BEFORE execution:

- `git reset --hard`, `git stash`, `git clean -fd`, `git checkout -f`, `git push --force/-f`
- `--no-verify`, `--no-gpg-sign` flags

To activate: `export PATH="$(pwd)/tools/shims:$PATH"` before any git commands.

See: [../../../tools/shims/README.md](../../../tools/shims/README.md) for details.

**Agent Branch Bypass (WU-1026):**

Cloud agents (like Prompt Studio or GitHub Actions) that create their own branches can bypass worktree requirements when working on branches matching configured patterns.

Configuration in `.lumenflow.config.yaml`:

```yaml
git:
  mainBranch: main
  agentBranchPatterns:
    - "agent/*"      # Default: agent-created branches
    - "claude/*"     # Optional: add vendor-specific patterns
```

**How it works:**

1. **Fail-closed default**: Unknown branches are blocked when worktrees exist
2. **Protected branches never bypassed**: `mainBranch` and `master` are always protected
3. **Lane branches blocked**: `lane/*` branches require worktree workflow
4. **Agent branches allowed**: Branches matching `agentBranchPatterns` can work in main checkout

**Guarded headless mode:**

For CI/CD pipelines, set `LUMENFLOW_HEADLESS=1` with one of:
- `LUMENFLOW_ADMIN=1` (explicit admin override)
- `CI=true` (standard CI environment)
- `GITHUB_ACTIONS=true` (GitHub Actions)

This bypasses worktree checks for automation that manages its own isolation.

**Detection priority:**

1. Headless mode (if guarded) → bypass
2. Detached HEAD → protected (fail-closed)
3. Agent branch pattern match → bypass
4. Protected branch → protected
5. Lane branch → protected (use worktree)
6. Unknown branch → protected (fail-closed)

---

## 5. Example Flow: Rolling Out a New Prompt Version

| Lane         | WU                              | Key Activities                                                                             |
| ------------ | ------------------------------- | ------------------------------------------------------------------------------------------ |
| Discovery    | `Research LLM tone options`     | Run MCP searches, summarise candidate prompts, log evaluation criteria.                    |
| Intelligence | `Draft prompt v1.13`            | Define ports for evaluator, write tests comparing responses, author prompt sections.       |
| Core Systems | `Enable OpenAI web_search tool` | Update ports, write tests for request builder, implement adapter, extend Supabase caching. |
| Experience   | `Surface inline citations`      | Add UI components, write RTL tests, wire SSE handler to show annotations.                  |
| Operations   | `Update monitoring dashboards`  | Ensure prompt version and tool usage metrics ship to observability stack.                  |

Each lane runs one active WU. If web_search tool rollout pauses awaiting approval, move that WU to `blocked` and allow Experience lane to continue.

---

## 6. Ceremony Cadence

- **Daily Flow Review (15 min)** – Check each lane, update blockers, confirm lane capacity.
- **Weekly Retro (<45 min)** – Inspect throughput, highlight documentation or tooling gaps, feed improvements into backlog.
- **Monthly Calibration** – Validate lane definitions, archive unused ones, and publish updates to the operating manual.
- **Quarterly Betting Table (60-90 min)** – Review backlog health, evaluate stale WUs, prevent backlog obesity.

### Quarterly Betting Table Ceremony

**Purpose:** Prevent backlog bloat by systematically reviewing all `ready` WUs and deciding which to keep, archive, or split.

**When:** Every quarter (Q1: January, Q2: April, Q3: July, Q4: October)

**Participants:** Product owner, tech lead, and at least one representative from each active lane

**Process:**

1. **Automated hygiene check** (before ceremony):
   - Run `pnpm backlog:prune` to identify stale and archivable WUs
   - Review the output to understand backlog health

2. **Review each Ready WU** (evaluate in priority order):
   For each WU, ask the "betting table" questions:
   - **Is this still valuable?** Has the business context changed?
   - **What's the risk/cost** of doing it now vs later?
   - **Why hasn't it moved** in 60+ days?
   - **Should we keep, drop, or split** it?

3. **Decision outcomes:**
   - **Keep active**: Add renewal fields to WU YAML:
     ```yaml
     renewed: YYYY-MM-DD
     renewal_reason: 'Still critical for Q4 launch'
     ```
   - **Archive**: Mark `lifecycle: archived`, document reason in `archive.md`
   - **Split**: Break into smaller, more actionable WUs
   - **Promote**: Move to higher priority if urgency increased

4. **Backlog health metrics:**
   - Track average age of Ready WUs
   - Count of WUs renewed vs archived
   - Total backlog size trend over time

**Tool support:**

```bash
# Dry-run to see what would be marked stale/archived
pnpm backlog:prune

# Execute to apply lifecycle changes
pnpm backlog:prune --execute
```

**Philosophy:** Inspired by Shape Up's "no backlog" approach, we acknowledge that backlogs are necessary for AI agent coordination but prevent them from becoming dumping grounds. Regular pruning maintains backlog health and focuses team energy on truly valuable work.

---

## 7. Backlog Lifecycle Management

### WU Lifecycle States

All WUs have a `lifecycle` field that tracks freshness independently of work status:

- **`active`** (default): WU is current and ready to be worked
- **`stale`**: No activity for 60+ days (configurable via `stale_after_days` field)
- **`archived`**: No activity for 90+ days, moved to `archive.md`

### Automatic Staleness Detection

The `pnpm backlog:prune` tool automatically:

1. Scans all WU YAML files in `{PROJECT_ROOT}/tasks/wu/`
2. Checks last modification date from git history
3. Marks WUs as `stale` if inactive for 60+ days
4. Archives WUs if inactive for 90+ days
5. Respects renewal dates (checked before last modified date)

### Renewal Process

To keep a WU active past its staleness threshold:

1. Add renewal fields to the WU YAML:
   ```yaml
   renewed: YYYY-MM-DD
   renewal_reason: 'Blocking dependency resolved, ready to prioritize'
   ```
2. The renewal date resets the staleness clock
3. Document why the WU should remain active (required for audit trail)

### Archive Format

Archived WUs are listed in `{PROJECT_ROOT}/tasks/archive.md` with:

- Link to original WU YAML (remains in `wu/` directory)
- Archive date
- Reason for archiving (usually inactivity duration)

Example:

```markdown
- [WU-123 — Add advanced search filters](wu/WU-123.yaml)
  Archived: 2025-10-15
  Reason: No movement for 95 days, superseded by WU-456
```

### Best Practices

- Run `pnpm backlog:prune` weekly to catch stale WUs early
- Review stale WUs before they reach 90 days (archive threshold)
- Use quarterly ceremony to make renewal/archive decisions
- Keep renewal reasons concise but specific
- Don't delete archived WUs—they remain as historical record

---

## 8. Artefact Checklist

Before moving a WU to `done`, confirm:

- [ ] Port/interface definitions merged.
- [ ] Tests green with coverage reported.
- [ ] Adapter or integration code merged.
- [ ] Documentation updated (manifest, progress log, change manifest).
- [ ] Telemetry or monitoring hooks updated if relevant.
- [ ] Release note or changelog entry drafted.

---

## 9. Testing Strategy

### 9.1 Golden Dataset Testing

Golden dataset testing validates LLM classification services against curated expected outputs. This approach enables objective measurement of accuracy improvements vs hardcoded baselines.

#### When to Use Golden Datasets

Use golden datasets for:

- **LLM classifier validation**: Mode detection, red flag detection, PHI detection, entity recognition
- **Regression testing**: Ensure LLM updates don't degrade accuracy
- **Baseline comparison**: Measure LLM vs regex/keyword accuracy
- **Edge case documentation**: Capture complex scenarios (sarcasm, context-dependent classification)

#### Golden Dataset Format

Datasets are stored in YAML format at `{PROJECT_ROOT}/web/tests/golden/`:

```yaml
name: Mode Detection Golden Dataset
version: '1.0'
description: |
  Tests mode detection across 4 modes: default, rights, qpl, support
created: '2025-10-15'
lastUpdated: '2025-10-15'

examples:
  - id: default-001
    input: What are the side effects of chemotherapy?
    expectedOutput:
      mode: default
      confidence: 0.9
    category: mode
    description: Standard treatment question
    tags: [default, treatment, common]
    source: synthetic

  - id: rights-001
    input: How do I access my medical records?
    expectedOutput:
      mode: rights
      confidence: 0.95
    category: mode
    description: Record access request
    tags: [rights, records, gdpr]
    source: synthetic
```

**Key fields:**

- `id`: Unique identifier (e.g., `default-001`)
- `input`: Text to classify
- `expectedOutput`: Expected classification result
- `category`: Dataset category (mode, red_flag, phi, entity)
- `description`: Human-readable explanation
- `tags`: For filtering/grouping (e.g., `[edge_case, sarcasm]`)
- `source`: Origin (real_user, synthetic, regression)

#### Golden Test Runner

The test runner (`{PROJECT_ROOT}/web/tests/utils/goldenRunner.ts`) provides:

**Core features:**

- Load datasets from YAML/JSON
- Run classification on each example
- Compare actual vs expected (with tolerance for numeric values)
- Calculate metrics: accuracy, precision, recall, F1 score
- Generate HTML failure reports
- VCR (record/replay) support for CI

**Usage example:**

```typescript
import { runGoldenDatasetTest } from '@/tests/utils/goldenRunner';

const results = await runGoldenDatasetTest({
  datasetPath: 'tests/golden/mode-detection.yaml',
  classifier: modeDetector.detectMode,
  vcr: { mode: 'replay', cassettePath: 'tests/vcr/mode-detection.json' },
  tolerance: 0.1, // Allow 0.1 difference in confidence scores
});

expect(results.metrics.accuracy).toBeGreaterThan(0.85);
```

#### VCR (Record/Replay)

VCR prevents flaky tests from LLM non-determinism and reduces API costs in CI:

**Record mode** (run locally with real OpenAI):

```typescript
vcr: {
  mode: 'record',
  cassettePath: 'tests/vcr/mode-detection.json'
}
```

Saves LLM responses to cassette file for replay in CI.

**Replay mode** (run in CI):

```typescript
vcr: {
  mode: 'replay',
  cassettePath: 'tests/vcr/mode-detection.json'
}
```

Uses saved responses, no OpenAI calls, deterministic results.

**Off mode** (always call real LLM):

```typescript
vcr: {
  mode: 'off';
}
```

#### Metrics Calculated

The runner calculates:

- **Accuracy**: `passed / total`
- **Precision**: True positives / (True positives + False positives)
- **Recall**: True positives / (True positives + False negatives)
- **F1 Score**: Harmonic mean of precision and recall
- **Processing time**: avg, p95, p99 in milliseconds

#### Best Practices

**Dataset quality:**

- Include **edge cases**: Sarcasm, hypotheticals, ambiguous inputs, educational mentions
- Cover **all modes/types**: Ensure balanced representation
- Add **regression examples**: When bugs are found, add them to prevent recurrence
- Use **realistic inputs**: Prefer real user examples over purely synthetic
- Document **why**: Use `description` field to explain what each example tests

**Test organization:**

- One dataset per classification type (mode, red_flag, phi, entity)
- 50-100+ examples per dataset minimum
- Tag examples for filtering (e.g., `[edge_case]`, `[critical]`, `[uk_specific]`)
- Version datasets when format changes

**CI integration:**

- Always use VCR replay mode in CI (no API calls)
- Record cassettes locally after prompt changes
- Commit cassettes to git for reproducibility
- Generate HTML reports for failed tests
- Set accuracy thresholds (e.g., ≥85% for mode detection)

**Example test file:**

```typescript
describe('Mode Detection Golden Dataset', () => {
  it('should achieve ≥85% accuracy on golden dataset', async () => {
    const results = await runGoldenDatasetTest({
      datasetPath: 'tests/golden/mode-detection.yaml',
      classifier: modeDetector.detectMode,
      vcr: { mode: 'replay', cassettePath: 'tests/vcr/mode-detection.json' },
    });

    expect(results.metrics.accuracy).toBeGreaterThan(0.85);

    // Generate HTML report for failures
    if (results.metrics.failed > 0) {
      await generateHTMLReport(results, 'test-results/mode-detection-failures.html');
    }
  });

  it('should handle edge cases correctly', async () => {
    const results = await runGoldenDatasetTest({
      datasetPath: 'tests/golden/mode-detection.yaml',
      classifier: modeDetector.detectMode,
      filterTags: ['edge_case'], // Only run edge case examples
    });

    // Edge cases may have lower accuracy threshold
    expect(results.metrics.accuracy).toBeGreaterThan(0.7);
  });
});
```

#### Golden Datasets Reference

Current golden datasets:

- **Mode Detection**: `tests/golden/mode-detection.yaml` (60 examples)
  - Tests: default, rights, qpl, support modes
  - Edge cases: greetings, mixed modes, ambiguous inputs
  - UK-specific: NHS terminology, GP references

- **Red Flag Detection**: `tests/golden/red-flag-detection.yaml` (100 examples)
  - Tests: self_harm, violence, medical_emergency, vulnerable
  - Edge cases: media mentions, sarcasm, past tense, educational context
  - Critical: MUST NOT flag documentaries, third-person mentions, recovery stories

- **PHI Detection**: `tests/golden/phi-detection.yaml` (60 examples)
  - Tests: phone, nhs_number, postcode, email, name, address
  - Edge cases: hospital numbers (not personal), partial info, famous addresses
  - UK-specific: NHS numbers, UK postcodes, UK phone formats

- **Entity Recognition**: `tests/golden/entity-recognition.yaml` (115 examples)
  - Tests: medications, treatments, symptoms
  - Edge cases: questions about entities, past medications, third-person mentions
  - UK-specific: paracetamol, co-codamol, co-amoxiclav, UK drug names

### 9.2 Coverage Enforcement

**Configuration**: Test coverage is configured in `vitest.config.ts` (root) with LumenFlow-compliant thresholds.

**Thresholds** (enforced automatically by vitest):

| Layer                                          | Statements | Branches | Functions | Lines | Rationale                                            |
| ---------------------------------------------- | ---------- | -------- | --------- | ----- | ---------------------------------------------------- |
| Application (`@exampleapp/application`)       | ≥90%       | ≥90%     | ≥90%      | ≥90%  | Business logic MUST be comprehensively tested (§2.3) |
| Infrastructure (`@exampleapp/infrastructure`) | ≥80%       | ≥80%     | ≥80%      | ≥80%  | Adapters require thorough integration tests (§6.4.4) |
| Global (all code)                              | ≥80%       | ≥80%     | ≥80%      | ≥80%  | Maintains minimum quality bar across codebase        |

**CI Enforcement** (WU-1002):

Coverage is automatically measured and enforced in CI via `.github/workflows/beacon-gates.yml`:

1. **Coverage Collection**: `pnpm test:coverage` runs after unit tests, before E2E
2. **Artifact Upload**: Coverage reports (`coverage/`) uploaded to GitHub Actions with 30-day retention
3. **Threshold Enforcement**: Build fails if coverage below thresholds (configured in vitest.config.ts)
4. **Audit Trail**: Coverage artifacts downloadable from Actions tab for compliance evidence (compliance framework)

**Running Locally**:

```bash
# Generate coverage report (all packages)
pnpm test:coverage

# View HTML report
open coverage/index.html

# Coverage reports:
# - coverage/index.html - Interactive HTML report
# - coverage/lcov.info - LCOV format (CI integration)
# - coverage/coverage-final.json - JSON format
```

**Troubleshooting**:

- **Build fails on coverage**: Check console output for files below threshold, open `coverage/index.html` to see detailed coverage by file
- **Coverage plugin version mismatch**: Ensure `@vitest/coverage-v8` matches `vitest` core version (current standard: `vitest@^3.2.4` with `@vitest/coverage-v8@^3.2.4`)
- **Coverage not collected**: Verify `vitest.config.ts` exists and includes coverage configuration

**References**:

- [docs/02-technical/testing/README.md](../../02-technical/testing/README.md#coverage-configuration) - Detailed coverage configuration guide
- vitest.config.ts - Root configuration with thresholds
- apps/web/vitest.config.ts - Web app-specific coverage settings

---

## 10. Command Reference

### Quick Decision Tree

**Choose your workflow mode:**

- **Docs-only WU?** → Use `pnpm wu:claim -- --id WU-123 --lane Operations --branch-only` + `pnpm wu:done -- --id WU-123` (automatically detects docs-only type)
- **Code/Infrastructure WU (standard)?** → Use Worktree mode (default): `pnpm wu:claim` creates isolated workspace
- **Worktrees unavailable (Codespaces/constraints)?** → Use Branch-Only mode (requires WU-510 completion): `pnpm wu:claim -- --branch-only`

### 10.1 WU Lifecycle Commands

#### `pnpm wu:claim -- --id WU-123 --lane <lane> [OPTIONS]`

**What:** Claims a WU for a lane, creates worktree/branch, updates status/backlog

**When:** Starting work on a ready WU

**Flags:**

- `--id WU-123` — (Required) WU ID to claim
- `--lane <lane>` — (Required) Lane to claim in (Experience, CoreSystems, Intelligence, Operations, Discovery)
- `--worktree <path>` — Override default worktree path (default: `worktrees/<lane>-<wu-id>`)
- `--branch <name>` — Override default branch name (default: `lane/<lane>/<wu-id>`)
- `--branch-only` — Create branch without worktree (lightweight mode for docs/Codespaces, no parallel WUs)
- `--no-auto` — Skip auto-updating YAML/backlog/status (you staged manually)
- `--force` — Override lane WIP=1 enforcement (P0 emergencies only, risk of collision)
- `--help, -h` — Show help

**Example:**

```bash
pnpm wu:claim -- --id WU-506 --lane Operations
cd worktrees/operations-wu-506  # CRITICAL: Immediately cd into worktree
```

---

#### `pnpm wu:done -- --id WU-123 [OPTIONS]`

**What:** Completes WU (runs gates, merges branch, updates docs, creates stamp, removes worktree)

**When:** WU passes all acceptance criteria and gates

**Flags:**

- `--id WU-123` — (Required) WU ID to complete
- `--worktree <path>` — Override worktree path (default: `worktrees/<lane>-<wu-id>`)
- `--no-auto` — Skip auto-updating YAML/backlog/status (you staged manually)
- `--no-remove` — Skip worktree removal (leaves worktree in place)
- `--no-merge` — Skip auto-merging lane branch (already merged manually)
- `--delete-branch` — Delete lane branch after merge (both local and remote)
- `--skip-gates` — **DANGER:** Skip gates check (requires `--reason` + `--fix-wu`, audited to `.beacon/skip-gates-audit.log`)
- `--reason "<text>"` — (Required with `--skip-gates` or `--override-owner`) Why action is being taken
- `--fix-wu WU-123` — (Required with `--skip-gates`) WU that will fix the pre-existing failures
- `--allow-todo` — Allow TODO comments in code (requires justification in WU notes, use sparingly)
- `--override-owner` — Override ownership check (requires `--reason`, audited to `.beacon/ownership-override-audit.log`)
- `--help, -h` — Show help

**🚨 GUARDRAIL 2: Ownership Semantics (Never Complete WUs You Don't Own)**

`wu:done` enforces ownership: current user must match `assigned_to` field in WU YAML (populated by `wu:claim`).

- Missing worktree → fail (unless documented escape hatch)
- Worktree present + owner match → allow
- Worktree present + owner mismatch → block (requires override)

To override (only with explicit reason and approval):

```bash
pnpm wu:done -- --id WU-123 --override-owner --reason "Tom asked me to complete this during pairing"
```

**Agents:** NEVER use `--override-owner` without explicit instruction; always include `--reason`.

**Language protocol:**

- "pick up WU-XXX" = READ ONLY
- "complete/finish WU-XXX" = run wu:done ONLY if you own it

**Pairing Handshake:** To assist mid-flight, add yourself as `co_assigned` (or reassign) before finishing.

**Example:**

```bash
cd /path/to/main/checkout  # Return to main before running wu:done
pnpm wu:done -- --id WU-506  # Runs gates, merges, stamps, cleans up
```

**Emergency skip-gates example (pre-existing failures only):**

```bash
pnpm wu:done -- --id WU-420 --skip-gates --reason "Pre-existing test failures in unrelated module" --fix-wu WU-421
```

**Thinking of --skip-gates?**

- Confirm failures pre-date your branch (run `git diff main..HEAD` in worktree to verify your changes are clean)
- Log `--reason` explaining pre-existing failures
- Name `--fix-wu WU-XXX` that will fix them
- **Hooks still apply; do not use `--no-verify`**

### Common Scenarios: What's Allowed?

| I want to…                                          | Allowed? | How                                                               | Why                                             |
| --------------------------------------------------- | -------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| Skip Git hooks                                      | ❌ No    | **Never use `--no-verify` / `--no-gpg-sign`**                     | Hooks guard format, msg, and worktree rules     |
| Skip running gates because failures pre-exist       | ✅ Yes   | `pnpm wu:done --skip-gates --reason "..." --fix-wu WU-XXX` (rare) | Still runs hooks; forces documentation & fix WU |
| Complete a WU without `wu:done`                     | ❌ No    | Always use `pnpm wu:done`                                         | Ensures merge, stamps, docs, cleanup            |
| Work in main after claiming (Worktree mode)         | ❌ No    | Work in `worktrees/<lane>-wu-xxx`                                 | Isolation + WIP=1 enforcement                   |
| Work in main after claiming (Branch-Only/Docs-Only) | ✅ Yes   | Work on lane branch in main checkout                              | Mode-appropriate workflow                       |

---

#### `pnpm wu:block -- --id WU-123 [OPTIONS]`

**What:** Blocks WU due to external dependency, frees lane, optionally removes worktree

**When:** WU stalled for longer than a session due to blocker

**Flags:**

- `--id WU-123` — (Required) WU ID to block
- `--reason "<text>"` — Reason for blocking (logged in WU notes)
- `--worktree <path>` — Override worktree path to remove
- `--remove-worktree` — Remove worktree immediately (⚠️ push commits first!)
- `--no-auto` — Skip auto-updating YAML/backlog/status (you staged manually)
- `--help, -h` — Show help

**Example:**

```bash
pnpm wu:block -- --id WU-334 --reason "Waiting on API access approval"
```

**With worktree removal (ensure commits pushed first):**

```bash
cd worktrees/experience-wu-334
git push origin lane/experience/wu-334  # CRITICAL: Push first!
cd ../..
pnpm wu:block -- --id WU-334 --reason "Blocked on design review" --remove-worktree
```

---

#### `pnpm wu:unblock -- --id WU-123 [OPTIONS]`

**What:** Unblocks WU, returns to in_progress, optionally recreates worktree

**When:** Blocker cleared, ready to resume work

**Flags:**

- `--id WU-123` — (Required) WU ID to unblock
- `--reason "<text>"` — Reason for unblocking (logged in WU notes)
- `--create-worktree` — Create fresh worktree/branch after unblocking
- `--worktree <path>` — Override worktree path (default: `worktrees/<lane>-<wu-id>`)
- `--branch <name>` — Override branch name (default: `lane/<lane>/<wu-id>`)
- `--no-auto` — Skip auto-updating YAML/backlog/status (you staged manually)
- `--force` — Override lane WIP=1 enforcement (P0 emergencies only)
- `--help, -h` — Show help

**Example:**

```bash
pnpm wu:unblock -- --id WU-334 --reason "API access granted" --create-worktree
cd worktrees/experience-wu-334  # Resume work in fresh worktree
```

---

### 10.2 Quality & Formatting Commands

#### `pnpm gates [-- --docs-only]`

**What:** Runs all quality gates (format check, lint, typecheck, spec-linter, tests)

**When:** Before marking WU done, continuously during development

**Flags:**

- `--docs-only` — Skip lint/typecheck/tests (only run format check + spec-linter for documentation WUs)

**Example:**

```bash
pnpm gates  # Full gates (code WUs)
pnpm gates -- --docs-only  # Docs-only gates (skips app tests)
```

#### Instruction Checkpoints (Start & End of WU)

To keep the LumenFlow Constraints Capsule “live” during long WUs, agents should
use two lightweight checkpoints:

- **Start-of-WU checkpoint (before first plan):**
  - Restate the Constraints Capsule in your own words.
  - Call out which rules are most relevant to this WU (for example, docs-only
    vs code, zero-fallback LLM, skip-gates policy).
  - Mention how you will respect docs-only vs full gates for this WU.

- **End-of-WU audit (before `pnpm wu:done`):**
  - Confirm WU type (`documentation` vs code) and which gates actually ran
    (`pnpm gates` vs `pnpm gates -- --docs-only`).
  - State how you upheld worktree discipline and destructive-git rules.
  - State how you kept inference LLM-first with zero-fallback (no new regex /
    keyword heuristics).
  - Confirm you stayed within the WU’s declared paths and updated WU YAML
    (`status`, `notes`, `code_paths` / `constraints`) before completion.

These checkpoints are intentionally brief but give agents fixed moments to
re-surface global rules where drift is most likely (initial plan and final
completion).

---

#### `pnpm format:check`

**What:** Checks Prettier formatting without making changes

**When:** CI, pre-commit, verifying format compliance

**Example:**

```bash
pnpm format:check
```

---

#### `pnpm format` (or `pnpm format:fix`)

**What:** Applies Prettier formatting to all files

**When:** Fixing formatting issues before commit

**Example:**

```bash
pnpm format  # Auto-fixes formatting
```

---

#### Automatic Formatting (Pre-Commit Hook)

**What:** Pre-commit hooks automatically format staged files before validation

**When:** Every commit (automatic, no manual action needed)

**Coverage:** `.ts, .tsx, .js, .jsx, .mjs, .json, .md, .yml, .yaml` files

**How it works:**

1. You stage files: `git add apps/web/src/feature.ts`
2. You commit: `git commit -m "..."`
3. Pre-commit hook automatically runs `prettier --write` on staged files
4. Files are re-staged with formatting applied
5. Gates validate the formatted code

**When manual formatting is still needed:**

- Files created but not yet staged (stage them first)
- Bulk formatting across entire codebase (use `pnpm format`)
- Unstaged changes that need formatting (stage them or run `pnpm format`)

**Common mistake:** Creating files with Write tool but not staging them before committing other files. The auto-format only applies to STAGED files.

**Example workflow:**

```bash
# Create new files
# Write tool creates apps/web/src/new.ts

# Stage them immediately
git add apps/web/src/new.ts

# Commit (auto-format will apply)
git commit -m "feat: add new feature"
```

---

### 10.3 Hygiene & Maintenance Commands

#### `pnpm wu:prune [--execute]`

**What:** Validates worktree hygiene, detects orphaned/stale worktrees

**When:** Weekly maintenance, before claiming new WUs

**Flags:**

- `--execute` — Actually run `git worktree prune` (default: dry-run mode)

**Example:**

```bash
pnpm wu:prune  # Dry-run: shows issues without changes
pnpm wu:prune --execute  # Executes: actually prunes worktrees
```

---

#### `pnpm backlog:prune [--execute]`

**What:** Marks stale WUs (60+ days inactive) and archives old WUs (90+ days)

**When:** Weekly maintenance, before quarterly ceremony

**Flags:**

- `--execute` — Apply lifecycle changes to WU YAMLs (default: dry-run mode)

**Example:**

```bash
pnpm backlog:prune  # Dry-run: shows what would be marked stale/archived
pnpm backlog:prune --execute  # Executes: updates WU lifecycle fields
```

---

#### `pnpm flow:report`

**What:** Generates flow metrics report (WU throughput, lead time, cycle time, DORA metrics)

**When:** Weekly flow review, identifying bottlenecks

**Example:**

```bash
pnpm flow:report  # Generates report at reports/flow.md
```

---

### 10.4 Worked Scenarios

#### Scenario A: Standard Worktree Mode (Code WU)

```bash
# 1. Claim WU (creates isolated worktree)
pnpm wu:claim -- --id WU-427 --lane Operations
cd worktrees/operations-wu-427  # CRITICAL: Immediately cd into worktree

# 2. Work inside worktree
vim tools/wu-done.mjs
pnpm gates  # Run gates in worktree
git add tools/
git commit -m "wu(wu-427): add validator logic"
git push origin lane/operations/wu-427

# 3. Complete WU (from main checkout)
cd ../..  # Return to main
pnpm wu:done -- --id WU-427  # Runs gates, merges, stamps, removes worktree
```

---

#### Scenario B: Branch-Only Mode (Codespaces/Docs WU)

**Note:** Branch-Only mode requires WU-510 completion. Use `--branch-only` flag only after WU-510 is done.

```bash
# 1. Claim WU in Branch-Only mode (no worktree created)
pnpm wu:claim -- --id WU-420 --lane Operations --branch-only
# Now on branch lane/operations/wu-420 in main checkout

# 2. Work directly in main checkout (no worktree isolation)
vim ./02-playbook.md
pnpm gates -- --docs-only  # Docs-only gates (if type: documentation)
git add memory-bank/
git commit -m "wu(wu-420): improve playbook"
git push origin lane/operations/wu-420

# 3. Complete WU (no worktree to remove)
pnpm wu:done -- --id WU-420  # Detects Branch-Only mode, runs gates in-place, merges
```

---

#### Scenario C: Docs-Only WU (Fastest Path)

```bash
# 1. Claim docs-only WU (type: documentation in YAML)
pnpm wu:claim -- --id WU-506 --lane Operations --branch-only

# 2. Make documentation changes
vim ./02-playbook.md
git add memory-bank/
git commit -m "wu(wu-506): add command reference"
git push origin lane/operations/wu-506

# 3. Complete (automatically runs docs-only gates)
pnpm wu:done -- --id WU-506
# → Detects type: documentation
# → Runs: pnpm gates -- --docs-only (skips lint/typecheck/tests)
# → Validates paths (fails if code files staged)
# → Merges, stamps, pushes
```

---

### 10.5 Error Handling

**Red gates during wu:done:**

```bash
# Fix issues in worktree, re-run gates
cd worktrees/<lane>-wu-xxx
pnpm format  # Fix formatting
pnpm lint:fix  # Fix lint errors
pnpm gates  # Verify all green
git add -A
git commit -m "wu(wu-xxx): fix gates issues"
git push origin lane/<lane>/wu-xxx

# Return to main and retry
cd ../..
pnpm wu:done -- --id WU-123
```

**DoD validation failure (missing code_paths/notes):**

```bash
# Update WU YAML in worktree
cd worktrees/<lane>-wu-xxx
vim {PROJECT_ROOT}/tasks/wu/WU-123.yaml  # Add code_paths, test_paths, notes
git add memory-bank/
git commit -m "wu(wu-xxx): update WU YAML metadata"
git push origin lane/<lane>/wu-xxx

cd ../..
pnpm wu:done -- --id WU-123  # Retry with updated YAML
```

**CI block (pre-commit hooks fail):**

```bash
# Hooks enforce worktree discipline and format/lint rules
# NEVER use --no-verify to bypass hooks
# Fix the underlying issue instead:

# Example: "WU commit attempted from main checkout"
# → Solution: cd into worktree, work there
cd worktrees/<lane>-wu-xxx
# Make your changes here, not in main

# Example: "Formatting violations detected"
# → Solution: Run format command
pnpm format
git add -A
git commit -m "wu(wu-xxx): fix formatting"
```

---

## 11. Extending LumenFlow

1. Propose the change in the backlog (`Discovery` lane).
2. Capture rationale and experiment results in the playbook.
3. Update the manifesto only when a principle changes.
4. Version the framework (e.g., `LumenFlow 1.1`) and tag docs.
5. Share the update publicly so other teams can adopt or comment.

LumenFlow thrives on maintained clarity. Keep states explicit, lanes lean, and documentation bright enough that collaborators—human or AI—can move together without friction.

---

## 12. Troubleshooting

### State Repairs (Canonical) {#state-repairs}

> **Single source of truth: stamp + git is canonical. YAML/docs must match the stamp.**
>
> **Preferred fix: `pnpm wu:repair --id WU-123`** — detects and auto-repairs common consistency issues.

**Automated repair (preferred):**

```bash
# Check for consistency issues (dry-run)
pnpm wu:repair --id WU-123 --check

# Auto-repair detected issues
pnpm wu:repair --id WU-123
```

The `wu:repair` command detects and fixes these consistency types:

| Type                         | Description                                     | Auto-repair                                                   |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| `STAMP_EXISTS_YAML_NOT_DONE` | Stamp file exists but YAML status is not `done` | Updates YAML to `done`, `locked: true`, adds `completed` date |
| `YAML_DONE_NO_STAMP`         | YAML says `done` but stamp file missing         | Creates stamp file                                            |
| `CLAIM_METADATA_INVALID`     | WU claimed but metadata inconsistent            | Repairs via `--claim` flag                                    |
| `BACKLOG_STATUS_MISMATCH`    | YAML status differs from backlog.md/status.md   | Updates docs to match YAML                                    |
| `ORPHANED_WORKTREE`          | Worktree exists for done/blocked WU             | Reports for manual cleanup                                    |

**Manual recipe (fallback when wu:repair fails):**

1. Determine issue: stamp missing? YAML wrong? Both?
2. If stamp exists, stage it in THIS commit, then fix YAML
3. If stamp missing, create stamp + stage with YAML/docs
4. Run `node tools/validate.mjs` to verify consistency
5. Commit with lowercase subject: `chore(repair): synchronise stamps and wu docs`
6. Push to main

---

**Scenario A: Stamp exists, YAML not done (STAMP_EXISTS_YAML_NOT_DONE)**

**Preferred:** Run `pnpm wu:repair --id WU-123` to auto-fix.

**Manual (if wu:repair fails):**

1. Stage stamp in THIS commit:
   ```bash
   printf "WU WU-<ID> — <title>\nCompleted: <YYYY-MM-DD>\n" > .beacon/stamps/WU-<ID>.done
   git add .beacon/stamps/WU-<ID>.done
   git diff --cached --name-only | grep stamps || echo "Stamp not staged!"
   ```
2. Edit YAML: `status: done`, `locked: true`, `completed: <YYYY-MM-DD>`
3. Update `status.md` and `backlog.md` (remove from In Progress, add to Done)
4. Validate: `node tools/validate.mjs`
5. Commit (lowercase subject): `chore(repair): synchronise stamps and wu docs`
6. Push: `git push origin main`

**Scenario B: YAML says done, but no stamp (YAML_DONE_NO_STAMP)**

**Preferred:** Run `pnpm wu:repair --id WU-123` to auto-fix.

**Manual (if wu:repair fails):**

1. Create stamp (as above), stage it with YAML/docs
2. Validate: `node tools/validate.mjs`
3. Commit (lowercase): `chore(repair): synchronise stamps and wu docs`
4. Push

**Scenario C: Fast-forward merge failed during `wu:done`**

1. `cd worktrees/<lane>-wu-<id> && git rebase main`
2. Resolve conflicts if any, then `git rebase --continue`
3. `cd ../.. && pnpm wu:done --id <ID>`

**Scenario D: Commitlint "subject must be lower-case"**

Use lowercase commit subjects for all commits. Conventional commit format: `<type>(<scope>): <subject>` where `<subject>` is lowercase.

**Scenario E: wu:done failed after committing status:done (catch-22 recovery) [WU-1255]**

When `wu:done` fails after committing `status: done` but before merging to main, manual recovery is needed. The pre-push hook no longer blocks this (WU-1255).

1. **Push the lane branch manually:**

   ```bash
   cd worktrees/<lane>-wu-<id>
   git push origin lane/<lane>/<id>
   ```

2. **Return to main and retry wu:done:**

   ```bash
   cd ../..  # back to main checkout
   pnpm wu:done --id <ID>
   ```

3. **If rollback left partial state, repair manually:**
   - Check git status for uncommitted files
   - Restore from git reflog if needed: `git reflog` then `git reset --hard HEAD@{N}`
   - See Scenario A/B above for stamp/YAML synchronization

**What changed (WU-1255):**

- Pre-push hook no longer validates WU status for lane branches
- Lane branches can be pushed regardless of status (done, blocked, etc.)
- Protection happens at merge-to-main time via `wu:done`

**Scenario F: Rollback failed with per-file errors [WU-1255]**

If `wu:done` rollback reports errors for specific files, manual intervention is needed:

1. **Check rollback output** - Look for lines like:
   `[wu-done] ❌ Failed to restore backlog.md: ENOENT`

2. **Manually restore affected files** from git:

   ```bash
   # Show what files have changes
   git status

   # Restore specific file from HEAD
   git checkout HEAD -- docs/04-operations/tasks/backlog.md

   # Or restore from a specific commit
   git checkout <commit-sha> -- docs/04-operations/tasks/wu/<ID>.yaml
   ```

3. **Verify consistency:**
   ```bash
   node tools/validate.mjs
   ```

**Common Causes:**

- **Manual completion**: Someone marked WU done without running `pnpm wu:done`
- **Interrupted `wu:done`**: Script crashed mid-execution (network failure, etc.)
- **Hook failure**: Pre-commit hook blocked final commit, leaving partial state
- **Manual merge**: Branch merged to main without updating WU metadata

**Prevention:**

- ALWAYS use `pnpm wu:done --id <ID>` for completion (never manually merge)
- If `wu:done` fails, check git status before retrying
- Run `node tools/validate.mjs` regularly to catch drift early

---

## 13. Claude Skills (Optional - Claude Code Only)

**Note**: This section applies **only to Claude Code agents**. Other AI agents (GPT-5, Codex, DeepSeek, etc.) should use the full LumenFlow documentation directly.

### What Are Claude Skills?

Claude Skills are Claude-specific model-invoked capabilities that package organizational knowledge and procedural workflows into progressively-loaded resources. They were announced by Anthropic on October 16, 2025.

**Key characteristics:**

- **Autonomous activation**: Claude decides when to use them based on context (unlike agents which require explicit invocation)
- **Progressive disclosure**: 3-tier loading (metadata → primary content → linked resources)
- **Effectively unbounded**: Skills can include unlimited supporting docs since they're loaded on-demand from filesystem
- **Simple structure**: Directory with `SKILL.md` file containing YAML frontmatter + markdown instructions

### Why Use Skills?

**Problem**: LumenFlow documentation is comprehensive (~1600 lines in lumenflow-complete.md) but loading full docs upfront consumes significant context.

**Solution**: Skills provide **intelligent shortcuts** to existing docs through progressive disclosure:

- Claude loads skill metadata (~200 lines) instead of full docs (~1600 lines)
- Skills reference canonical docs with section numbers
- Additional context loaded only when needed
- Other agents continue using full docs (no vendor lock-in)

**Measured benefit**: 60-80% reduction in upfront context loading for common workflows.

### Available Project Skills

ExampleApp provides these skills in `.claude/skills/`:

**Phase 1 (Pilot - WU-661):**

#### 1. `wu-lifecycle`

**Activates when**: User mentions WU-XXX, wu:claim, wu:done, worktree discipline, or asks about completing work units.

**Provides**:

- Quick reference for claim/block/done workflows
- Decision trees (when to block vs fix-in-place)
- Worktree discipline golden rules
- Absolute path trap prevention (AI agent specific)
- Definition of Done checklist

**References**: lumenflow-complete.md §2.4, §6

#### 2. `beacon-compliance`

**Activates when**: Code touches LLM features, classification, PHI/PII, medical claims, accessibility, or when reviewing WUs.

**Provides**:

- Semantic LLM requirement checklists (no regex classification)
- Source Gate validation (approved medical domains)
- WCAG 2.2 AA accessibility checks
- Safety & privacy STOP-AND-ASK triggers
- Example violation patterns with fixes

**References**: beacon-complete.md §2.6, §9, §10, §11, §23

**Phase 2 Complete (WU-663):**

#### 3. `lumenflow-gates`

**Activates when**: Gate failures occur, user asks about --skip-gates, formatting errors, linting errors, test failures.

**Provides**:

- Quality gates troubleshooting decision trees (format, lint, typecheck, tests)
- Skip-gates workflow (when justified, requires --reason + --fix-wu)
- Common fix patterns for Prettier, ESLint, TypeScript, Vitest
- Gate failure triage (pre-existing vs your change)
- Linked resource: gate-troubleshooting.md with real error examples

**References**: lumenflow-complete.md §6.4 (Validation & Gates)

#### 4. `worktree-discipline`

**Activates when**: wu:claim executed, file operations triggered, user asks about worktrees or absolute paths.

**Provides**:

- Worktree golden rules (MUST cd into worktree, NEVER work in main after claiming)
- Absolute path trap explanation and prevention (AI agent specific)
- Verification pattern (pwd check before file operations)
- Forbidden git commands on main (reset --hard, stash, clean -fd)
- Linked resource: path-trap-examples.md with 10 real incidents (WU-218, WU-427)

**References**: lumenflow-complete.md §2.4, §4.1 (Tool Usage in Worktrees)

#### 5. `tdd-workflow`

**Activates when**: User asks to implement feature, add functionality, create use case, or mentions ports/hexagonal architecture.

**Provides**:

- 5-step AI-TDD workflow (ports → tests → implementation → adapters → coverage)
- Hexagonal architecture boundary enforcement (application NEVER imports infrastructure)
- Dependency injection patterns
- Red-Green-Refactor cycle explanation
- Coverage requirements (≥90% for application code)

**References**: lumenflow-complete.md §5, §4, §2.2 (AI-TDD & Hexagonal Architecture)

**Coverage**: WU lifecycle, product compliance, quality gates, worktree isolation, TDD workflow.

**Context reduction**: 70-80% vs loading full documentation upfront.

### Design Pattern: Reference, Not Duplicate

**Critical**: Skills **reference** canonical docs, they do NOT replace them.

**Bad practice** (creates divergence):

```markdown
# Skill that duplicates 200 lines from lumenflow-complete.md

A WU goes through these states:

- ready → in_progress → done
  [...repeats full spec...]
```

**Good practice** (references source):

```markdown
# Skill that references canonical docs

**Source**: lumenflow-complete.md §2.4 (canonical)

Quick reference: ready → in_progress → done

For full state transition rules, see lumenflow-complete.md §2.4.

[...decision trees and scripts only...]
```

### When Skills Update

**If LumenFlow docs update:**

1. Update canonical doc (lumenflow-complete.md)
2. Check if Skills need version bump
3. Update skill references/links if sections renumbered
4. Keep Skills **thin** (just navigation/automation)
5. Skills inherit correctness from source docs

**Version tracking in skills:**

```yaml
---
name: wu-lifecycle
version: 1.1.0 # Bump when workflow changes
source: lumenflow-complete.md
source_version: 1.1
last_updated: 2025-10-26
---
```

### For Other AI Agents

**GPT-5, Codex, DeepSeek, and other agents**: Ignore this section and use the full documentation:

- `docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md` - Complete LumenFlow specification
- `docs/01-product/beacon/beacon-complete.md` - Complete Beacon specification
- `CLAUDE.md` - Agent onboarding

Skills are a Claude Code performance optimization, not a requirement. All canonical information remains in the full docs.

### Multi-Agent Compatibility

**Strategy**: Skills enhance Claude, docs remain authoritative for all agents.

| Scenario                     | GPT-5/Codex/Other                         | Claude Code (with Skills)                                       |
| ---------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| Complete WU-123              | Reads lumenflow-complete.md (~1600 lines) | Loads wu-lifecycle skill (~200 lines) + references §6 if needed |
| Review for Beacon compliance | Reads beacon-complete.md (~2500 lines)    | Loads beacon-compliance skill (~300 lines) + checklist          |
| Troubleshoot gate failure    | Searches lumenflow-complete.md + playbook | wu-lifecycle skill auto-activates → decision tree               |
| Context token usage          | ~5000 tokens upfront                      | ~800 tokens upfront (6x reduction)                              |

**Both approaches work** - Skills just make Claude more efficient.

### Adding New Skills

**Phase 3 Candidates** (future skills to consider):

- `healthcare-compliance` - WCAG/PHI/DTAC checklists
- `prompt-evaluation` - Prompt engineering toolkit
- `incident-response` - P0 emergency workflows
- `cos-governance` - Company Operating System rules & enforcement

Follow the "reference, not duplicate" pattern when creating new skills.

**Skill lifecycle**:

1. Identify high-frequency workflow or complex decision tree
2. Create `.claude/skills/<name>/SKILL.md` with YAML frontmatter
3. Reference canonical docs (lumenflow-complete.md, beacon-complete.md) with section numbers
4. Add linked resources for detailed examples (optional)
5. Test activation with relevant keywords
6. Document in playbook §13 (this section)

**Quality checklist**:

- [ ] YAML frontmatter valid (name, description, version, source, source_sections)
- [ ] References canonical docs (doesn't duplicate content)
- [ ] Activation keywords comprehensive (fuzzy matching)
- [ ] Progressive disclosure working (metadata → content → linked resources)
- [ ] Context reduction measured (target: 70-80%)

---

**That's LumenFlow.** Use it to deliver meaningful outcomes, ship safely, and keep team collaboration smooth. May your lanes always flow and your context windows never overflow.
