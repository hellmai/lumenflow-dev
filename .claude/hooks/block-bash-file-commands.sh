#!/bin/bash
#
# block-bash-file-commands.sh
#
# PreToolUse hook that blocks file-operation commands in Bash tool calls.
# These should use dedicated tools (Grep, Read, Glob, Edit) instead.
#
# Exit codes:
#   0 = Allow operation
#   2 = Block operation (stderr shown to Claude as guidance)
#
# Environment variables:
#   LUMENFLOW_TOOL_GUARD_DISABLED=1  - Disable this hook entirely
#   LUMENFLOW_TOOL_GUARD_MODE=warn   - Warn but allow (default: block)
#

set -euo pipefail

# Check if hook is disabled
if [[ "${LUMENFLOW_TOOL_GUARD_DISABLED:-}" == "1" ]]; then
  exit 0
fi

MODE="${LUMENFLOW_TOOL_GUARD_MODE:-block}"

# Derive repository context (best-effort)
MAIN_REPO_PATH=""
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  MAIN_REPO_PATH="${CLAUDE_PROJECT_DIR}"
else
  MAIN_REPO_PATH="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
fi

WORKTREES_DIR=""
STATE_FILE=""
if [[ -n "$MAIN_REPO_PATH" ]]; then
  WORKTREES_DIR="${MAIN_REPO_PATH}/worktrees"
  STATE_FILE="${MAIN_REPO_PATH}/.lumenflow/state/wu-events.jsonl"
fi

# Block helper function
block_command() {
  local command_name="$1"
  local alternative="$2"
  local explanation="$3"

  if [[ "$MODE" == "warn" ]]; then
    echo "" >&2
    echo "=== Tool Usage Warning ===" >&2
    echo "" >&2
    echo "WARNING: Using '${command_name}' in Bash" >&2
    echo "" >&2
    echo "RECOMMENDED: ${alternative}" >&2
    echo "" >&2
    echo "WHY: ${explanation}" >&2
    echo "" >&2
    echo "See: .lumenflow/rules/tool-usage.md" >&2
    echo "==========================" >&2
    exit 0  # Allow but warn
  fi

  echo "" >&2
  echo "=== Tool Usage Enforcement ===" >&2
  echo "" >&2
  echo "BLOCKED: '${command_name}' command in Bash" >&2
  echo "" >&2
  echo "USE INSTEAD: ${alternative}" >&2
  echo "" >&2
  echo "WHY: ${explanation}" >&2
  echo "" >&2
  echo "See: .lumenflow/rules/tool-usage.md" >&2
  echo "===============================" >&2
  exit 2
}

# Read JSON input from stdin
INPUT=$(cat)

if [[ -z "$INPUT" ]]; then
  # No input - fail open for this hook (not security-critical)
  exit 0
fi

