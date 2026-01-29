#!/bin/bash
#
# check-lockfile.sh
#
# Husky pre-commit hook to ensure package.json and pnpm-lock.yaml stay in sync.
# Blocks commits where package.json is modified but lockfile is not.
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

# Check staged files
STAGED_FILES=$(git diff --cached --name-only)

HAS_PACKAGE_JSON=0
HAS_LOCKFILE=0
DEPS_CHANGED=0

# Check if package.json is staged
if echo "$STAGED_FILES" | grep -q "package.json"; then
    HAS_PACKAGE_JSON=1
    
    # Check if dependency fields actually changed (not just metadata)
    # Look for additions/modifications to dependency sections
    DEPS_CHANGED=$(git diff --cached -U0 -- "package.json" | grep -E '^\+.*"(dependencies|devDependencies|peerDependencies|optionalDependencies)"' | wc -l)
    
    # Also check for dependency value changes within existing sections
    if [ "$DEPS_CHANGED" -eq 0 ]; then
        # Look for lines that add/modify dependencies within sections
        DEPS_CHANGED=$(git diff --cached -- "package.json" | grep -E '^\+.*"[a-zA-Z0-9@/_-]+":\s*"[^"]*"' | wc -l)
    fi
fi

if echo "$STAGED_FILES" | grep -q "pnpm-lock.yaml"; then
    HAS_LOCKFILE=1
fi

# If package.json dependency fields changed but lockfile is not -> BLOCK
if [ "$HAS_PACKAGE_JSON" -eq 1 ] && [ "$DEPS_CHANGED" -gt 0 ] && [ "$HAS_LOCKFILE" -eq 0 ]; then
    log_audit "lockfile_desync" "package.json dependencies modified without lockfile"
    
    echo "" >&2
    echo "=== LUMENFLOW SAFETY BLOCK ===" >&2
    echo "BLOCKED: package.json dependencies modified without pnpm-lock.yaml" >&2
    echo "" >&2
    echo "Dependencies must be deterministic." >&2
    echo "Run 'pnpm install' to update the lockfile and stage it." >&2
    echo "" >&2
    echo "==============================" >&2
    exit 1
fi

exit 0
