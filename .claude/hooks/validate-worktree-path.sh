#!/bin/bash
#
# validate-worktree-path.sh
#
# PreToolUse hook that enforces worktree discipline for Write/Edit tools.
#
# Prevents writing to main repo when worktrees exist - edits should go
# to the worktree for the active WU.
#
# Exit codes:
#   0 = Allow operation
#   2 = Block operation (stderr shown to Claude as guidance)
#
# Security: Fail-closed design (WU-1132)
#   - Empty stdin = block
#   - JSON parse failure = block
#   - Empty tool_name for Write/Edit = block
#   - Missing file_path for Write/Edit = block
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_LOG_DIR="${SCRIPT_DIR}/../audit"
AUDIT_LOG="${AUDIT_LOG_DIR}/main-write-blocks.log"

# Audit logging function (WU-1132)
audit_block() {
  local reason="$1"
  local tool_name="${2:-unknown}"
  local file_path="${3:-unknown}"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Ensure audit directory exists
  mkdir -p "$AUDIT_LOG_DIR"

  # Append to audit log (format: timestamp|reason|tool_name|file_path)
  echo "${timestamp}|${reason}|${tool_name}|${file_path}" >> "$AUDIT_LOG"
}

# Block helper with audit logging
block_with_audit() {
  local reason="$1"
  local tool_name="${2:-unknown}"
  local file_path="${3:-unknown}"
  local message="${4:-}"

  audit_block "$reason" "$tool_name" "$file_path"

  echo "" >&2
  echo "=== Worktree Discipline Enforcement ===" >&2
  echo "" >&2
  echo "BLOCKED: ${tool_name} operation" >&2
  echo "" >&2
  echo "REASON: ${reason}" >&2
  if [[ -n "$message" ]]; then
    echo "$message" >&2
  fi
  echo "" >&2
  echo "See: docs/lumenflow/playbook.md for WU workflow" >&2
  echo "========================================" >&2
  exit 2
}

# Derive repo paths from CLAUDE_PROJECT_DIR
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  MAIN_REPO_PATH="$CLAUDE_PROJECT_DIR"
else
  MAIN_REPO_PATH=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ -z "$MAIN_REPO_PATH" ]]; then
    exit 0
  fi
fi

WORKTREES_DIR="${MAIN_REPO_PATH}/worktrees"

