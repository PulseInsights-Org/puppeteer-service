<!-- FILE: docs/architecture-decisions.md -->
# Architecture Decisions

These are reverse-engineered architecture decisions based on analysis of the Puppeteer Service codebase. Each decision is inferred from code patterns, configuration, comments, and project structure.

---

## Introduction

This document captures the significant architectural decisions made in the Puppeteer Service. Since no formal ADR (Architecture Decision Record) process was followed during development, these decisions have been reverse-engineered from the actual code and configuration. Where the rationale is uncertain, it is labeled as an inference.

---

## Key Decisions

### 1. Express 5 as HTTP Framework

**Context:** The service needs to expose a REST API for receiving RFQ form fill requests and returning results. The API surface is small (one POST endpoint, two health probes).

**Decision:** Use Express 5.1 (`express@^5.1.0`) as the HTTP framework.

**Consequences:**
- Express 5 includes built-in async error handling, which simplifies the error middleware in routes that use `async` handlers (like `fill-rfq.js`).
- Express is the most widely adopted Node.js web framework, minimizing onboarding friction.
- The small dependency footprint keeps the Docker image lean.
- Express 5 was chosen over alternatives like Fastify or Koa, likely for familiarity and ecosystem maturity.

**Evidence in Code:**
- `package.json`: `"express": "^5.1.0"`
- `server.js`: Standard Express app setup with middleware chain
- `src/index.js`, `src/routes/fill-rfq.js`: Express Router usage

---

### 2. Suffix-Based DOM Matching for ASP.NET Forms

**Context:** The target RFQ forms are ASP.NET Web Forms that use server-side controls (repeaters, form fields). ASP.NET generates element IDs with long prefixes like `ctl00_ContentPlaceHolder1_rptItems_ctl01_txtNEQty1`. These prefixes vary across deployments and are not predictable. However, the suffixes (e.g., `txtNEQty1`) are consistent.

**Decision:** Use suffix-based matching: query all elements of a given type (`input`, `select`, `textarea`), filter by ID suffix, and select by array index (corresponding to the repeater row).

**Consequences:**
- Robust against different ASP.NET control tree depths and naming containers.
- Relies on the assumption that suffix conventions are stable across form versions.
- More complex than simple `document.getElementById()` but necessary for dynamically-generated IDs.
- The index-based approach correctly handles repeater rows (item 0 = first row, item 1 = second row, etc.).

**Evidence in Code:**
- `src/services/form-filler.js`: `fillRepeaterFieldBySuffix()`, `selectDropdownBySuffix()`, `clickElementBySuffix()` -- all filter by `el.id.endsWith(suffix)` and select by index
- JSDoc comment: "suffix-based matching for ASP.NET forms"
- Field suffixes: `txtNEQty1`, `ddlNETraceability1`, `rbOutrightNE1`, etc.

---

### 3. In-Memory Idempotency Store

**Context:** Production form submissions have real-world consequences (the quote is actually submitted to the buyer). Duplicate submissions caused by retries, network issues, or upstream bugs must be prevented.

**Decision:** Implement idempotency using an in-memory JavaScript `Map` with composite keys (`{rfqId}:{mode}:{formUrl}`), a 24-hour TTL, and hourly cleanup.

**Consequences:**
- Simple, zero-dependency implementation with no external infrastructure.
- **Loss of state on process restart.** If PM2 restarts the process, all idempotency records are lost. The code explicitly acknowledges this: `"In production, consider using Redis or similar for distributed deployments"`.
- Adequate for a single-instance deployment on a T2 nano where the service processes requests sequentially.
- Test mode keys and production mode keys are separate (mode is embedded in the key), so test runs don't block production submissions.

**Evidence in Code:**
- `src/services/idempotency.js`: `const idempotencyStore = new Map()`
- Comment: `"In production, consider using Redis or similar for distributed deployments"`
- Key format: `${rfqId}:${mode}:${formUrl}`
- `IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000`
- `cleanupInterval.unref()` to avoid preventing process exit

