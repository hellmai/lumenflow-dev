#!/bin/bash
#
# validate-paths.sh
#
# Husky pre-commit hook to prevent absolute paths in commits.
# Includes audit logging for security visibility.
#

set -u

# Configuration
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
AUDIT_LOG_DIR="${REPO_ROOT}/audit"
AUDIT_LOG="${AUDIT_LOG_DIR}/main-write-blocks.log"

# Setup audit logging
mkdir -p "$AUDIT_LOG_DIR"

log_audit() {
    local reason="$1"
    local file="$2"
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "${timestamp}|BLOCKED|${reason}|${file}" >> "$AUDIT_LOG"
}

# Define prohibited patterns (case-insensitive)
PATTERN="(/home/|/Users/|/mnt/c/|/C:/|/D:/)"

# Get list of staged files (ignoring self to avoid false positives)
FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -v "scripts/hooks/validate-paths.sh" | grep -v "docs/04-operations/tasks/wu/")

if [ -z "$FILES" ]; then
  exit 0
fi

# Check files for absolute paths
# xargs grep returns 0 if matches found (which is bad for us)
MATCHES=$(echo "$FILES" | xargs grep -IHE "$PATTERN" 2>/dev/null || echo "")

if [ -n "$MATCHES" ]; then
    # Log the first match for audit
    FIRST_MATCH=$(echo "$MATCHES" | head -n1)
    
    log_audit "absolute_path_detected" "$FIRST_MATCH"

    echo "" >&2
    echo "=== LUMENFLOW SAFETY BLOCK ===" >&2
    echo "BLOCKED: Absolute path detected in staged files." >&2
    echo "Absolute paths break portability across environments." >&2
    echo "Detected in: $MATCHES" >&2
    echo "==============================" >&2
    exit 1
fi

exit 0
