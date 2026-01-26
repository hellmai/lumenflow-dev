# LumenFlow Agent Capsule (Token‑Optimised)

This capsule is the **agent-facing** summary of LumenFlow for day-to-day work in Claude Code.
It is designed to be loaded into context quickly without triggering “prompt too long”.

For the full framework (rationale, extended examples, ceremonies), see:
`docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md`.

---

## 1) The Non‑Negotiables (keep these active)

1. **Worktree discipline**: after `pnpm wu:claim`, all work happens in `worktrees/<lane>-wu-<id>/`. Treat the main checkout as read‑only for that WU.
2. **Never bypass hooks**: do not use `--no-verify` or `--no-gpg-sign`. Fix the underlying problem and retry.
3. **WIP = 1 per lane**: only one `in_progress` WU per lane at a time.
4. **WUs are specs, not code**: WU YAML is a contract; do not add code blocks to WU files. Stay within `code_paths` / `spec_refs`.
5. **Always complete via `pnpm wu:done`**: no manual merges/stamps; let the tooling run gates, merge, stamp, and cleanup.
6. **Run the right gates**:
   - Code WUs: `pnpm gates`
   - Docs-only WUs: `pnpm gates -- --docs-only`

If you forget anything, load `.lumenflow/constraints.md` and restate the six constraints before continuing.

---

## 2) Minimal Context Loading (recommended default)

For most work, load only:

1. `CLAUDE-core.md` (core workflow + safety)
2. `README.md` (repo structure / commands)
3. The WU YAML: `docs/04-operations/tasks/wu/WU-<id>.yaml`

Only load the full LumenFlow doc when:

- You are changing workflow/tooling, or
- You are debugging lifecycle edge cases, gates, hooks, or state stores.

---

## 3) WU Lifecycle (the only supported path)

### Claim

```bash
pnpm wu:claim --id WU-XXX --lane "<lane>"
cd worktrees/<lane>-wu-xxx
```

### Work (inside the worktree)

```bash
pnpm gates
git push origin lane/<lane>/wu-xxx
```

### Complete

```bash
cd ../..  # back to main checkout
pnpm wu:done --id WU-XXX
```

### Block / Unblock

```bash
pnpm wu:block --id WU-XXX --reason "blocked by <thing>"
pnpm wu:unblock --id WU-XXX
```

---

## 4) Token Discipline (avoid “prompt too long”)

Claude Code can fail after noisy commands if their full output accumulates in the session.

- Prefer redirecting noisy output to `.logs/` and inspect locally (don’t paste logs into chat).
- Use `/clear` when context feels bloated, then resume via `pnpm mem:ready --wu WU-XXX`.
- For long sessions, checkpoint and summarise:
  - `pnpm mem:checkpoint "…" --wu WU-XXX`
  - `pnpm mem:summarize --wu WU-XXX`

---

## 5) When you find something out of scope

If you discover a bug or improvement outside the WU’s declared paths, capture it instead of fixing inline:

```bash
pnpm mem:create "Bug: <description>" --type bug
```

Triage later with `pnpm mem:triage --wu WU-XXX`.
