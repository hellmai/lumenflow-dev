# INIT-031 Plan - UX Surfaces — Web Dashboard, Pack DX, AG-UI, Marketplace

Created: 2026-02-18

## Goal

Make LumenFlow visible and exciting. Build user-facing surfaces on top of the kernel runtime (INIT-029) and runtime adoption (INIT-030) so two personas can interact with LumenFlow: (1) software devs using the software delivery pack who want to watch agents work and trust the automation, (2) pack authors and consumers who want to teach their AI new domains by adding packs. Capture displaced OpenClaw community with governance-first alternative.

## Scope

In scope: HTTP surface in surfaces package, Next.js web app (apps/web/), AG-UI protocol adapter, EventStore subscribe mechanism, pack CLI commands (scaffold/validate/hash/install/publish/search), git and registry pack resolution in PackLoader, pack authoring documentation, pack marketplace web page, CopilotKit integration example, GenUI tool renderers, policy decision overlay, human-in-the-loop approval UI, control plane event forwarding, community landing page. Out of scope: mobile apps, voice integration, non-MCP agent runtimes, changes to kernel runtime API.

## Approach

Phase 1 (Weeks 1-3): Watch Your Agent Think. Add EventStore.subscribe() reactive primitive, create HTTP surface in surfaces package (SSE + REST), build AG-UI event adapter, scaffold Next.js web app in apps/web/, build live task dashboard and workspace overview. Critical path: WU-1816 then WU-1817 then WU-1819 then WU-1820. Phase 2 (Weeks 4-6): Pack Developer Experience. CLI commands pack:scaffold, pack:validate, pack:hash, pack:install wrapping existing kernel PackLoader functions. Extend PackLoader for git-based resolution. Pack authoring guide. Pack catalog in web dashboard. Phase 3 (Weeks 7-9): AG-UI Integration and GenUI. AG-UI RunAgent endpoint, state synchronization, CopilotKit example, GenUI tool output renderers, policy decision overlay, human-in-the-loop approval UI. Phase 4 (Weeks 10-12): Pack Marketplace and Community. Registry API on Vercel Edge Functions, registry resolution in PackLoader, pack:publish and pack:search CLI, marketplace page, control plane event forwarding, community landing page.

## Success Criteria

Web dashboard renders live task events within 2s of EventStore append. AG-UI RunAgent endpoint passes CopilotKit compatibility test. Pack scaffold-to-running-tool achievable in under 10 minutes. Registry serves at least 5 community packs by end of Phase 4. Demo video shared publicly generates measurable interest.

## Risks

EventStore performance under tailing: current replay() re-reads entire file. Mitigation: subscribe uses fs.watch() plus seek-to-last-offset, parsing only new lines. Next.js in monorepo: adding Next.js to Turborepo workspace can cause build ordering issues. Mitigation: standard turbo dependency graph with surfaces package as dependency. AG-UI protocol stability: AG-UI is relatively new. Mitigation: adapter is a separate module that can be updated independently. Pack registry security: published packs run as subprocess tools. Mitigation: existing sandbox (bwrap) and import boundary enforcement already handle this.

## Open Questions

<!-- Unresolved questions or decisions needed -->

## References

Initiative: INIT-031 (docs/04-operations/tasks/initiatives/INIT-031.yaml). Depends on: INIT-029 (kernel runtime, done), INIT-030 (runtime adoption, completing). 27 WUs: WU-1816 through WU-1842. Detailed plan: .claude/plans/zazzy-growing-cook.md. Key files: packages/@lumenflow/kernel/src/event-store/index.ts, packages/@lumenflow/surfaces/, packages/@lumenflow/kernel/src/pack/pack-loader.ts, packages/@lumenflow/kernel/src/runtime/kernel-runtime.ts. External references: AG-UI Protocol (docs.ag-ui.com), CopilotKit (copilotkit.ai), Cyera OpenClaw security research.
