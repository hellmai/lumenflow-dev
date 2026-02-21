# INIT-033 Plan - Workspace-first hard cut + bootstrap-all + cloud connect

## Goal

Deliver a hard cut to `workspace.yaml` as the canonical runtime configuration,
make `npx lumenflow` perform bootstrap-all by default, and ship first-class
cloud control-plane connection with secure defaults.

## Scope

In scope:

- Workspace schema v2 and canonical config resolution
- `config:set` / `config:get` repointed to `workspace.yaml`
- Legacy `.lumenflow.config.yaml` runtime hard cut plus migration tooling
- Wrapper unification and bootstrap-all default path
- Cloud connect CLI, runtime sync, web diagnostics, MCP parity
- Docs/release readiness for `v4.0.0`

Out of scope:

- Secure custom tool authoring (deferred to follow-up initiative)
- Backward compatibility for legacy split onboarding flows

## Approach

Execution sequence:

1. Workspace Unification:
   `A -> B -> C -> D -> E -> F -> G`
2. Bootstrap-All CLI:
   `E -> H -> I -> J`
3. Cloud Connect:
   `B -> K -> L -> M -> N`
4. Final Release:
   `J + N + G -> O`

Critical guardrails:

- Lane preflight before first WU creation:
  `lane:status` first, then `lane:setup/lane:validate/lane:lock` only if needed.
- Require clean `git status` before initiative/WU mutation commands.
- Do not use `lane:* --help` as a safe probe. Some lane commands execute
  lifecycle writes and can rewrite `.lumenflow.config.yaml`.

## Success Criteria

- Single-command bootstrap for new users succeeds in a fresh repository
- No runtime dependency remains on `.lumenflow.config.yaml`
- Cloud-connected workspace flow is functional with actionable diagnostics
- Documentation and release assets reflect major bump `v4.0.0`

## Risks

- Risk: lane command side effects dirty config unexpectedly
  Mitigation: enforce preflight protocol and clean-tree checks before mutations.
- Risk: state doctor mismatch debt (`WU-1552`, `WU-1553`) blocks strict health
  gate
  Mitigation: documented caveat and explicit follow-up repair path.
- Risk: dependency bottlenecks delay downstream waves
  Mitigation: prioritize bottleneck WUs from orchestration dry-run output.

## References

- Initiative: INIT-033
- Created: 2026-02-21
