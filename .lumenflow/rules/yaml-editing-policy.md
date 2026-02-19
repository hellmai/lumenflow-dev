# YAML Editing Policy

**Last updated:** 2026-02-19

This document defines the mandatory policy for modifying YAML configuration files in LumenFlow projects.

---

## Rule

**All YAML configuration files must be modified via CLI tooling only. Never use raw Write or Edit tools.**

This applies to:

- `.lumenflow.config.yaml` (project configuration)
- `docs/04-operations/tasks/wu/*.yaml` (WU specification files)

---

## Safe Commands

### For .lumenflow.config.yaml

| Operation       | Safe Command                                 | Example                                                                          |
| --------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| Read a value    | `pnpm config:get --key <path>`               | `pnpm config:get --key methodology.testing`                                      |
| Set a value     | `pnpm config:set --key <path> --value <val>` | `pnpm config:set --key methodology.testing --value test-after`                   |
| Set a boolean   | `pnpm config:set --key <path> --value <val>` | `pnpm config:set --key gates.enableCoverage --value false`                       |
| Set a number    | `pnpm config:set --key <path> --value <val>` | `pnpm config:set --key gates.minCoverage --value 85`                             |
| Append to array | `pnpm config:set --key <path> --value <val>` | `pnpm config:set --key agents.methodology.principles --value Library-First,KISS` |

### For WU YAML Specs

| Operation      | Safe Command                   | Example                                                         |
| -------------- | ------------------------------ | --------------------------------------------------------------- |
| Create a WU    | `pnpm wu:create ...`           | `pnpm wu:create --lane "Framework: Core" --title "Add feature"` |
| Edit WU fields | `pnpm wu:edit --id WU-XXX ...` | `pnpm wu:edit --id WU-XXX --description "Updated description"`  |
| View WU status | `pnpm wu:status --id WU-XXX`   | `pnpm wu:status --id WU-XXX`                                    |
| Validate WU    | `pnpm wu:validate --id WU-XXX` | `pnpm wu:validate --id WU-XXX`                                  |

---

## Unsafe Alternatives (Never Use)

The following operations are policy violations:

```bash
# WRONG: Raw-editing config
Write(.lumenflow.config.yaml, "...")
Edit(.lumenflow.config.yaml, old, new)

# WRONG: Raw-editing WU YAML
Write(docs/04-operations/tasks/wu/WU-123.yaml, "...")
Edit(docs/04-operations/tasks/wu/WU-123.yaml, old, new)

# WRONG: Using Bash to edit YAML
sed -i 's/old/new/' .lumenflow.config.yaml
echo "key: value" >> .lumenflow.config.yaml
```

**Exception:** Reading YAML files with the Read tool is acceptable for inspection purposes. The restriction applies only to writes.

---

## Why CLI Tooling Is Required

### 1. Schema Validation

`config:set` validates every change against the project's Zod schema before writing. Raw edits can produce configurations that fail validation at runtime, breaking downstream commands like `wu:claim`, `gates`, and `wu:done`.

### 2. Atomic Commits

`config:set` uses the micro-worktree pattern (WU-1262) to commit changes atomically to `origin/main`. This prevents:

- Uncommitted config changes floating in the working tree
- Merge conflicts with other agents modifying config simultaneously
- Partial writes from interrupted operations

### 3. Audit Trail

CLI commands produce structured log entries that are tracked in the event store. Raw edits are invisible to the audit system and cannot be attributed to specific agents or operations.

### 4. Type Safety

`config:set` automatically coerces string values to the correct types:

| Input     | Coerced To        |
| --------- | ----------------- |
| `"true"`  | `true` (boolean)  |
| `"false"` | `false` (boolean) |
| `"42"`    | `42` (number)     |
| `"A,B,C"` | array append      |

Raw edits frequently introduce type mismatches (e.g., YAML string `"true"` vs. boolean `true`) that cause subtle runtime failures.

### 5. Conflict Prevention

`config:set` handles concurrent modifications via retry-with-rebase. Raw edits from multiple agents can create conflicting changes that require manual resolution.

---

## Enforcement Status

**Current:** This policy is enforced via Constraint 9 in `.lumenflow/constraints.md` and this rule document. Agents are expected to follow the policy based on onboarding documentation and spawn prompt injection.

**Future:** A dedicated enforcement hook will block raw Write/Edit operations to `.lumenflow.config.yaml` at the tool level, redirecting agents to `config:set` with a clear error message.

---

## References

- [.lumenflow/constraints.md](../constraints.md) -- Constraint 9: YAML files must be modified via CLI tooling only
- [config:set and config:get](../../docs/04-operations/_frameworks/lumenflow/config-set-usage.md) -- Full command documentation
- [Agent Safety Architecture](../../docs/04-operations/_frameworks/lumenflow/agent-safety-architecture.md) -- Protection landscape overview
