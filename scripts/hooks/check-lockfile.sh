#!/bin/bash
#
# check-lockfile.sh
#
# Husky pre-commit hook to ensure package.json and pnpm-lock.yaml stay in sync.
# Blocks commits where package.json is modified but lockfile is not.
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
    log_bypass "check-lockfile"
    if [ -z "${LUMENFLOW_FORCE_REASON:-}" ]; then
        warn_no_reason
    fi
    exit 0
fi

# Check staged files
STAGED_FILES=$(git diff --cached --name-only)

HAS_PACKAGE_JSON=0
HAS_LOCKFILE=0
DEPS_CHANGED=0

# Check if package.json is staged
if echo "$STAGED_FILES" | grep -q "package.json"; then
    HAS_PACKAGE_JSON=1

    # Use Node.js JSON.parse to compare dependency fields structurally.
    # Replaces brittle regex that false-positived on script additions (WU-1480).
    DEPS_CHANGED=$(node -e "
      const { execFileSync } = require('child_process');
      const DEP_FIELDS = ['dependencies','devDependencies','peerDependencies','optionalDependencies'];
      try {
        const head = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { encoding: 'utf8' }));
        const staged = JSON.parse(execFileSync('git', ['show', ':package.json'], { encoding: 'utf8' }));
        const changed = DEP_FIELDS.some(f => JSON.stringify(head[f]) !== JSON.stringify(staged[f]));
        process.stdout.write(changed ? '1' : '0');
      } catch { process.stdout.write('0'); }
    ")
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
