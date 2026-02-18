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

<!-- What could go wrong? How will you mitigate? -->

## Open Questions

<!-- Unresolved questions or decisions needed -->

## References

- ID: INIT-031
- Created: 2026-02-18
