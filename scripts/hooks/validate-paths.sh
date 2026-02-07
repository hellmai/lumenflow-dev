#!/bin/bash
#
# validate-paths.sh
#
# Husky pre-commit hook to prevent absolute paths in commits.
# Includes audit logging for security visibility.
#
# Environment Variables:
#   LUMENFLOW_FORCE=1           - Bypass this check (use with caution)
#   LUMENFLOW_FORCE_REASON=""   - Reason for bypass (logged for audit)
#

set -u

# Configuration
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
AUDIT_LOG_DIR="${REPO_ROOT}/.lumenflow"
AUDIT_LOG="${AUDIT_LOG_DIR}/safety-blocks.log"
BYPASS_LOG="${AUDIT_LOG_DIR}/force-bypasses.log"

# Setup audit logging
mkdir -p "$AUDIT_LOG_DIR"

log_audit() {
    local reason="$1"
    local file="$2"
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "${timestamp}|BLOCKED|${reason}|${file}" >> "$AUDIT_LOG"
}

log_bypass() {
    local hook_name="$1"
    local reason="${LUMENFLOW_FORCE_REASON:-NO_REASON}"
    local timestamp
    local user
    local branch
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    user=$(whoami 2>/dev/null || echo "unknown")
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    echo "${timestamp}|BYPASSED|${hook_name}|${user}|${branch}|${reason}|${PWD}" >> "$BYPASS_LOG"
}

warn_no_reason() {
    echo "" >&2
    echo "=== LUMENFLOW FORCE WARNING ===" >&2
    echo "Hook bypass used without a reason." >&2
    echo "Please provide a reason for the audit trail." >&2
    echo "===============================" >&2
}

# Check for LUMENFLOW_FORCE bypass
if [ "${LUMENFLOW_FORCE:-}" = "1" ]; then
    log_bypass "validate-paths"
    if [ -z "${LUMENFLOW_FORCE_REASON:-}" ]; then
        warn_no_reason
    fi
    exit 0
fi

# Define prohibited patterns (case-insensitive)
PATTERN="(/home/|/Users/|/mnt/c/|/C:/|/D:/)"

# Get list of staged files (ignoring documentation and self to avoid false positives)
# Documentation files may contain example paths for illustration
# Test files that validate path patterns are also excluded (e.g., consumer-integration.test.ts)
FILES=$(git diff --cached --name-only --diff-filter=ACMR \
  | grep -v "scripts/hooks/validate-paths.sh" \
  | grep -v "docs/04-operations/tasks/wu/" \
  | grep -v "apps/docs/" \
  | grep -v "\.md$" \
  | grep -v "\.mdx$" \
  | grep -v "consumer-integration\.test\.ts$" \
  | grep -v "^\.claude/settings\.json$")

if [ -z "$FILES" ]; then
  exit 0
fi

# Check files for absolute paths in staged content
MATCHES=""
for file in $FILES; do
    if git show ":$file" 2>/dev/null | grep -qHE "$PATTERN"; then
        MATCHES="${MATCHES}${file}: absolute path pattern detected\n"
    fi
done

if [ -n "$MATCHES" ]; then
    # Log the first match for audit
    FIRST_MATCH=$(echo "$MATCHES" | head -n1)

    log_audit "absolute_path_detected" "$FIRST_MATCH"

    echo "" >&2
    echo "=== LUMENFLOW SAFETY BLOCK ===" >&2
    echo "BLOCKED: Absolute path detected in staged files." >&2
    echo "Absolute paths break portability across environments." >&2
    echo "Detected in:" >&2
    echo -e "$MATCHES" >&2
    echo "==============================" >&2
    exit 1
fi

exit 0
