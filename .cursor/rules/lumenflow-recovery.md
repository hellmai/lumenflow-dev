# LumenFlow Context Recovery

## On Session Start

When starting a new session or resuming work, always check for pending recovery context:

```bash
# Check for recovery files
ls .lumenflow/state/recovery-pending-*.md 2>/dev/null
```

If recovery files exist:

1. Read the recovery file contents — they contain your last checkpoint, acceptance criteria, and code paths
2. Run `pnpm mem:recover --wu WU-XXX` (replace WU-XXX with the WU ID from the filename) for the latest context
3. Continue working based on the recovery context

## Context Loss Prevention

Before any long operation that might lose context:

```bash
pnpm mem:checkpoint "description of current progress" --wu WU-XXX
```

## Recovery Command Reference

| Command                                     | Purpose                            |
| ------------------------------------------- | ---------------------------------- |
| `pnpm mem:recover --wu WU-XXX`              | Generate recovery context for a WU |
| `pnpm wu:brief --id WU-XXX --client cursor` | Generate full handoff prompt       |
| `pnpm wu:status --id WU-XXX`                | Check WU status and location       |
| `pnpm mem:checkpoint`                       | Save progress checkpoint           |
