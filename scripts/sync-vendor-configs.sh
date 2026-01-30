#!/bin/bash
#
# sync-vendor-configs.sh - Generate all vendor configs from single template
# Part of WU-1177: Friction-Free Onboarding
#
# Usage:
#   ./scripts/sync-vendor-configs.sh          # Regenerate all configs
#   ./scripts/sync-vendor-configs.sh --check  # Verify configs are in sync
#   ./scripts/sync-vendor-configs.sh --help   # Show help
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_FILE="$REPO_ROOT/templates/vendor-rules.template.md"

# Vendor config paths (relative to repo root)
declare -A VENDOR_CONFIGS=(
  ["cursor"]=".cursor/rules/lumenflow.md"
  ["windsurf"]=".windsurf/rules/lumenflow.md"
  ["cline"]=".clinerules"
)

# LUMENFLOW.md path relative to vendor config location
declare -A LUMENFLOW_PATHS=(
  ["cursor"]="../../LUMENFLOW.md"
  ["windsurf"]="../../LUMENFLOW.md"
  ["cline"]="LUMENFLOW.md"
)

# quick-ref-commands.md path relative to vendor config location
declare -A QUICK_REF_PATHS=(
  ["cursor"]="../../docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md"
  ["windsurf"]="../../docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md"
  ["cline"]="docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md"
)

# Vendor display names
declare -A VENDOR_NAMES=(
  ["cursor"]="Cursor"
  ["windsurf"]="Windsurf"
  ["cline"]="Cline"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

show_help() {
  cat << EOF
sync-vendor-configs.sh - Synchronize vendor configs from template

Usage:
  $0              Regenerate all vendor configs from template
  $0 --check      Verify configs are in sync (exit 1 if not)
  $0 --help       Show this help message

Vendor configs:
EOF

  for vendor in "${!VENDOR_CONFIGS[@]}"; do
    echo "  - $vendor: ${VENDOR_CONFIGS[$vendor]}"
  done

  echo ""
  echo "Template: templates/vendor-rules.template.md"
}

generate_config() {
  local vendor="$1"
  local config_path="${VENDOR_CONFIGS[$vendor]}"
  local lumenflow_path="${LUMENFLOW_PATHS[$vendor]}"
  local quick_ref_path="${QUICK_REF_PATHS[$vendor]}"
  local vendor_name="${VENDOR_NAMES[$vendor]}"

  # Read template and substitute variables
  local content
  content=$(cat "$TEMPLATE_FILE")
  content="${content//\{\{VENDOR_NAME\}\}/$vendor_name}"
  content="${content//\{\{LUMENFLOW_PATH\}\}/$lumenflow_path}"
  content="${content//\{\{QUICK_REF_PATH\}\}/$quick_ref_path}"
  content="${content//\{\{PROJECT_ROOT\}\}//path/to/repo}"

  echo "$content"
}

check_sync() {
  local all_in_sync=true

  echo "Checking vendor configs against template..."
  echo ""

  for vendor in "${!VENDOR_CONFIGS[@]}"; do
    local config_path="$REPO_ROOT/${VENDOR_CONFIGS[$vendor]}"

    if [[ ! -f "$config_path" ]]; then
      echo -e "${YELLOW}MISSING${NC}: ${VENDOR_CONFIGS[$vendor]}"
      all_in_sync=false
      continue
    fi

    local expected
    expected=$(generate_config "$vendor")
    local actual
    actual=$(cat "$config_path")

    if [[ "$expected" == "$actual" ]]; then
      echo -e "${GREEN}IN SYNC${NC}: ${VENDOR_CONFIGS[$vendor]}"
    else
      echo -e "${RED}OUT OF SYNC${NC}: ${VENDOR_CONFIGS[$vendor]}"
      all_in_sync=false
    fi
  done

  echo ""

  if $all_in_sync; then
    echo -e "${GREEN}All vendor configs are in sync${NC}"
    exit 0
  else
    echo -e "${RED}Some vendor configs are out of sync${NC}"
    echo "Run: ./scripts/sync-vendor-configs.sh to regenerate"
    exit 1
  fi
}

regenerate_all() {
  echo "Regenerating vendor configs from template..."
  echo ""

  if [[ ! -f "$TEMPLATE_FILE" ]]; then
    echo -e "${RED}ERROR${NC}: Template not found: $TEMPLATE_FILE"
    exit 1
  fi

  for vendor in "${!VENDOR_CONFIGS[@]}"; do
    local config_path="$REPO_ROOT/${VENDOR_CONFIGS[$vendor]}"
    local config_dir
    config_dir=$(dirname "$config_path")

    # Create directory if needed
    mkdir -p "$config_dir"

    # Generate config
    generate_config "$vendor" > "$config_path"

    echo -e "${GREEN}UPDATED${NC}: ${VENDOR_CONFIGS[$vendor]}"
  done

  echo ""
  echo -e "${GREEN}All vendor configs regenerated${NC}"
}

# Main
case "${1:-}" in
  --help|-h)
    show_help
    ;;
  --check)
    check_sync
    ;;
  "")
    regenerate_all
    ;;
  *)
    echo -e "${RED}Unknown option: $1${NC}"
    show_help
    exit 1
    ;;
esac