---

### 4. Direct Supabase Upload (No Local File I/O)

**Context:** Screenshots of filled forms serve as evidence/audit trail. They need to be stored persistently and be accessible via URL for downstream display.

**Decision:** Capture screenshots as in-memory PNG buffers and upload directly to Supabase Storage via the REST API. No intermediate local file is written.

**Consequences:**
- Eliminates disk I/O, which is important on memory-constrained instances where disk may be slow (EBS gp2/gp3).
- Avoids the need for local file cleanup logic.
- Depends on Supabase availability -- if Supabase is down, the screenshot upload fails and the request fails.
- Screenshots are organized by RFQ ID: `screenshots/{rfqId}/rfq-{type}-{timestamp}.png`.
- Uses the Supabase service role key for authentication (bypasses RLS).

**Evidence in Code:**
- `src/services/screenshot.js`: `page.screenshot()` returns a Buffer, which is passed directly to `fetch()` as the request body
- No `fs.writeFile` or temporary file creation anywhere in the screenshot path
- Upload URL: `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`

---

### 5. Single-Process Chrome on Constrained Hardware

**Context:** The service runs on EC2 T2 nano instances with 512 MB RAM and 1 vCPU. Standard Puppeteer configurations can easily consume 500+ MB for a single browser instance.

**Decision:** Launch Chrome with aggressive memory optimization flags: `--single-process`, `--memory-pressure-off`, `--disable-dev-shm-usage`, `--disable-gpu`, `--disable-extensions`, `--disable-background-networking`, and more. One browser per request with no pooling.

**Consequences:**
- Fits within the 512 MB RAM constraint when combined with `NODE_OPTIONS=--max-old-space-size=256`.
- `--single-process` means a renderer crash takes down the entire browser, but this is acceptable since each request gets a fresh browser anyway.
- No browser pooling means every request incurs full browser startup cost (several seconds), but this is acceptable for the expected low throughput (RFQ responses are not time-critical to the second).
- The `--disable-dev-shm-usage` flag is critical for Docker/EC2 where `/dev/shm` may be small.

**Evidence in Code:**
- `src/services/browser.js`: Launch args array with 15+ Chrome flags
- `Dockerfile` comment: `"Optimized for EC2 T2 Nano (512MB RAM, 1 vCPU)"`
- `README.md`: recommends `NODE_OPTIONS=--max-old-space-size=256`

---

### 6. Dual Mode Operation (Test vs. Production)

**Context:** During development and testing, the system needs to verify form filling without actually submitting quotes to buyers. But in production, forms must be submitted.

**Decision:** The upstream caller (RFQ Ingest Service) controls the mode via the `isTestMode` boolean flag in the request body. `isTestMode=true` fills the form and then cancels it (click Cancel button or press Escape). `isTestMode=false` fills the form and clicks Submit.

**Consequences:**
- The Puppeteer Service has no opinion about when to use test vs. production mode -- it's entirely controlled by the caller.
- Test mode provides full end-to-end validation of the form fill pipeline without side effects.
- Idempotency keys include the mode, so a test fill doesn't prevent a subsequent production fill for the same RFQ.
- The `isTestMode` flag defaults to `true` in the route handler (`const { isTestMode = true } = req.body`), making the safe option the default.

**Evidence in Code:**
- `src/routes/fill-rfq.js`: `const { isTestMode = true } = req.body` (defaults to test mode)
- `src/services/form-filler.js`: `cancelFormSubmission()` and `submitForm()` as separate functions
- `src/services/idempotency.js`: `const mode = isTestMode ? 'test' : 'prod'` in key generation

---

### 7. Navigation Retry with Fresh Pages

**Context:** Target RFQ form websites can be slow, unreliable, or intermittently available. A single navigation failure should not fail the entire request.

**Decision:** Implement a 3-attempt retry loop for page navigation. On each failure, close the current page, create a fresh page via `setupPage()`, wait 3 seconds, and retry.

