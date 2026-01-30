---
id: token-budget
name: Token Budget Awareness
required: true
order: 130
tokens: [WU_ID]
---

## Token Budget Awareness

Context limit is ~200K tokens. Monitor your usage:

- **At 50+ tool calls**: Create a checkpoint (`pnpm mem:checkpoint --wu {WU_ID}`)
- **At 100+ tool calls**: Consider spawning fresh sub-agent with focused scope
- **Before risky operations**: Always checkpoint first

If approaching limits, summarize progress and spawn continuation agent.
