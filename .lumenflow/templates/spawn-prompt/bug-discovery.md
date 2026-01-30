---
id: bug-discovery
name: Bug Discovery
required: true
order: 200
tokens: [WU_ID]
---

## Bug Discovery (Mid-WU Issue Capture)

If you discover a bug or issue **outside the scope of this WU**:

1. **Capture it immediately** using:

   ```bash
   pnpm mem:create 'Bug: <description>' --type discovery --tags bug,scope-creep --wu {WU_ID}
   ```

2. **Continue with your WU** - do not fix bugs outside your scope
3. **Reference in notes** - mention the mem node ID in your completion notes

### NEVER use wu:create for discovered issues

**Do NOT use `wu:create` directly for bugs discovered mid-WU.**

- `mem:create` = **capture** (immediate, no human approval needed)
- `wu:create` = **planned work** (requires human triage and approval)

Discovered issues MUST go through human triage before becoming WUs.
Using `wu:create` directly bypasses the triage workflow and creates
unreviewed work items.

### When to Capture

- Found a bug in code NOT in your `code_paths`
- Discovered an issue that would require >10 lines to fix
- Encountered broken behaviour unrelated to your acceptance criteria

### Triage Workflow

After WU completion, bugs can be promoted to Bug WUs by humans:

```bash
pnpm mem:triage --wu {WU_ID}           # List discoveries for this WU
pnpm mem:triage --promote <node-id> --lane "<lane>"  # Create Bug WU (human action)
```

See: https://lumenflow.dev/reference/agent-invocation-guide/ - Bug Discovery