**Consequences:**
- Tolerates transient network issues and slow-loading forms.
- Creating a fresh page on each retry avoids stale browser state.
- After 3 failures, the request fails with a descriptive error message.
- Navigation timeout is 120 seconds per attempt, with a 60-second `waitForNetworkIdle` timeout (non-fatal).

**Evidence in Code:**
- `src/routes/fill-rfq.js`: `for (let attempt = 1; attempt <= 3; attempt++)` loop
- On failure: `await page.close()`, `page = await setupPage(browser, requestId)`, `await delay(3000)`
- `page.goto(url, { waitUntil: 'load', timeout: 120000 })`

---

### 8. Structured Logging with Environment-Aware Formatting

**Context:** The service needs to produce logs that are useful for debugging in development and machine-parseable in production (for log aggregation).

**Decision:** Implement a custom logger that outputs human-readable format in development and JSON in production. Log level is configurable via environment variable.

**Consequences:**
- No dependency on a logging library (winston, pino, etc.), keeping the dependency tree small.
- JSON logs in production are easy to parse with CloudWatch, Datadog, or similar.
- Human-readable format in development with `[timestamp] [PUPPETEER] [LEVEL] message {meta}` is developer-friendly.
- The custom implementation is simple but lacks features like log rotation, transport plugins, or correlation IDs (though `requestId` is passed as metadata).

**Evidence in Code:**
- `src/utils/logger.js`: `IS_PRODUCTION ? JSON.stringify(entry) : formatted string`
- `LOG_LEVELS` object with numeric ordering
- `PUPPETEER_LOG_LEVEL` env var support

---

### 9. GitHub Actions CI/CD with SSH Deployment

**Context:** The service needs automated testing and deployment to EC2.

**Decision:** Use GitHub Actions with a 4-job pipeline: lint, unit tests (with coverage gate), integration tests, and SSH-based deployment to EC2 via `appleboy/ssh-action`.

**Consequences:**
- Simple and straightforward deployment model -- `git pull`, `npm install`, `pm2 restart`.
- No container registry, Kubernetes, or complex orchestration needed.
- The deploy step uses `git reset --hard origin/main`, which is a destructive operation but appropriate for a CI-controlled deployment.
- Coverage is enforced at 85% (branches) and 93% (functions, lines, statements) -- CI fails if thresholds aren't met.
- Lint and integration tests run in parallel after the lint job, reducing total pipeline time.

**Evidence in Code:**
- `.github/workflows/deploy.yml`: Complete workflow definition
- `jest.config.js`: `coverageThreshold` configuration
- Deploy step: `appleboy/ssh-action@v1.0.3` with `git fetch`, `git reset --hard`, `npm install`, `pm2 restart`

---

### 10. Custom Pre-Commit Hook with Multi-Phase Validation

**Context:** Code quality needs to be enforced before code reaches the remote repository. Standard tools like Husky were not used.

**Decision:** Implement a custom bash pre-commit hook (`scripts/pre-commit`) with 4 phases: secret detection, ESLint, targeted tests, and coverage verification. The hook is installed via a companion script (`scripts/install-hooks.sh`).

**Consequences:**
- Catches secrets, lint errors, test failures, and coverage regressions before they reach CI.
- The targeted test approach (`jest --findRelatedTests`) only runs tests related to changed files, keeping pre-commit fast.
- The custom implementation provides polished UX with box-drawn failure messages and numbered next steps.
- No dependency on Husky, lint-staged, or other Node.js pre-commit tools.
- Emergency bypass available via `git commit --no-verify`.

**Evidence in Code:**
- `scripts/pre-commit`: 326-line bash script with 4 phases
- `scripts/install-hooks.sh`: Hook installer with backup of existing hooks
- `scripts/change-summary.sh`: PR description generator with risk assessment
- `package.json`: `"hooks:install"`, `"hooks:uninstall"`, `"precommit"` scripts
