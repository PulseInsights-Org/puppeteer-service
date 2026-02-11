#!/usr/bin/env bash
# =============================================================================
# Hook Installer — puppeteer-service
#
# Usage:
#   ./scripts/install-hooks.sh          Install pre-commit hook
#   ./scripts/install-hooks.sh --remove  Remove pre-commit hook
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HOOKS_DIR="$PROJECT_ROOT/.git/hooks"
HOOK_SOURCE="$SCRIPT_DIR/pre-commit"
HOOK_TARGET="$HOOKS_DIR/pre-commit"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# Verify we're in a git repo
if [ ! -d "$PROJECT_ROOT/.git" ]; then
    printf "${RED}${BOLD}Error:${NC} Not a git repository. Run from the project root.\n"
    exit 1
fi

# Handle --remove flag
if [ "${1:-}" = "--remove" ] || [ "${1:-}" = "uninstall" ]; then
    if [ -f "$HOOK_TARGET" ]; then
        rm "$HOOK_TARGET"
        printf "${GREEN}${BOLD}✓${NC} Pre-commit hook removed from ${HOOK_TARGET}\n"
    else
        printf "${YELLOW}${BOLD}!${NC} No pre-commit hook found at ${HOOK_TARGET}\n"
    fi
    exit 0
fi

# Verify source hook exists
if [ ! -f "$HOOK_SOURCE" ]; then
    printf "${RED}${BOLD}Error:${NC} Hook source not found at ${HOOK_SOURCE}\n"
    exit 1
fi

# Create hooks directory if it doesn't exist
mkdir -p "$HOOKS_DIR"

# Back up existing hook if it's not ours
if [ -f "$HOOK_TARGET" ]; then
    if ! grep -q "PRE-COMMIT HOOK — puppeteer-service" "$HOOK_TARGET" 2>/dev/null; then
        BACKUP="$HOOK_TARGET.backup.$(date +%Y%m%d%H%M%S)"
        cp "$HOOK_TARGET" "$BACKUP"
        printf "${YELLOW}${BOLD}!${NC} Existing hook backed up to: ${BACKUP}\n"
    fi
fi

# Copy hook and set permissions
cp "$HOOK_SOURCE" "$HOOK_TARGET"
chmod +x "$HOOK_TARGET"

printf "${GREEN}${BOLD}✓${NC} Pre-commit hook installed at ${HOOK_TARGET}\n"
printf "\n"
printf "  The hook will run automatically on ${BOLD}git commit${NC}.\n"
printf "  To bypass (emergencies only): ${BOLD}git commit --no-verify${NC}\n"
printf "\n"
printf "  Checks performed:\n"
printf "    1. Secret detection in staged files\n"
printf "    2. ESLint on staged JavaScript files\n"
printf "    3. Targeted tests for changed modules\n"
printf "    4. Coverage verification (85%% threshold)\n"
printf "\n"
