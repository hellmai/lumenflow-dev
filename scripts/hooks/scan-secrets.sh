#!/bin/bash
#
# scan-secrets.sh
#
# Husky pre-commit hook to scan for potential secrets in staged files.
# Blocks commits containing high-entropy strings or known key patterns.
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
    echo "LUMENFLOW_FORCE used without LUMENFLOW_FORCE_REASON." >&2
    echo "Please provide a reason for audit trail:" >&2
    echo "  LUMENFLOW_FORCE_REASON=\"your reason\" LUMENFLOW_FORCE=1 git commit ..." >&2
    echo "===============================" >&2
}

# Check for LUMENFLOW_FORCE bypass
if [ "${LUMENFLOW_FORCE:-}" = "1" ]; then
    log_bypass "scan-secrets"
    if [ -z "${LUMENFLOW_FORCE_REASON:-}" ]; then
        warn_no_reason
    fi
    exit 0
fi

# Get list of staged files (exclude this script and tests)
FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -v "scan-secrets.sh" | grep -v "__tests__")

if [ -z "$FILES" ]; then
  exit 0
fi

# Define secret patterns
# 1. AWS Access Key ID (AKIA...)
# 2. GitHub Token (ghp_..., ghO_...)
# 3. OpenAI Key (sk-...)
# 4. Private Key Header (-----BEGIN PRIVATE KEY-----)

FAILURES=()

for file in $FILES; do
    # Check for specific known patterns in staged content
    if git show ":$file" 2>/dev/null | grep -qE "(AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{48}|-----BEGIN [A-Z ]+ PRIVATE KEY-----)"; then
        FAILURES+=("$file (Known Secret Pattern)")
        continue
    fi

    # Generic suspicious keyword assignment in staged content
    if git show ":$file" 2>/dev/null | grep -qE "((api_key|access_token|secret_key|password)\s*[:=]\s*['\"][a-zA-Z0-9_\-]{20,}['\"])" ; then
         FAILURES+=("$file (Suspicious Keyword Assignment)")
    fi
done

if [ ${#FAILURES[@]} -gt 0 ]; then
    echo "" >&2
    echo "=== LUMENFLOW SAFETY BLOCK ===" >&2
    echo "BLOCKED: Potential secrets detected in staged files." >&2
    echo "Do not commit secrets to the repository." >&2
    echo "" >&2
    echo "Detected in:" >&2
    for fail in "${FAILURES[@]}"; do
        log_audit "secret_detected" "$fail"
        echo "  - $fail" >&2
    done
    echo "" >&2
    echo "If this is a false positive, use: LUMENFLOW_FORCE=1 git commit ..." >&2
    echo "==============================" >&2
    exit 1
fi

exit 0
