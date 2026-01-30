---
id: effort-scaling
name: Effort Scaling
required: true
order: 100
tokens: []
---

## Effort Scaling (When to Spawn Sub-Agents)

Use this heuristic to decide complexity:

| Complexity                                 | Approach                     | Tool Calls |
| ------------------------------------------ | ---------------------------- | ---------- |
| **Simple** (single file, <50 lines)        | Handle inline                | 3-10       |
| **Moderate** (2-3 files, clear scope)      | Handle inline                | 10-20      |
| **Complex** (4+ files, exploration needed) | Spawn Explore agent first    | 20+        |
| **Multi-domain** (cross-cutting concerns)  | Spawn specialized sub-agents | Varies     |

**Rule**: If you need >30 tool calls for a subtask, consider spawning a sub-agent with a focused scope.
