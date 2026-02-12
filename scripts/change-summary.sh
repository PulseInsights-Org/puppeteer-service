#!/usr/bin/env bash
# =============================================================================
# Change Summary Generator — puppeteer-service
#
# Produces a structured, markdown-formatted summary of changes suitable for
# PR descriptions and code review context.
#
# Usage:
#   ./scripts/change-summary.sh                  Compare HEAD against main
#   ./scripts/change-summary.sh --base=HEAD~3    Compare against specific ref
#   ./scripts/change-summary.sh --base=develop   Compare against a branch
# =============================================================================

set -eo pipefail

# ── Parse Arguments ──────────────────────────────────────────

BASE_BRANCH="main"

for arg in "$@"; do
    case $arg in
        --base=*)
            BASE_BRANCH="${arg#*=}"
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--base=<ref>]"
            echo ""
            echo "Options:"
            echo "  --base=<ref>    Base branch/ref to compare against (default: main)"
            echo ""
            echo "Examples:"
            echo "  $0                    # Compare against main"
            echo "  $0 --base=HEAD~3      # Compare last 3 commits"
            echo "  $0 --base=develop     # Compare against develop"
            exit 0
            ;;
    esac
done

# ── Verify git state ────────────────────────────────────────

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")

# Check if base exists
if ! git rev-parse "$BASE_BRANCH" > /dev/null 2>&1; then
    echo "Error: Base ref '$BASE_BRANCH' not found."
    echo "Available branches:"
    git branch --list | head -10
    exit 1
fi

# ── Gather Data ──────────────────────────────────────────────

COMMIT_COUNT=$(git rev-list --count "${BASE_BRANCH}..HEAD" 2>/dev/null || echo "0")
DIFF_STAT=$(git diff --stat "${BASE_BRANCH}...HEAD" 2>/dev/null || echo "")
DIFF_SHORTSTAT=$(git diff --shortstat "${BASE_BRANCH}...HEAD" 2>/dev/null || echo "no changes")
CHANGED_FILES=$(git diff --name-status "${BASE_BRANCH}...HEAD" 2>/dev/null || echo "")
COMMIT_LOG=$(git log --oneline "${BASE_BRANCH}..HEAD" 2>/dev/null || echo "No commits")

# ── Categorize Files ─────────────────────────────────────────

declare -a HIGH_RISK_FILES=()
declare -a MEDIUM_RISK_FILES=()
declare -a LOW_RISK_FILES=()
declare -a INFO_FILES=()

