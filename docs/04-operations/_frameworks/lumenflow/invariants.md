# Invariants System

**Introduced:** WU-2252
**Purpose:** Durable "never again" rules enforced at gates and wu:done

---

## Overview

Invariants are repo-level constraints that must always hold true. They capture post-incident learnings as machine-enforced rules that prevent regressions.

**Philosophy:** "Fix must produce a constraint" - when a bug is fixed, the invariant system ensures it cannot recur.

---

## How It Works

### Registry

`tools/invariants.yml` is the repo-level "must always be true" registry:

```yaml
invariants:
  - id: INV-EXAMPLE
    type: forbidden-file
    path: apps/web/src/deprecated.ts
    description: This file was removed due to conflicts
    message: |
      Do not recreate this file.
      See the linked WU for context.
```

### Runner

`tools/lib/invariants-runner.mjs` loads and evaluates those rules against the filesystem.

### Enforcement

- **Gates:** `tools/gates.mjs` runs invariants **first** (before lint/type/test) so regressions fail fast
- **Non-bypassable:** `tools/wu-done.mjs` runs invariants even when `--skip-gates` is used
- **Prompt surfacing:** `wu:brief` injects relevant invariants into agent prompts when the WU's `code_paths` match them

---

## When to Add an Invariant

Add invariants only for "never again" failures that meet ALL criteria:

1. **High impact:** The bug caused significant problems (production outage, data corruption, broken builds)
2. **Low false-positive:** The check rarely fails incorrectly
3. **Cheap to check:** Validation runs fast (file existence, pattern matching)

**Rule of thumb:** If fixing a bug, ask "What constraint would have prevented this?"

### Good Candidates

- File conflicts that break builds
- Architecture boundary violations
- Forbidden patterns that indicate security issues
- Mutual exclusivity constraints (only one of N files should exist)

### Bad Candidates

- Complex logic validations (use tests instead)
- Style preferences (use linting instead)
- Performance constraints (use benchmarks instead)

---

## Supported Rule Types

### required-file

File must exist in the repository.

```yaml
- id: INV-README
  type: required-file
  path: README.md
  description: Project must have a README
  message: Create README.md at the project root
```

### forbidden-file

File must NOT exist in the repository.

```yaml
- id: INV-NO-ENV-LOCAL
  type: forbidden-file
  path: .env.local
  description: Local env files must not be committed
  message: Remove .env.local from git tracking
```

### mutual-exclusivity

Only one of the listed files may exist. Useful for preventing conflicting configurations.

```yaml
- id: INV-NEXTJS-MIDDLEWARE-PROXY
  type: mutual-exclusivity
  paths:
    - apps/web/src/middleware.ts
    - apps/web/src/proxy.ts
  description: Next.js 16 middleware and proxy.ts cannot coexist
  message: |
    Next.js 16 startup fails when both files exist.
    Delete the redundant one.
```

### forbidden-pattern

A regex pattern must not appear in files matching the scope glob.

```yaml
- id: INV-NO-CONSOLE-LOG
  type: forbidden-pattern
  pattern: 'console\.log\('
  scope:
    - 'packages/@exampleapp/application/src/**/*.ts'
  description: No console.log in application layer
  message: Use ObservabilityService.log() instead of console.log()
```

---

## Planned Rule Types (WU-2254)

These are under consideration for future implementation:

### required-pattern

Pattern must appear in scoped files. Useful for enforcing security annotations.

```yaml
- id: INV-RLS-ENABLED
  type: required-pattern
  pattern: 'RLS enabled'
  scope:
    - 'supabase/migrations/*.sql'
  description: All migrations must enable RLS
```

### forbidden-import

Block specific imports in specific packages. Useful for architecture enforcement.

```yaml
- id: INV-NO-INFRA-IN-APP
  type: forbidden-import
  import: '@exampleapp/infrastructure'
  scope:
    - 'packages/@exampleapp/application/**/*.ts'
  description: Application layer cannot import infrastructure
```

---

## Good Next Invariants to Add

These patterns would benefit from invariant protection:

1. **Architecture boundaries (hexagonal):**
   - Forbid `packages/@exampleapp/application/**` importing `@exampleapp/infrastructure`

2. **Direct vendor clients in wrong layer:**
   - Forbid `packages/@exampleapp/application/**` importing `@supabase/supabase-js`

3. **Secrets hygiene:**
   - `forbidden-pattern` for obvious key formats (`sk-`, `pk_live_`, `AKIA`, etc.)

4. **Database safety posture:**
   - `required-pattern` for "RLS enabled" comment in migrations

---

## How to Test Locally

### Run Invariants Directly

```bash
pnpm invariants:check
```

This runs only the invariants validation, useful for quick feedback.

### Run Full Gates

```bash
pnpm gates
```

Invariants run as the first gate. If they fail, subsequent gates are skipped.

### Test a New Invariant

1. Add the invariant to `tools/invariants.yml`
2. Run `pnpm invariants:check` to verify it catches the violation
3. Fix the violation or remove it for testing
4. Run `pnpm gates` to confirm the full pipeline passes

---

## Relation to WU Specs

### wu:brief Context Injection

When generating handoff prompts via `pnpm wu:brief --id WU-XXX --client <client>`, the system:

1. Loads `tools/invariants.yml`
2. Matches invariants against the WU's `code_paths`
3. Injects a "## Invariants/Prior-Art" section into the agent prompt

This ensures agents are aware of constraints before they start work.

### Spec Validation

The `wu:done` process validates that completed work does not violate any invariants, even when `--skip-gates` is used. This makes invariants truly non-bypassable.

---

## Adding a New Invariant

1. Identify the constraint from the incident/bug
2. Choose the appropriate rule type
3. Add to `tools/invariants.yml`:

```yaml
invariants:
  # [existing invariants]

  # Brief description of why this invariant exists (link to WU in commit)
  - id: INV-DESCRIPTIVE-NAME
    type: [rule-type]
    path: # or paths:, pattern:, scope: depending on type
    description: >
      Human-readable explanation of what this enforces and why.
    message: |
      Actionable guidance for fixing the violation.
      Include commands or file changes needed.
```

4. Test with `pnpm invariants:check`
5. Commit as part of the fix WU

---

## Troubleshooting

### "Invariants file not found"

The `tools/invariants.yml` file is missing. This is valid if no invariants are defined yet - the runner will skip gracefully.

### "Unknown invariant type"

A rule in `invariants.yml` uses an unsupported type. Check the supported types above.

### False Positive

If an invariant is triggering incorrectly:

1. Check if the scope/path patterns are too broad
2. Consider if the constraint is still valid
3. Update the invariant definition or remove if no longer needed

### Performance Issues

The runner excludes common directories (`node_modules/`, `worktrees/`, `.next/`, `dist/`, `.git/`) from scanning. If performance is still an issue:

1. Narrow the `scope` patterns for `forbidden-pattern` rules
2. Use file-based checks (`required-file`, `forbidden-file`) where possible

---

## References

- **Registry:** [tools/invariants.yml](../../../../tools/invariants.yml)
- **Runner:** [tools/lib/invariants-runner.mjs](../../../../tools/lib/invariants-runner.mjs)
- **Gates integration:** [tools/gates.mjs](../../../../tools/gates.mjs)
- **Prompt integration:** [`packages/@lumenflow/cli/src/wu-spawn.ts`](../../../../packages/@lumenflow/cli/src/wu-spawn.ts)
- **Introduced by:** WU-2252
