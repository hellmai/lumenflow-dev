/**
 * @file generators/auto-checkpoint.ts
 * Generate the auto-checkpoint.sh hook script content (WU-1471).
 *
 * Extracted from enforcement-generator.ts by WU-1645.
 */

/**
 * WU-1471: Generate the auto-checkpoint.sh hook script content.
 *
 * This hook is used by both PostToolUse and SubagentStop events.
 * It branches on the hook_event_name environment variable:
 * - PostToolUse: Increments a per-WU counter and checkpoints at interval
 * - SubagentStop: Always creates a checkpoint (sub-agent finished work)
 *
 * Uses a defensive subshell to background checkpoint writes so the hook
 * returns quickly and does not block the agent.
 *
 * @param intervalToolCalls - Number of tool calls between auto-checkpoints
 * @returns Shell script content
 */
export function generateAutoCheckpointScript(intervalToolCalls: number): string {
  // Note: Shell variable escapes (\$, \") are intentional for the generated bash script
  /* eslint-disable no-useless-escape */
  return `#!/bin/bash
#
# auto-checkpoint.sh (WU-1471)
#
# PostToolUse + SubagentStop hook for automatic checkpointing.
# Branches on hook_event_name to decide behavior:
# - PostToolUse: counter-based checkpoint at interval
# - SubagentStop: always checkpoint (sub-agent completed work)
#
# Checkpoint writes are backgrounded in a defensive subshell
# to avoid blocking the agent.
#
# Exit codes:
#   0 = Always (never blocks tool execution)
#

# Fail-open: any error allows the operation to continue
set +e

INTERVAL=${intervalToolCalls}

# Derive repo paths
if [[ -z "\\\${CLAUDE_PROJECT_DIR:-}" ]]; then
  exit 0
fi

REPO_PATH="\\\$CLAUDE_PROJECT_DIR"
LUMENFLOW_DIR="\\\${REPO_PATH}/.lumenflow"
COUNTERS_DIR="\\\${LUMENFLOW_DIR}/state/hook-counters"

# Check if LumenFlow is configured
if [[ ! -d "\\\$LUMENFLOW_DIR" ]]; then
  exit 0
fi

# Detect WU ID from worktree context
WU_ID=""
CWD=\\\$(pwd 2>/dev/null || echo "")
if [[ "\\\$CWD" == *"/worktrees/"* ]]; then
  # Extract WU ID from worktree path (e.g., worktrees/framework-cli-wu-1471)
  WORKTREE_NAME=\\\$(basename "\\\$CWD")
  WU_ID=\\\$(echo "\\\$WORKTREE_NAME" | grep -oiE 'wu-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]')
fi

if [[ -z "\\\$WU_ID" ]]; then
  exit 0
fi

# Determine hook event name (set by Claude Code runtime)
HOOK_EVENT="\\\${hook_event_name:-PostToolUse}"

# Branch on event type
case "\\\$HOOK_EVENT" in
  SubagentStop)
    # Always checkpoint when sub-agent stops
    (
      pnpm mem:checkpoint "Auto: sub-agent completed" --wu "\\\$WU_ID" --trigger "subagent-stop" --quiet 2>/dev/null || true
    ) &
    ;;
  *)
    # PostToolUse (default): counter-based checkpointing
    mkdir -p "\\\$COUNTERS_DIR" 2>/dev/null || true
    COUNTER_FILE="\\\${COUNTERS_DIR}/\\\${WU_ID}.json"

    # Read current count (default 0)
    COUNT=0
    if [[ -f "\\\$COUNTER_FILE" ]]; then
      COUNT=\\\$(python3 -c "
import json
try:
    with open('\\\$COUNTER_FILE', 'r') as f:
        data = json.load(f)
    print(data.get('count', 0))
except:
    print(0)
" 2>/dev/null || echo "0")
    fi

    # Increment counter
    COUNT=\\\$((COUNT + 1))

    # Check if we've reached the interval
    if [[ \\\$COUNT -ge \\\$INTERVAL ]]; then
      # Reset counter and checkpoint in background
      echo '{"count": 0}' > "\\\$COUNTER_FILE" 2>/dev/null || true
      (
        pnpm mem:checkpoint "Auto: \\\${COUNT} tool calls" --wu "\\\$WU_ID" --trigger "auto-interval" --quiet 2>/dev/null || true
      ) &
    else
      # Just update the counter
      echo "{\\\\\\"count\\\\\\": \\\$COUNT}" > "\\\$COUNTER_FILE" 2>/dev/null || true
    fi
    ;;
esac

exit 0
`;
  /* eslint-enable no-useless-escape */
}
