#!/bin/bash
#
# Tests for validate-worktree-path.sh
#
# Run with: bash .claude/hooks/validate-worktree-path.test.sh
#
# Exit codes:
#   0 = All tests pass
#   1 = One or more tests failed
#

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="${SCRIPT_DIR}/validate-worktree-path.sh"
FAILED=0
PASSED=0

# Helper function to run a test
run_test() {
  local name="$1"
  local input="$2"
  local expected_exit="$3"
  local env_vars="${4:-}"

  # Run hook with input, capturing exit code
  local actual_exit
  if [[ -n "$env_vars" ]]; then
    actual_exit=$(echo "$input" | env $env_vars bash "$HOOK_SCRIPT" 2>/dev/null; echo $?)
  else
    actual_exit=$(echo "$input" | bash "$HOOK_SCRIPT" 2>/dev/null; echo $?)
  fi

  if [[ "$actual_exit" -eq "$expected_exit" ]]; then
    echo "PASS: $name"
    ((PASSED++))
  else
    echo "FAIL: $name (expected exit $expected_exit, got $actual_exit)"
    ((FAILED++))
  fi
}

# Helper to run test expecting block (exit 2)
expect_block() {
  local name="$1"
  local input="$2"
  local env_vars="${3:-}"
  run_test "$name" "$input" 2 "$env_vars"
}

# Helper to run test expecting allow (exit 0)
expect_allow() {
  local name="$1"
  local input="$2"
  local env_vars="${3:-}"
  run_test "$name" "$input" 0 "$env_vars"
}

echo "========================================"
echo "validate-worktree-path.sh Test Suite"
echo "========================================"
echo ""

# ============================================
# Acceptance Criteria 1: Hook blocks on empty stdin (fail-closed)
# ============================================
echo "--- AC1: Empty stdin should block ---"
expect_block "Empty stdin blocks" ""

# ============================================
# Acceptance Criteria 2: Hook blocks on JSON parse failure (fail-closed)
# ============================================
echo ""
echo "--- AC2: Invalid JSON should block ---"
expect_block "Invalid JSON (plain text)" "invalid json"
expect_block "Invalid JSON (truncated)" '{"tool_name": "Write'
expect_block "Invalid JSON (malformed)" '{"tool_name": Write}'
expect_block "Invalid JSON (empty object key)" '{: "value"}'

# ============================================
# Acceptance Criteria 3: Hook blocks on empty tool_name for Write/Edit
# ============================================
echo ""
echo "--- AC3: Empty tool_name should block ---"
expect_block "Empty tool_name" '{"tool_name": "", "tool_input": {"file_path": "/some/path"}}'
expect_block "Missing tool_name key" '{"tool_input": {"file_path": "/some/path"}}'

# ============================================
# Acceptance Criteria 4: Hook blocks on missing file_path for Write/Edit
# ============================================
echo ""
echo "--- AC4: Missing file_path for Write/Edit should block ---"
expect_block "Write with empty file_path" '{"tool_name": "Write", "tool_input": {"file_path": ""}}'
expect_block "Write with missing file_path" '{"tool_name": "Write", "tool_input": {}}'
expect_block "Write with missing tool_input" '{"tool_name": "Write"}'
expect_block "Edit with empty file_path" '{"tool_name": "Edit", "tool_input": {"file_path": ""}}'
expect_block "Edit with missing file_path" '{"tool_name": "Edit", "tool_input": {}}'

# ============================================
# Non-Write/Edit tools should still be allowed (no regression)
# ============================================
echo ""
echo "--- Regression: Non-Write/Edit tools allowed ---"
expect_allow "Read tool allowed" '{"tool_name": "Read", "tool_input": {"file_path": "/some/path"}}'
expect_allow "Bash tool allowed" '{"tool_name": "Bash", "tool_input": {"command": "ls"}}'
expect_allow "Grep tool allowed" '{"tool_name": "Grep", "tool_input": {"pattern": "test"}}'

# ============================================
# Valid Write/Edit in worktree should still be allowed (no regression)
# ============================================
echo ""
echo "--- Regression: Valid operations allowed ---"
# These depend on environment context (worktree paths), so we test the
# parsing logic separately from the path validation

