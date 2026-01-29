# AI Agent Vendor Support Matrix

**Last updated:** 2026-01-29

This document describes LumenFlow's support for various AI coding assistants.

---

## Supported Vendors

| Vendor      | Config File                    | Auto-detected | Status         |
| ----------- | ------------------------------ | ------------- | -------------- |
| Claude Code | `CLAUDE.md`, `.claude/`        | Yes           | Full Support   |
| Cursor      | `.cursor/rules/lumenflow.md`   | Yes           | Full Support   |
| Windsurf    | `.windsurf/rules/lumenflow.md` | Yes           | Full Support   |
| Cline       | `.clinerules`                  | No            | Full Support   |
| Codex       | `AGENTS.md`                    | No            | Full Support   |
| Aider       | `.aider.conf.yml`              | No            | Basic Support  |
| Antigravity | `AGENTS.md` (native)           | Unknown       | Research Phase |

---

## Vendor Details

### Claude Code (Anthropic)

Claude Code is Anthropic's official CLI for Claude. It has deep integration with LumenFlow.

**Config Files:**

- `CLAUDE.md` - Root-level instructions
- `.claude/settings.json` - Permission configuration
- `.claude/agents/` - Agent definitions
- `.claude/skills/` - Skill definitions

**Auto-detection:** Environment variables `CLAUDE_PROJECT_DIR` or `CLAUDE_CODE`

**Initialize:**

```bash
lumenflow init --client claude
```

### Cursor

Cursor is an AI-first code editor built on VS Code.

**Config Files:**

- `.cursor/rules/lumenflow.md` - LumenFlow rules

**Auto-detection:** Environment variables starting with `CURSOR_`

**Initialize:**

```bash
lumenflow init --client cursor
```

### Windsurf

Windsurf (Codeium) is an AI IDE with agentic capabilities.

**Config Files:**

- `.windsurf/rules/lumenflow.md` - LumenFlow rules

**Auto-detection:** Environment variables starting with `WINDSURF_`

**Initialize:**

```bash
lumenflow init --client windsurf
```

### Cline

Cline is an autonomous coding agent that works in VS Code.

**Config Files:**

- `.clinerules` - LumenFlow rules (root-level)

**Auto-detection:** Not supported

**Initialize:**

```bash
lumenflow init --client cline
```

### OpenAI Codex

Codex reads the AGENTS.md file directly for universal instructions.

**Config Files:**

- `AGENTS.md` - Universal agent instructions (always created)

**Initialize:**

```bash
lumenflow init  # AGENTS.md is created by default
```

### Aider

Aider is a terminal-based pair programming tool.

**Config Files:**

- `.aider.conf.yml` - Aider configuration

**Initialize:**

```bash
lumenflow init --client aider
```

---

## Antigravity (Research Phase)

**Status:** Research Phase

Antigravity is Google's AI IDE, announced in November 2025. It is MCP-based and appears to read `AGENTS.md` natively.

### What We Know

- **Announced:** November 2025
- **Platform:** Google's AI IDE
- **Protocol:** MCP (Model Context Protocol)
- **Agent Config:** Appears to read `AGENTS.md` natively (similar to Codex)

### Research Links

- [Google Codelabs - Getting Started with Antigravity](https://codelabs.developers.google.com/getting-started-google-antigravity)
- Google AI documentation (when available)

### Current Recommendation

For projects using Antigravity:

1. Ensure `AGENTS.md` is present (created by default with `lumenflow init`)
2. The universal instructions in AGENTS.md should work out of the box
3. Report any issues for future vendor-specific support

### Planned Investigation

- [ ] Confirm AGENTS.md parsing behavior
- [ ] Test workflow command execution
- [ ] Investigate MCP tool integration
- [ ] Determine if vendor-specific config is needed

---

## All Vendors Setup

To configure all supported vendors at once:

```bash
lumenflow init --client all
```

This creates all vendor-specific configuration files.

---

## Sync Vendor Configs

To ensure all vendor configs are in sync with the template:

```bash
# Check if configs are in sync
./scripts/sync-vendor-configs.sh --check

# Regenerate all configs from template
./scripts/sync-vendor-configs.sh
```

---

## Adding New Vendors

To add support for a new AI coding assistant:

1. Update `templates/vendor-rules.template.md` (single source of truth)
2. Add vendor config path to `scripts/sync-vendor-configs.sh`
3. Add scaffolding in `packages/@lumenflow/cli/src/init.ts`
4. Update this vendor support matrix
5. Test with `lumenflow init --client <vendor>`
