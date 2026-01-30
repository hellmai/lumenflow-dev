---
id: lane-selection
name: Lane Selection
required: true
order: 220
tokens: []
---

## Lane Selection

When creating new WUs, use the correct lane to enable parallelization:

```bash
# Get lane suggestion based on code paths and description
pnpm wu:infer-lane --id WU-XXX

# Or infer from manual inputs
pnpm wu:infer-lane --paths "tools/**" --desc "CLI improvements"
```

**Lane taxonomy**: See `.lumenflow.lane-inference.yaml` for valid lanes and patterns.

**Why lanes matter**: WIP=1 per lane means correct lane selection enables parallel work across lanes.