while IFS=$'\t' read -r status file; do
    [ -z "$file" ] && continue

    # Get line counts
    LINE_CHANGE=$(git diff --numstat "${BASE_BRANCH}...HEAD" -- "$file" 2>/dev/null | awk '{print "+"$1" / -"$2}')
    [ -z "$LINE_CHANGE" ] && LINE_CHANGE="(binary or new)"

    case "$file" in
        src/routes/*|src/services/form-filler.js|src/services/browser.js)
            HIGH_RISK_FILES+=("$status|$file|$LINE_CHANGE")
            ;;
        src/services/*|src/middleware/*)
            MEDIUM_RISK_FILES+=("$status|$file|$LINE_CHANGE")
            ;;
        tests/*|*.test.js)
            LOW_RISK_FILES+=("$status|$file|$LINE_CHANGE")
            ;;
        *)
            INFO_FILES+=("$status|$file|$LINE_CHANGE")
            ;;
    esac
done <<< "$CHANGED_FILES"

# ── Helper: Status Label ────────────────────────────────────

status_label() {
    case "$1" in
        A) echo "New" ;;
        M) echo "Modified" ;;
        D) echo "Deleted" ;;
        R*) echo "Renamed" ;;
        C*) echo "Copied" ;;
        *) echo "$1" ;;
    esac
}

# ── Generate Output ──────────────────────────────────────────

cat << HEADER
## Change Summary — puppeteer-service

**Branch:** ${CURRENT_BRANCH}
**Base:** ${BASE_BRANCH}
**Commits:** ${COMMIT_COUNT}
**Diff:** ${DIFF_SHORTSTAT}

---

### Commit History

\`\`\`
${COMMIT_LOG}
\`\`\`

---

### Risk Assessment

HEADER

# High Risk
if [ ${#HIGH_RISK_FILES[@]} -gt 0 ]; then
    echo "**🔴 HIGH** — Production-critical code modified"
    for entry in "${HIGH_RISK_FILES[@]}"; do
        IFS='|' read -r status file lines <<< "$entry"
        echo "  - \`${file}\` ($(status_label "$status"), ${lines})"
    done
    echo ""
fi

# Medium Risk
if [ ${#MEDIUM_RISK_FILES[@]} -gt 0 ]; then
    echo "**🟡 MEDIUM** — Service/middleware changes"
    for entry in "${MEDIUM_RISK_FILES[@]}"; do
        IFS='|' read -r status file lines <<< "$entry"
        echo "  - \`${file}\` ($(status_label "$status"), ${lines})"
    done
    echo ""
fi

# Low Risk
if [ ${#LOW_RISK_FILES[@]} -gt 0 ]; then
    echo "**🟢 LOW** — Test-only changes"
    for entry in "${LOW_RISK_FILES[@]}"; do
        IFS='|' read -r status file lines <<< "$entry"
        echo "  - \`${file}\` ($(status_label "$status"), ${lines})"
    done
    echo ""
fi

# Info
if [ ${#INFO_FILES[@]} -gt 0 ]; then
    echo "**ℹ️  INFO** — Config/docs/tooling"
    for entry in "${INFO_FILES[@]}"; do
        IFS='|' read -r status file lines <<< "$entry"
        echo "  - \`${file}\` ($(status_label "$status"), ${lines})"
    done
    echo ""
fi

# No changes case
TOTAL_FILES=$(( ${#HIGH_RISK_FILES[@]} + ${#MEDIUM_RISK_FILES[@]} + ${#LOW_RISK_FILES[@]} + ${#INFO_FILES[@]} ))
if [ "$TOTAL_FILES" -eq 0 ]; then
    echo "**✅ No changes** — Branch is up to date with ${BASE_BRANCH}"
    echo ""
fi

# ── Changes by File Table ────────────────────────────────────

cat << TABLE_HEADER

---

### Changes by File

| File | Status | Lines Changed |
|------|--------|---------------|
TABLE_HEADER

ALL_FILES=("${HIGH_RISK_FILES[@]}" "${MEDIUM_RISK_FILES[@]}" "${LOW_RISK_FILES[@]}" "${INFO_FILES[@]}")

for entry in "${ALL_FILES[@]}"; do
    [ -z "$entry" ] && continue
    IFS='|' read -r status file lines <<< "$entry"
    echo "| \`${file}\` | $(status_label "$status") | ${lines} |"
done

# ── Testing Impact ───────────────────────────────────────────

cat << TESTING_HEADER

---

### Testing Impact

TESTING_HEADER

# Check which source files have corresponding tests
HAS_UNTESTED=false
for entry in "${HIGH_RISK_FILES[@]}" "${MEDIUM_RISK_FILES[@]}"; do
    [ -z "$entry" ] && continue
    IFS='|' read -r status file lines <<< "$entry"

    # Map source file to test file
    TEST_FILE=""
    case "$file" in
        src/utils/validation.js) TEST_FILE="tests/unit/validation.test.js" ;;
        src/utils/logger.js) TEST_FILE="tests/unit/logger.test.js" ;;
        src/middleware/rate-limiter.js) TEST_FILE="tests/unit/rate-limiter.test.js" ;;
        src/services/browser.js) TEST_FILE="tests/unit/services/browser.test.js" ;;
        src/services/form-filler.js) TEST_FILE="tests/unit/services/form-filler.test.js" ;;
        src/services/screenshot.js) TEST_FILE="tests/unit/services/screenshot.test.js" ;;
        src/services/idempotency.js) TEST_FILE="tests/idempotency.test.js" ;;
        src/routes/fill-rfq.js) TEST_FILE="tests/integration/endpoints.test.js" ;;
        src/index.js) TEST_FILE="tests/integration/endpoints.test.js" ;;
        server.js) TEST_FILE="tests/integration/endpoints.test.js" ;;
    esac

    if [ -n "$TEST_FILE" ]; then
        # Check if test file is also in the diff
        if echo "$CHANGED_FILES" | grep -q "$TEST_FILE"; then
            echo "- ✅ \`${file}\` — test file also updated (\`${TEST_FILE}\`)"
        else
            echo "- ⚠️  \`${file}\` — source changed but test file NOT updated (\`${TEST_FILE}\`)"
            HAS_UNTESTED=true
        fi
    else
        echo "- ❓ \`${file}\` — no mapped test file found"
        HAS_UNTESTED=true
    fi
done

if [ ${#LOW_RISK_FILES[@]} -gt 0 ]; then
    echo ""
    echo "**New/updated test files:**"
    for entry in "${LOW_RISK_FILES[@]}"; do
        IFS='|' read -r status file lines <<< "$entry"
        echo "- \`${file}\` (${lines})"
    done
fi

# ── Review Checklist ─────────────────────────────────────────

cat << CHECKLIST_HEADER

---

### Review Checklist

CHECKLIST_HEADER

echo "- [ ] All changed source files have corresponding test updates"
echo "- [ ] No secrets, credentials, or API keys in the diff"
echo "- [ ] Error handling covers new code paths"

if [ ${#HIGH_RISK_FILES[@]} -gt 0 ]; then
    echo "- [ ] **HIGH RISK:** Production form submission logic verified"
    echo "- [ ] **HIGH RISK:** Browser automation changes tested manually"
fi

if echo "$CHANGED_FILES" | grep -q "idempotency"; then
    echo "- [ ] Idempotency key generation is deterministic"
    echo "- [ ] Duplicate prevention works for both test and production mode"
fi

if echo "$CHANGED_FILES" | grep -q "rate-limiter"; then
    echo "- [ ] Rate limiting thresholds are appropriate for production load"
fi

echo ""
echo "---"
echo ""
echo "*Generated by \`npm run change-summary\` on $(date -u +"%Y-%m-%d %H:%M UTC")*"
