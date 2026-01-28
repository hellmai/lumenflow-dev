#!/bin/bash
#
# validate-paths.sh
#
# Husky pre-commit hook to prevent absolute paths in commits.
#

set -e

# Define prohibited patterns (case-insensitive)
# We block:
# - /home/<user>
# - /Users/<user>
# - /mnt/c/<user> (WSL)
PATTERN="(/home/|/Users/|/mnt/c/|/C:/|/D:/)"

# Get list of staged files
FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -v "scripts/hooks/validate-paths.sh")

if [ -z "$FILES" ]; then
  exit 0
fi

# Check files for absolute paths
# logical OR: if grep gives exit code 0 (found matches), then we fail.
if echo "$FILES" | xargs grep -IHE "$PATTERN" 2>/dev/null; then
    echo "" >&2
    echo "=== LUMENFLOW SAFETY BLOCK ===" >&2
    echo "BLOCKED: Absolute path detected in staged files." >&2
    echo "Absolute paths break portability across environments." >&2
    echo "Please use relative paths (e.g. imports) or environment variables." >&2
    echo "==============================" >&2
    exit 1
fi

exit 0
