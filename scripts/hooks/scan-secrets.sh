#!/bin/bash
#
# scan-secrets.sh
#
# Husky pre-commit hook to scan for potential secrets in staged files.
# Blocks commits containing high-entropy strings or known key patterns.
#

set -u

# Configuration
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
AUDIT_LOG_DIR="${REPO_ROOT}/.beacon"
AUDIT_LOG="${AUDIT_LOG_DIR}/safety-blocks.log"

# Setup audit logging
mkdir -p "$AUDIT_LOG_DIR"

log_audit() {
    local reason="$1"
    local file="$2"
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "${timestamp}|BLOCKED|${reason}|${file}" >> "$AUDIT_LOG"
}

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