# Parse the tool name and input
TOOL_NAME=$(echo "$INPUT" | python3 -c "
import json
import sys
try:
    data = json.load(sys.stdin)
    print(data.get('tool_name', ''))
except:
    print('')
" 2>/dev/null || echo "")

# Only process Bash tool calls
if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Extract the command from tool_input
COMMAND=$(echo "$INPUT" | python3 -c "
import json
import sys
try:
    data = json.load(sys.stdin)
    tool_input = data.get('tool_input', {})
    if isinstance(tool_input, dict):
        print(tool_input.get('command', ''))
    else:
        print('')
except:
    print('')
" 2>/dev/null || echo "")

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# Extract the first word/command name, handling various patterns
# This handles: grep, /usr/bin/grep, command grep, env grep, etc.
get_base_command() {
  local cmd="$1"

  # Remove leading whitespace
  cmd="${cmd#"${cmd%%[![:space:]]*}"}"

  # Skip common prefixes
  # Handle: env VAR=value command, command command, sudo command
  while true; do
    case "$cmd" in
      env\ *)
        # Skip 'env' and any VAR=value pairs
        cmd="${cmd#env }"
        while [[ "$cmd" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do
          cmd="${cmd#*=}"
          cmd="${cmd#* }"
        done
        ;;
      command\ *)
        cmd="${cmd#command }"
        ;;
      *)
        break
        ;;
    esac
  done

  # Get first word
  local first_word="${cmd%% *}"

  # Strip path (e.g., /usr/bin/grep -> grep)
  echo "${first_word##*/}"
}

BASE_CMD=$(get_base_command "$COMMAND")

has_active_worktrees() {
  if [[ -z "$WORKTREES_DIR" || ! -d "$WORKTREES_DIR" ]]; then
    return 1
  fi

  local count
  count=$(find "$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
  [[ "$count" -gt 0 ]]
}

is_branch_pr_wu_active() {
  if [[ -z "$STATE_FILE" || ! -f "$STATE_FILE" ]]; then
    return 1
  fi

  if grep -q '"claimed_mode":"branch-pr"' "$STATE_FILE" 2>/dev/null && \
     grep -q '"status":"in_progress"' "$STATE_FILE" 2>/dev/null; then
    return 0
  fi

  return 1
}

is_main_checkout_context() {
  if [[ -z "$MAIN_REPO_PATH" ]]; then
    return 1
  fi

  local cwd
  cwd="$(pwd -P 2>/dev/null || pwd)"

  if [[ "$cwd" == "${MAIN_REPO_PATH}/worktrees/"* ]]; then
    return 1
  fi

  [[ "$cwd" == "$MAIN_REPO_PATH" || "$cwd" == "${MAIN_REPO_PATH}/"* ]]
}

is_mutating_filesystem_command() {
  local base_cmd="$1"

  case "$base_cmd" in
    cp|mv|rm|mkdir|touch|ln|install|rsync|chmod|chown|chgrp|truncate|dd|tee)
      return 0
      ;;
  esac

  return 1
}

if is_main_checkout_context && has_active_worktrees && ! is_branch_pr_wu_active && \
   is_mutating_filesystem_command "$BASE_CMD"; then
  block_command "$BASE_CMD" \
    "cd worktrees/<lane>-wu-<id>/ and run the command there" \
    "File-mutating Bash commands on main can bypass worktree safeguards. Run mutations inside the claimed worktree."
fi

# Check for blocked commands
case "$BASE_CMD" in
  grep|egrep|fgrep|rg|ripgrep)
    # Check if this is searching file contents vs. piped input
    # Piped input (e.g., "git log | grep") is allowed
    if [[ "$COMMAND" =~ \|[[:space:]]*"$BASE_CMD" ]]; then
      exit 0  # Piped input is OK
    fi
    block_command "$BASE_CMD" \
      "Grep tool" \
      "The Grep tool has proper permissions, structured output, and timeout handling"
    ;;

  cat)
    # Check if reading files vs. piped/heredoc usage
    # "cat file" should be blocked, "cat << EOF" or "echo | cat" are OK
    if [[ "$COMMAND" =~ \|[[:space:]]*cat ]] || [[ "$COMMAND" =~ cat[[:space:]]*\<\< ]]; then
      exit 0  # Piped/heredoc usage is OK
    fi
    # Check if cat is followed by what looks like a filename
    # Store regex in variable to avoid bash parsing issues with character classes
    cat_file_regex='cat[[:space:]]+[^|]'
    if [[ "$COMMAND" =~ $cat_file_regex ]]; then
      block_command "cat" \
        "Read tool" \
        "The Read tool provides line numbers, handles images/PDFs, and respects file restrictions"
    fi
    exit 0  # Other cat usage (e.g., cat alone) is allowed
    ;;

  head|tail)
    # Similar to cat - block file reading, allow piped
    if [[ "$COMMAND" =~ \|[[:space:]]*"$BASE_CMD" ]]; then
      exit 0  # Piped input is OK
    fi
    block_command "$BASE_CMD" \
      "Read tool with offset/limit parameters" \
      "The Read tool handles partial file reading with proper semantics"
    ;;

  find)
    # Block find for file discovery - use Glob instead
    # Allow find with -exec for batch operations (legitimate use case)
    if [[ "$COMMAND" =~ -exec ]]; then
      exit 0  # find -exec is a legitimate use case
    fi
    block_command "find" \
      "Glob tool" \
      "The Glob tool is faster and returns files sorted by modification time"
    ;;

  sed)
    # Block sed for file editing - use Edit instead
    # Allow sed for stream processing (piped input)
    if [[ "$COMMAND" =~ \|[[:space:]]*sed ]]; then
      exit 0  # Piped input is OK
    fi
    # Check for -i (in-place editing)
    if [[ "$COMMAND" =~ sed[[:space:]]+-i ]] || [[ "$COMMAND" =~ sed[[:space:]]+--in-place ]]; then
      block_command "sed -i" \
        "Edit tool" \
        "The Edit tool provides proper diff tracking and undo support"
    fi
    exit 0  # Stream sed without -i is allowed
    ;;

  awk|gawk|mawk|nawk)
    # Block awk for file processing - similar to sed
    if [[ "$COMMAND" =~ \|[[:space:]]*"$BASE_CMD" ]]; then
      exit 0  # Piped input is OK
    fi
    # If awk has a filename argument (not just pattern), block it
    # Heuristic: if there are non-option arguments after the pattern
    # Store regex in variable to avoid bash parsing issues with character classes
    awk_single_quote_regex="${BASE_CMD}[[:space:]]+'[^']*'[[:space:]]+[^|]"
    awk_double_quote_regex="${BASE_CMD}[[:space:]]+\"[^\"]*\"[[:space:]]+[^|]"
    if [[ "$COMMAND" =~ $awk_single_quote_regex ]] || \
       [[ "$COMMAND" =~ $awk_double_quote_regex ]]; then
      block_command "$BASE_CMD" \
        "Read tool + code processing or Edit tool" \
        "Use Read tool to get file contents, then process in code"
    fi
    exit 0  # Other awk usage is allowed
    ;;

  echo)
    # Block echo for file writing (echo > file, echo >> file)
    if [[ "$COMMAND" =~ echo[[:space:]].*\>[[:space:]]* ]]; then
      block_command "echo > file" \
        "Write tool" \
        "The Write tool provides proper permissions, file tracking, and worktree enforcement"
    fi
    exit 0  # echo to stdout is allowed
    ;;

  *)
    # Not a blocked command
    exit 0
    ;;
esac