# Check guarded headless mode first (same logic as TypeScript isHeadlessAllowed)
# Requires LUMENFLOW_HEADLESS=1 AND (LUMENFLOW_ADMIN=1 OR CI truthy OR GITHUB_ACTIONS truthy)
if [[ "${LUMENFLOW_HEADLESS:-}" == "1" ]]; then
  if [[ "${LUMENFLOW_ADMIN:-}" == "1" ]] || [[ -n "${CI:-}" ]] || [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    exit 0  # Headless mode allowed - bypass worktree check
  fi
fi

# Path to built CLI helper - try multiple locations for monorepo compatibility
# In pnpm monorepos, packages aren't hoisted to root by default
IS_AGENT_BRANCH_CLI=""
for candidate in \
  "${MAIN_REPO_PATH}/node_modules/@lumenflow/core/dist/cli/is-agent-branch.js" \
  "${MAIN_REPO_PATH}/packages/@lumenflow/core/dist/cli/is-agent-branch.js"; do
  if [[ -f "$candidate" ]]; then
    IS_AGENT_BRANCH_CLI="$candidate"
    break
  fi
done

# Get current branch name
CURRENT_BRANCH=$(git -C "$MAIN_REPO_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# Check if branch is an agent branch using shared helper
# This reads .lumenflow.config.yaml for agentBranchPatterns (single source of truth)
# Prerequisite: @lumenflow/core must be built (pnpm build)
if [[ -n "$IS_AGENT_BRANCH_CLI" ]] && [[ -n "$CURRENT_BRANCH" ]]; then
  if node "$IS_AGENT_BRANCH_CLI" "$CURRENT_BRANCH" 2>/dev/null; then
    exit 0  # Agent branch - allow Write/Edit
  fi
fi

# Read JSON input from stdin (WU-1132: fail-closed on empty stdin)
INPUT=$(cat)

if [[ -z "$INPUT" ]]; then
  block_with_audit "empty_stdin" "unknown" "unknown" \
    "No input provided to hook (stdin was empty). This is a fail-closed security measure."
fi

# Parse JSON with Python (WU-1132: fail-closed on parse failure)
TMPFILE=$(mktemp)
echo "$INPUT" > "$TMPFILE"

PARSE_RESULT=$(python3 -c "
import json
import sys
try:
    with open('$TMPFILE', 'r') as f:
        data = json.load(f)
    tool_name = data.get('tool_name', '')
    tool_input = data.get('tool_input', {})
    if not isinstance(tool_input, dict):
        tool_input = {}
    file_path = tool_input.get('file_path', '')
    # Output success marker, tool_name, and file_path
    print('OK')
    print(tool_name if tool_name else '')
    print(file_path if file_path else '')
except json.JSONDecodeError as e:
    print('JSON_ERROR')
    print(str(e))
    print('')
except Exception as e:
    print('PARSE_ERROR')
    print(str(e))
    print('')
" 2>&1)

rm -f "$TMPFILE"

# Parse the result
PARSE_STATUS=$(echo "$PARSE_RESULT" | head -1)
LINE2=$(echo "$PARSE_RESULT" | sed -n '2p')
LINE3=$(echo "$PARSE_RESULT" | sed -n '3p')

# WU-1132: Fail-closed on JSON parse failure
if [[ "$PARSE_STATUS" == "JSON_ERROR" ]]; then
  block_with_audit "json_parse_failure" "unknown" "unknown" \
    "Failed to parse JSON input: ${LINE2}"
fi

if [[ "$PARSE_STATUS" == "PARSE_ERROR" ]]; then
  block_with_audit "parse_error" "unknown" "unknown" \
    "Error processing input: ${LINE2}"
fi

if [[ "$PARSE_STATUS" != "OK" ]]; then
  block_with_audit "unexpected_parse_result" "unknown" "unknown" \
    "Unexpected parse result: ${PARSE_STATUS}"
fi

TOOL_NAME="$LINE2"
FILE_PATH="$LINE3"

# WU-1132: Fail-closed on empty tool_name for Write/Edit
# First check if tool_name is empty - we need to block if it could be Write/Edit
# but we can't tell. Fail-closed means we must block.
if [[ -z "$TOOL_NAME" ]]; then
  block_with_audit "empty_tool_name" "" "unknown" \
    "Tool name is empty or missing. For Write/Edit operations, tool_name must be specified."
fi

# Only process Write and Edit tools
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

# WU-1132: Fail-closed on missing file_path for Write/Edit
if [[ -z "$FILE_PATH" ]]; then
  block_with_audit "missing_file_path" "$TOOL_NAME" "" \
    "file_path is required for ${TOOL_NAME} operations but was empty or missing."
fi

# Check if any worktrees exist
if [[ ! -d "$WORKTREES_DIR" ]]; then
  exit 0
fi

WORKTREE_COUNT=$(find "$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
if [[ "$WORKTREE_COUNT" -eq 0 ]]; then
  exit 0
fi

# Worktrees exist - check if the file path is within a worktree
RESOLVED_PATH=$(realpath -m "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")

# Allow if path is inside a worktree
if [[ "$RESOLVED_PATH" == "${WORKTREES_DIR}/"* ]]; then
  exit 0
fi

# Block if path is in main repo while worktrees exist
if [[ "$RESOLVED_PATH" == "${MAIN_REPO_PATH}/"* || "$RESOLVED_PATH" == "${MAIN_REPO_PATH}" ]]; then
  ACTIVE_WORKTREES=$(find "$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | head -5 | tr '\n' ', ' | sed 's/,$//')

  block_with_audit "main_repo_write_blocked" "$TOOL_NAME" "$FILE_PATH" \
    "Cannot write to main repo while worktrees exist.
Active worktrees: ${ACTIVE_WORKTREES:-none detected}

USE INSTEAD:
  1. cd to your worktree: cd worktrees/<lane>-wu-<id>/
  2. Make your edits in the worktree"
fi

# Path is outside repo entirely - allow
exit 0