# ============================================
# WU-1501 AC1: Fail-closed when no worktrees exist
# Write/Edit should be blocked on main when no worktrees directory exists
# (previously this was fail-open, allowing unguarded writes)
# ============================================
echo ""
echo "--- WU-1501 AC1: Fail-closed when no worktrees exist ---"

# Create a temp directory to simulate a repo with no worktrees
TEMP_REPO=$(mktemp -d)
mkdir -p "$TEMP_REPO/.lumenflow"
# Deliberately do NOT create $TEMP_REPO/worktrees

# Write to a code file path (non-allowlisted) should be blocked
expect_block "Write to code file blocked when no worktrees" \
  "{\"tool_name\": \"Write\", \"tool_input\": {\"file_path\": \"$TEMP_REPO/packages/cli/src/file.ts\"}}" \
  "CLAUDE_PROJECT_DIR=$TEMP_REPO"

expect_block "Edit to code file blocked when no worktrees" \
  "{\"tool_name\": \"Edit\", \"tool_input\": {\"file_path\": \"$TEMP_REPO/packages/core/src/index.ts\"}}" \
  "CLAUDE_PROJECT_DIR=$TEMP_REPO"

# ============================================
# WU-1501 AC2: Allowlist paths are permitted even without worktrees
# ============================================
echo ""
echo "--- WU-1501 AC2: Allowlist paths allowed on main ---"

expect_allow "Write to WU YAML allowed" \
  "{\"tool_name\": \"Write\", \"tool_input\": {\"file_path\": \"$TEMP_REPO/docs/04-operations/tasks/wu/WU-1501.yaml\"}}" \
  "CLAUDE_PROJECT_DIR=$TEMP_REPO"

expect_allow "Write to .lumenflow/ allowed" \
  "{\"tool_name\": \"Write\", \"tool_input\": {\"file_path\": \"$TEMP_REPO/.lumenflow/state/wu-events.jsonl\"}}" \
  "CLAUDE_PROJECT_DIR=$TEMP_REPO"

expect_allow "Write to .claude/ allowed" \
  "{\"tool_name\": \"Write\", \"tool_input\": {\"file_path\": \"$TEMP_REPO/.claude/settings.json\"}}" \
  "CLAUDE_PROJECT_DIR=$TEMP_REPO"

expect_allow "Write to plan/ scaffold allowed" \
  "{\"tool_name\": \"Write\", \"tool_input\": {\"file_path\": \"$TEMP_REPO/plan/WU-1501-plan.md\"}}" \
  "CLAUDE_PROJECT_DIR=$TEMP_REPO"

# Clean up temp repo
rm -rf "$TEMP_REPO"

# ============================================
# Acceptance Criteria 5: Audit logging
# ============================================
echo ""
echo "--- AC5: Audit logging ---"
AUDIT_LOG_DIR="${SCRIPT_DIR}/../audit"
AUDIT_LOG="${AUDIT_LOG_DIR}/main-write-blocks.log"

# Test that audit log is written on block
# First, ensure clean state (remove if exists)
rm -f "$AUDIT_LOG" 2>/dev/null || true

# Trigger a block that should be logged (invalid JSON)
echo "invalid json" | bash "$HOOK_SCRIPT" 2>/dev/null || true

if [[ -f "$AUDIT_LOG" ]]; then
  if grep -q "invalid json\|parse\|blocked\|fail" "$AUDIT_LOG" 2>/dev/null; then
    echo "PASS: Audit log written on block"
    ((PASSED++))
  else
    echo "FAIL: Audit log exists but content may not describe block"
    ((FAILED++))
  fi
else
  echo "FAIL: Audit log not created at $AUDIT_LOG"
  ((FAILED++))
fi

# ============================================
# Summary
# ============================================
echo ""
echo "========================================"
echo "Results: $PASSED passed, $FAILED failed"
echo "========================================"

if [[ "$FAILED" -gt 0 ]]; then
  exit 1
else
  exit 0
fi
