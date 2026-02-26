#!/bin/bash
#
# Tests for block-bash-file-commands.sh
#
# Run with: bash .claude/hooks/block-bash-file-commands.test.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="${SCRIPT_DIR}/block-bash-file-commands.sh"

PASS=0
FAIL=0

expect_exit() {
  local expected="$1"
  local name="$2"
  local input="$3"
  local cwd="$4"
  local setup_branch_pr="${5:-0}"

  local output
  local code
  local temp_repo
  temp_repo="$(mktemp -d)"

  mkdir -p "${temp_repo}/worktrees/sample-wu"
  mkdir -p "${temp_repo}/.lumenflow/state"

  if [[ "$setup_branch_pr" == "1" ]]; then
    cat > "${temp_repo}/.lumenflow/state/wu-events.jsonl" <<'STATEEOF'
{"type":"claim","claimed_mode":"branch-pr","status":"in_progress"}
STATEEOF
  fi

  if [[ "$cwd" == "worktree" ]]; then
    mkdir -p "${temp_repo}/worktrees/sample-wu/repo"
    cwd="${temp_repo}/worktrees/sample-wu/repo"
  else
    cwd="${temp_repo}"
  fi

  set +e
  output=$(
    cd "$cwd" && \
      CLAUDE_PROJECT_DIR="${temp_repo}" \
      bash "$HOOK_SCRIPT" <<< "$input" 2>&1
  )
  code=$?
  set -e

  if [[ "$code" -eq "$expected" ]]; then
    echo "PASS: ${name}"
    PASS=$((PASS + 1))
  else
    echo "FAIL: ${name}"
    echo "  Expected exit: ${expected}"
    echo "  Actual exit:   ${code}"
    echo "  Output:"
    echo "$output" | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  fi

  rm -rf "${temp_repo}"
}

echo "block-bash-file-commands.sh Test Suite"
echo "======================================"
echo ""

# New guard: main checkout + active worktrees + mutating command => blocked
expect_exit 2 \
  "Blocks cp from main when worktrees exist" \
  '{"tool_name":"Bash","tool_input":{"command":"cp a b"}}' \
  "main"

# Non-mutating commands should still pass
expect_exit 0 \
  "Allows ls from main when worktrees exist" \
  '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' \
  "main"

# Worktree context should allow mutating commands
expect_exit 0 \
  "Allows cp from worktree context" \
  '{"tool_name":"Bash","tool_input":{"command":"cp a b"}}' \
  "worktree"

# Branch-pr WUs intentionally run from main checkout
expect_exit 0 \
  "Allows cp from main when branch-pr WU is active" \
  '{"tool_name":"Bash","tool_input":{"command":"cp a b"}}' \
  "main" \
  "1"

# Arrow notation in string arguments should NOT be blocked (WU-2214)
expect_exit 0 \
  "Allows arrow notation in string arguments (old->new)" \
  '{"tool_name":"Bash","tool_input":{"command":"pnpm wu:create --acceptance \"old->new mapping\""}}' \
  "main"

# Actual file redirect should still be blocked
expect_exit 2 \
  "Blocks actual file redirect (echo foo > file.txt)" \
  '{"tool_name":"Bash","tool_input":{"command":"echo foo > file.txt"}}' \
  "main"

# Double redirect should still be blocked
expect_exit 2 \
  "Blocks double redirect (echo foo >> file.txt)" \
  '{"tool_name":"Bash","tool_input":{"command":"echo foo >> file.txt"}}' \
  "main"

echo ""
echo "======================================"
echo "Results: ${PASS} passed, ${FAIL} failed"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi

echo "All tests passed."
