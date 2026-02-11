# Puppeteer Service — Quality Engineering Plan

> **Owner:** Quality Engineering / Staff SWE
> **Service:** `puppeteer-service` — Standalone Puppeteer RFQ form automation
> **Branch:** `feature/idempotency-form-submissions`
> **Baseline coverage (measured):** 28.27% statements, 25.66% branches, 27.9% functions, 28.43% lines
> **Target coverage:** ≥ 85% across all four axes

---

## Table of Contents

1. [Repo-Wide Testing Strategy & Detailed Test Suite Plan](#1-repo-wide-testing-strategy--detailed-test-suite-plan)
2. [P0 / P1 / P2 Implementation Roadmap](#2-p0--p1--p2-implementation-roadmap)
3. [Coverage Gating — 85% Minimum](#3-coverage-gating--85-minimum)
4. [Pre-Commit Hook Design](#4-pre-commit-hook-design)
5. [Change Summary Script Spec](#5-change-summary-script-spec)
6. [Database / Schema Changes](#6-database--schema-changes)

---

## 1. Repo-Wide Testing Strategy & Detailed Test Suite Plan

### 1.1 Testing Pyramid

```
                    ┌─────────────┐
                    │   E2E (few) │   Real browser against local fixture HTML
                    ├─────────────┤
                 ┌──┴─────────────┴──┐
                 │  Integration (mid) │  HTTP → Express → Mocked Puppeteer
                 ├───────────────────┤
              ┌──┴───────────────────┴──┐
              │      Unit (majority)     │  Pure functions, isolated services
              └─────────────────────────┘
```

| Layer | Run Command | Approx Runtime | % of Tests |
|-------|-------------|----------------|------------|
| Unit | `npm run test:unit` | < 5 s | 70% |
| Integration | `npm run test:integration` | < 10 s | 25% |
| E2E (smoke) | `npm run test:e2e` | < 30 s | 5% |

### 1.2 Current Coverage Gap Analysis

| File | Stmts Now | Target | Gap Root Cause |
|------|-----------|--------|----------------|
| `src/index.js` | 0% | 90%+ | Excluded by jest config `testPathIgnorePatterns` for integration |
| `src/routes/fill-rfq.js` | 0% | 85%+ | Integration test mocks bypass actual route; need direct route-level tests |
| `src/services/browser.js` | 2.2% | 85%+ | Puppeteer mock not providing coverage to the real module |
| `src/services/form-filler.js` | 1.5% | 85%+ | Same mocking issue — tests call through mock, not real code |
| `src/services/idempotency.js` | 79.6% | 90%+ | Missing: cleanup(), expired TTL branch, edge cases |
| `src/services/screenshot.js` | 97.3% | 98%+ | Near-complete; missing validateSupabaseConfig false → return path |
| `src/middleware/rate-limiter.js` | 84.6% | 90%+ | Missing: cleanup interval code (lines 46-49) |
| `src/utils/logger.js` | 100% | 100% | Done |
| `src/utils/validation.js` | 100% | 100% | Done |

### 1.3 Detailed Test Suite Plan

#### A. Unit Tests — `tests/unit/`

**`tests/unit/services/browser.test.js`** (currently skipped in jest config)
- Fix: Remove from `testPathIgnorePatterns`; tests already mock `puppeteer` correctly
- Coverage targets: `launchBrowser` (production args vs dev args), `setupPage`, `closeBrowser`, `closeAllBrowsers`, shutdown state
- Missing branches: `IS_PRODUCTION` true path, `CHROME_PATH` undefined path, browser `disconnected` event handler, `closeAllBrowsers` error catch

**`tests/unit/services/form-filler.test.js`** (currently runs but mocking prevents real coverage)
- Issue: `jest.resetModules()` + `require()` in `beforeEach` means module coverage is captured, but the mock `page` objects mean `page.evaluate()` callbacks (lines 23-51, etc.) are browser-context code not measurable by Node coverage
- Strategy: Keep existing behavioral tests; add targeted tests for:
  - `fillInputBySuffix` — the `hasExact` === true branch vs suffix-search branch
  - `fillTextareaBySuffix` — null/falsy value early return
  - `selectDropdownBySuffix` — `actualId` null fallback
  - `submitForm` — success path, no-submit-button path, context-destroyed path, generic error path
  - `cancelFormSubmission` — already well-covered

**`tests/unit/services/idempotency.test.js`**
- Add: expired key TTL test (`checkIdempotency` returning null after 24h)
- Add: `cleanup()` function test (directly invoke exported or module-internal cleanup)
- Add: `markCompleted` / `markFailed` when key doesn't exist (no-op branch)

**`tests/unit/services/screenshot.test.js`**
- Already 97%+; add trailing-slash normalization edge case for `SUPABASE_URL`

**`tests/unit/middleware/rate-limiter.test.js`**
- Add: cleanup interval test using fake timers to verify expired entries are removed (lines 46-49)

#### B. Integration Tests — `tests/integration/`

**`tests/integration/endpoints.test.js`** (currently excluded by jest config)
- Fix: Add `npm run test:integration` to CI pipeline alongside unit tests
- Missing scenarios to add:
  - Production mode form submission (isTestMode=false) success path
  - Production mode form submission failure (submitForm returns false)
  - Idempotency: duplicate request → 409 response
  - Idempotency: completed production request → cached 200 response
  - Idempotency: failed request retry → allowed
  - Concurrent request race condition → 409
  - `keepOpen` flag behavior
  - Navigation retry logic (first attempt fails, second succeeds)
  - Screenshot upload failure during form fill

#### C. E2E Smoke Tests — `tests/e2e/` (new)

**`tests/e2e/form-fill-smoke.test.js`**
- Use a local static HTML fixture file mimicking an ASP.NET form
- Launch real Puppeteer (headless)
- Verify fields are filled, screenshot is captured (skip Supabase upload)
- Gated behind `npm run test:e2e`, not included in default `npm test`

### 1.4 Test Naming Convention

```
tests/
├── unit/
│   ├── utils/
│   │   ├── validation.test.js
│   │   └── logger.test.js
│   ├── middleware/
│   │   └── rate-limiter.test.js
│   └── services/
│       ├── browser.test.js
│       ├── form-filler.test.js
│       ├── screenshot.test.js
│       └── idempotency.test.js
├── integration/
│   └── endpoints.test.js
├── e2e/
│   └── form-fill-smoke.test.js
├── fixtures/
│   └── rfq-form.html          ← static HTML fixture for E2E
└── setup.js
```

### 1.5 Mocking Strategy

| Dependency | Unit Test Mock | Integration Test Mock |
|------------|---------------|----------------------|
| `puppeteer` | `jest.mock('puppeteer')` | `jest.mock('../../src/services/browser')` |
| `global.fetch` (Supabase) | `global.fetch = jest.fn()` | `jest.mock('../../src/services/screenshot')` |
| `crypto.randomUUID` | Not mocked (available in Node 18+) | Not mocked |
| `process.env` | Scoped `process.env = {...}` per test | Set in `tests/setup.js` |

---

## 2. P0 / P1 / P2 Implementation Roadmap

### P0 — Critical (Ship blockers — implement immediately)

| # | Task | Rationale | Effort |
|---|------|-----------|--------|
| P0-1 | **Fix jest config to include browser.test.js** | Currently `testPathIgnorePatterns` excludes this file, leaving `browser.js` at 2% coverage | XS |
| P0-2 | **Add `npm run test:all` script** combining unit + integration | CI only runs `npm test` which skips integration tests entirely — integration tests never run in pipeline | S |
| P0-3 | **Enable coverage thresholds in jest config** | No coverage gating exists — regressions silently pass CI | S |
| P0-4 | **Add coverage gating to CI/CD pipeline** | `deploy.yml` runs `npm test` but never checks coverage — broken code can deploy | S |
| P0-5 | **Install pre-commit hook** to catch issues locally before push | No client-side guardrails — all quality gates are server-side | M |
| P0-6 | **Add ESLint with security rules** | No static analysis — potential OWASP issues (the `--disable-web-security` flag is dev-only but not validated) | M |

### P1 — High (Quality gates — implement within 1 sprint)

| # | Task | Rationale | Effort |
|---|------|-----------|--------|
| P1-1 | **Write missing integration tests** for idempotency HTTP flows | Idempotency is the newest feature; no integration-level verification of 409/cached responses | M |
| P1-2 | **Write submitForm unit tests** | `submitForm()` is production-critical (actually submits quotes) but has 0% unit coverage | M |
| P1-3 | **Add production mode integration tests** (isTestMode=false) | All current integration tests only exercise test mode — production submit path is untested | M |
| P1-4 | **Add change summary script** for PR descriptions | No automated way to generate code review context | S |
| P1-5 | **Add coverage badge to README** | No visibility into coverage health at a glance | XS |

### P2 — Medium (Hardening — implement within 2 sprints)

| # | Task | Rationale | Effort |
|---|------|-----------|--------|
| P2-1 | **E2E smoke test** with local HTML fixture | No tests verify real Puppeteer behavior end-to-end | L |
| P2-2 | **Add `helmet` security headers** to Express app | Basic HTTP security headers are missing | S |
| P2-3 | **Add request payload size fuzzing tests** | The 10MB body limit isn't tested for rejection of oversized payloads | S |
| P2-4 | **Add memory leak detection** in CI (--detectOpenHandles + process memory assertions) | Current tests leak timers/handles (Jest warns about force-exit) | M |
| P2-5 | **Add Dependabot/Renovate** for dependency updates | No automated dependency management | S |
| P2-6 | **Add structured error codes** (ERR_VALIDATION, ERR_BROWSER_LAUNCH, etc.) | Error messages are strings — harder for upstream services to programmatically handle | M |

---

## 3. Coverage Gating — 85% Minimum

### 3.1 Jest Configuration

Coverage thresholds are enforced at two levels:

**Global thresholds** (fail CI if overall coverage drops below):
```javascript
coverageThreshold: {
  global: {
    branches: 85,
    functions: 85,
    lines: 85,
    statements: 85
  }
}
```

**Per-file thresholds** for critical paths:
```javascript
coverageThreshold: {
  './src/services/idempotency.js': { branches: 90, functions: 95, lines: 90, statements: 90 },
  './src/utils/validation.js':     { branches: 95, functions: 100, lines: 95, statements: 95 },
  './src/routes/fill-rfq.js':      { branches: 80, functions: 85, lines: 85, statements: 85 }
}
```

### 3.2 CI Pipeline Integration

```yaml
# In deploy.yml - test job
- name: Run tests with coverage
  run: npm run test:ci

- name: Check coverage thresholds
  run: npm run test:coverage -- --coverageThreshold='{"global":{"branches":85,"functions":85,"lines":85,"statements":85}}'
```

### 3.3 Coverage Reporting

- **Local:** `npm run test:coverage` generates HTML report in `coverage/`
- **CI:** Coverage summary printed to stdout; thresholds enforced by Jest
- **PR:** Change summary script (Section 5) includes coverage delta

### 3.4 Ratcheting Strategy

As coverage improves, the thresholds should be raised:
1. Start at 85% global (from current 28%)
2. After P0/P1 work, raise to 88%
3. After P2 work, raise to 90%
4. Never lower thresholds — only raise or hold

---

## 4. Pre-Commit Hook Design

### 4.1 Architecture

```
git commit
    │
    ▼
.git/hooks/pre-commit (shell script)
    │
    ├─ Phase 1: STAGED FILE ANALYSIS
    │   └─ Categorize changed files (src/, tests/, config, docs)
    │
    ├─ Phase 2: LINT (fast, < 3s)
    │   └─ ESLint on staged .js files only
    │   └─ On failure: print exact lint errors + fix command
    │
    ├─ Phase 3: TARGETED TESTS (< 15s)
    │   ├─ Map changed src/ files → related test files
    │   ├─ Run only those test files (jest --findRelatedTests)
    │   └─ On failure: print failed test names + rerun command
    │
    ├─ Phase 4: COVERAGE CHECK (< 20s)
    │   └─ Run jest --coverage on targeted files
    │   └─ Parse JSON output, verify ≥ 85%
    │   └─ On failure: print file-by-file coverage table + which files need tests
    │
    └─ Phase 5: SECURITY SCAN (< 2s)
        └─ Grep staged files for secrets patterns (.env values, API keys)
        └─ On failure: print exact file:line with match + remediation steps
```

### 4.2 Failure Output Format

Each phase failure produces a human-readable block:

```
╔══════════════════════════════════════════════════════════════╗
║  PRE-COMMIT FAILED: Phase 2 — Lint Errors                  ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  src/services/browser.js                                     ║
║    Line 42:  'unused' is defined but never used  (no-unused) ║
║    Line 87:  Missing semicolon                   (semi)      ║
║                                                              ║
║  ┌──────────────────────────────────────────────────────┐    ║
║  │  NEXT STEPS:                                         │    ║
║  │  1. Run: npx eslint src/services/browser.js --fix    │    ║
║  │  2. Stage fixes: git add src/services/browser.js     │    ║
║  │  3. Retry: git commit                                │    ║
║  └──────────────────────────────────────────────────────┘    ║
║                                                              ║
║  To skip (emergencies only): git commit --no-verify          ║
╚══════════════════════════════════════════════════════════════╝
```

### 4.3 Targeted Test Mapping

The hook maps source files to test files:

```
src/utils/validation.js     → tests/unit/validation.test.js
src/utils/logger.js         → tests/unit/logger.test.js
src/middleware/rate-limiter.js → tests/unit/rate-limiter.test.js
src/services/browser.js     → tests/unit/services/browser.test.js
src/services/form-filler.js → tests/unit/services/form-filler.test.js
src/services/screenshot.js  → tests/unit/services/screenshot.test.js
src/services/idempotency.js → tests/idempotency.test.js
src/routes/fill-rfq.js      → tests/integration/endpoints.test.js
src/index.js                → tests/integration/endpoints.test.js
server.js                   → tests/integration/endpoints.test.js
```

If only test files changed → skip test execution, just lint.
If only docs/config changed → skip entirely.

### 4.4 Performance Budget

| Phase | Max Time | Skip Condition |
|-------|----------|----------------|
| Staged analysis | 0.1s | Never |
| Lint | 3s | No .js files staged |
| Targeted tests | 15s | No src/ or test/ files staged |
| Coverage check | 20s | No src/ files staged |
| Secret scan | 2s | No files staged |
| **Total max** | **~40s** | |

### 4.5 Installation

```bash
npm run hooks:install    # Copies hook to .git/hooks/pre-commit, sets +x
npm run hooks:uninstall  # Removes the hook
```

---

## 5. Change Summary Script Spec

### 5.1 Purpose

Generate a structured, human-readable summary of changes suitable for:
- PR descriptions
- Code review context
- Changelog entries

### 5.2 Invocation

```bash
npm run change-summary              # Compare HEAD against main
npm run change-summary -- --base=HEAD~3  # Compare against specific ref
```

### 5.3 Output Format

```markdown
## Change Summary — puppeteer-service

**Branch:** feature/idempotency-form-submissions
**Commits:** 3 (since main)
**Files changed:** 7 | +412 / -28 lines

### Risk Assessment
🔴 HIGH — Production form submission logic modified
   └─ src/routes/fill-rfq.js (+89 lines)

🟡 MEDIUM — New service added
   └─ src/services/idempotency.js (new file, 177 lines)

🟢 LOW — Test-only changes
   └─ tests/idempotency.test.js (new file)

### Changes by Category

**Features:**
- Added idempotency handling for form submissions (prevents duplicate production submissions)
- Added test mode support for conditional form submission (isTestMode flag)

**Files Modified:**
| File | Change | Lines | Coverage |
|------|--------|-------|----------|
| src/routes/fill-rfq.js | Modified | +89 / -12 | Needs integration test |
| src/services/idempotency.js | New | +177 | 79.6% |
| tests/idempotency.test.js | New | +173 | N/A (test file) |

### Testing Impact
- New test file: tests/idempotency.test.js (25 tests)
- Coverage delta: +2.3% overall
- Untested paths: fill-rfq.js idempotency integration, concurrent race condition

### Review Checklist
- [ ] Idempotency key generation is deterministic and collision-free
- [ ] Production mode prevents re-submission (verify 409 path)
- [ ] Test mode allows retry (verify removeKey path)
- [ ] In-memory store has TTL cleanup (verify 24h expiry)
- [ ] No secrets or credentials in diff
```

### 5.4 Implementation Details

The script:
1. Runs `git diff --stat` and `git log --oneline` against the base branch
2. Categorizes files by directory and change type (new/modified/deleted)
3. Assigns risk levels based on:
   - `src/routes/` or `src/services/` changes → HIGH if production logic
   - `src/middleware/` or `src/utils/` → MEDIUM
   - `tests/` only → LOW
   - Config/docs only → INFO
4. Cross-references changed source files against test files to flag untested changes
5. Generates a review checklist based on the modules touched

---

## 6. Database / Schema Changes

### 6.1 Current State

This service has **no traditional database**. Data persistence is:

| Store | Type | Location | TTL |
|-------|------|----------|-----|
| Idempotency records | In-memory `Map` | `src/services/idempotency.js` | 24 hours |
| Rate limit counters | In-memory `Map` | `src/middleware/rate-limiter.js` | Per-window (60s default) |
| Screenshots | Object storage | Supabase Storage → `rfq-artifacts` bucket | Permanent |

### 6.2 Required Changes: None

No database or schema changes are required for the quality infrastructure work. All changes are:
- Jest configuration (coverage thresholds)
- CI/CD workflow (coverage gating steps)
- Git hooks (pre-commit script)
- Developer tooling (ESLint, change-summary script)
- npm scripts (new commands in package.json)

### 6.3 Future Considerations (Not in Scope)

If the service scales beyond a single instance, the in-memory stores will need migration:

| Current | Future | Trigger |
|---------|--------|---------|
| In-memory idempotency Map | Redis / DynamoDB | Multi-instance deployment |
| In-memory rate-limit Map | Redis / API Gateway throttling | Multi-instance deployment |
| Supabase Storage (screenshots) | No change needed | Already external |

These are architectural decisions for a future sprint and do **not** affect the quality engineering work described in this plan.

---

## Appendix A: Files Created by This Plan

| File | Purpose |
|------|---------|
| `QUALITY_PLAN.md` | This document |
| `scripts/pre-commit` | Pre-commit hook shell script |
| `scripts/change-summary.sh` | Change summary generator |
| `scripts/install-hooks.sh` | Hook installation helper |
| `.eslintrc.json` | ESLint configuration |
| `.github/workflows/deploy.yml` | Updated CI with coverage gating |
| `jest.config.js` | Updated with coverage thresholds |
| `package.json` | Updated with new npm scripts |

## Appendix B: Files NOT Modified (Source Code)

The following files are explicitly **not touched**:
- `server.js`
- `src/index.js`
- `src/routes/fill-rfq.js`
- `src/services/browser.js`
- `src/services/form-filler.js`
- `src/services/screenshot.js`
- `src/services/idempotency.js`
- `src/middleware/rate-limiter.js`
- `src/utils/logger.js`
- `src/utils/validation.js`
- All existing test files under `tests/`
