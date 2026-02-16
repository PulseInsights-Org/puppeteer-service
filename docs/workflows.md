<!-- FILE: docs/workflows.md -->
# Workflows

This document describes the main operational and business workflows in the Puppeteer Service.

---

## Overview

The Puppeteer Service has one primary workflow -- **Form Fill** -- which is triggered by an HTTP POST from the upstream RFQ Ingest Service. This workflow has two variants (test mode and production mode) and several sub-workflows for error handling, idempotency, and retry logic.

There are no background jobs, cron tasks, or queue consumers. The only periodic operations are in-memory cleanup timers for the idempotency store (hourly) and rate limiter store (every 60 seconds), both running as `setInterval` with `.unref()`.

---

## User-Facing Flows

### 1. Form Fill -- Test Mode

The most common flow during development and validation. The RFQ Ingest Service sends a request with `isTestMode: true`. The form is filled but **not submitted**. A screenshot of the filled form is captured and uploaded to Supabase.

```mermaid
sequenceDiagram
    actor U as RFQ Ingest Service
    participant RL as Rate Limiter
    participant V as Validator
    participant ID as Idempotency
    participant B as Browser Service
    participant FF as Form Filler
    participant SC as Screenshot Service
    participant SB as Supabase Storage

    U->>RL: POST /puppeteer/fill-rfq<br/>X-RFQ-ID: rfq-abc<br/>isTestMode: true
    RL->>V: Pass (under limit)
    V->>V: Validate body, URL, headers
    V->>ID: generateIdempotencyKey()
    ID->>ID: checkIdempotency(key)
    Note right of ID: null = new request
    ID->>ID: startProcessing(key)

    V->>B: launchBrowser()
    B->>B: setupPage()
    B->>B: page.goto(formUrl)
    Note right of B: Up to 3 attempts<br/>with fresh page on retry

    B->>FF: fillRfqForm(page, quoteDetails)

    loop For each item (not no_quote)
        FF->>FF: fillRepeaterFieldBySuffix(txtNEQty1, i, qty)
        FF->>FF: selectDropdownBySuffix(ddlNETraceability1, i, trace)
        FF->>FF: fillRepeaterFieldBySuffix(txtNEUnitMeasure1, i, uom)
        FF->>FF: fillRepeaterFieldBySuffix(txtNEPrice1, i, price)
        FF->>FF: clickElementBySuffix(rbOutrightNE1 or rbExchangeNE1, i)
        FF->>FF: fillRepeaterFieldBySuffix(txtNELead1, i, leadTime)
        FF->>FF: fillRepeaterFieldBySuffix(txtNEDate1, i, tagDate)
        FF->>FF: fillRepeaterFieldBySuffix(txtNEMinQuantity1, i, minQty)
        FF->>FF: fillRepeaterFieldBySuffix(txtNEComments1, i, comments)
    end

    FF->>FF: fillTextareaBySuffix(txtComments, supplierComments)
    FF->>FF: fillInputBySuffix(quotePreparedBy, preparedBy)

    FF->>SC: captureAndUploadScreenshot(page, rfqId, "filled")
    SC->>SC: page.screenshot(fullPage: true)
    SC->>SB: POST /storage/v1/object/rfq-artifacts/screenshots/rfq-abc/...
    SB-->>SC: 200 OK
    SC-->>FF: { url, type, captured_at, storage_path }

    FF->>FF: cancelFormSubmission(page)
    Note right of FF: Click Cancel button<br/>or press Escape

    FF->>ID: markCompleted(key, result)
    FF->>B: closeBrowser()
    FF-->>U: 200 { success: true, finalAction: "FORM_CANCELLED", screenshot_data: [...] }
```

### 2. Form Fill -- Production Mode

The real submission flow. Identical to test mode except the form is **submitted** instead of cancelled.

```mermaid
sequenceDiagram
    actor U as RFQ Ingest Service
    participant S as Puppeteer Service
    participant B as Browser
    participant F as ASP.NET Form
    participant SB as Supabase

    U->>S: POST /puppeteer/fill-rfq<br/>isTestMode: false
    S->>S: Rate limit + validate + idempotency

    S->>B: Launch, setup, navigate, fill form
    S->>SB: Upload screenshot

    S->>B: submitForm(page)
    B->>F: page.evaluate() - find and click Submit button
    B->>F: waitForNavigation (30s timeout)
    Note right of F: Post-submit redirect or<br/>confirmation page

    alt Submit button found and clicked
        S->>S: markCompleted(key)
        S-->>U: 200 { finalAction: "FORM_SUBMITTED" }
    else No submit button found
        S->>S: markFailed(key)
        S-->>U: 500 { finalAction: "FORM_SUBMISSION_FAILED" }
    end

    S->>B: closeBrowser()
```

### 3. Duplicate Request Prevention (Idempotency)

When the same RFQ + URL + mode combination is submitted again.

```mermaid
sequenceDiagram
    actor U as RFQ Ingest Service
    participant S as Puppeteer Service
    participant ID as Idempotency Store

    U->>S: POST /puppeteer/fill-rfq<br/>X-RFQ-ID: rfq-abc<br/>isTestMode: false

    S->>ID: checkIdempotency("rfq-abc:prod:https://form.com")

    alt Status = "processing"
        ID-->>S: { status: "processing" }
        S-->>U: 409 "Request already being processed"
    else Status = "completed" AND isTestMode = false
        ID-->>S: { status: "completed", result: {...} }
        S-->>U: 200 { ...cachedResult, cached: true }
    else Status = "completed" AND isTestMode = true
        ID-->>S: { status: "completed" }
        S->>ID: removeKey(key)
        Note right of S: Test mode allows retry
        S->>S: Proceed with normal form fill
    else Status = "failed"
        ID-->>S: { status: "failed" }
        S->>ID: removeKey(key)
        Note right of S: Failed requests allow retry
        S->>S: Proceed with normal form fill
    else No record found
        S->>ID: startProcessing(key)
        S->>S: Proceed with normal form fill
    end
```

### 4. Request Validation Failures

```mermaid
sequenceDiagram
    actor U as RFQ Ingest Service
    participant S as Puppeteer Service

    U->>S: POST /puppeteer/fill-rfq

    alt Supabase not configured
        S-->>U: 503 "Supabase not configured"
    else X-RFQ-ID header missing
        S-->>U: 400 "X-RFQ-ID header is required"
    else Invalid request body
        S->>S: validateRfqRequest(body)
        S-->>U: 400 { errors: ["rfq_details is required", ...] }
    else Service shutting down
        S-->>U: 503 "Puppeteer service is shutting down"
    else Rate limit exceeded
        S-->>U: 429 { retryAfter: 30 }
    end
```

---

## Background / Async Operations

### Idempotency Cleanup

- **Trigger:** `setInterval` every 1 hour (`CLEANUP_INTERVAL_MS = 3600000`)
- **Input:** In-memory idempotency store (Map)
- **Logic:** Iterates all entries, deletes any where `Date.now() - createdAt > 24h`
- **Output:** Logs count of removed entries
- **Note:** The interval is `.unref()`'d so it does not prevent Node.js process exit

### Rate Limiter Cleanup

- **Trigger:** `setInterval` every 60 seconds
- **Input:** In-memory rate limit store (Map)
- **Logic:** Iterates all entries, deletes any where `Date.now() > resetTime`
- **Output:** Silent cleanup (no logging)

---

## Integration Workflows

### Supabase Storage Integration

The service integrates with Supabase Storage for screenshot persistence. This is the only external API integration beyond browser navigation.

```mermaid
sequenceDiagram
    participant PS as Puppeteer Service
    participant PG as Puppeteer Page
    participant SB as Supabase Storage API

    PS->>PG: page.evaluate(() => window.scrollTo(0, 0))
    PS->>PS: delay(500ms)
    PS->>PG: page.screenshot({ fullPage: true, type: "png" })
    PG-->>PS: Buffer (PNG bytes)

    PS->>SB: POST /storage/v1/object/rfq-artifacts/screenshots/{rfqId}/rfq-{type}-{ts}.png
    Note right of PS: Headers:<br/>apikey: SERVICE_ROLE_KEY<br/>Authorization: Bearer SERVICE_ROLE_KEY<br/>Content-Type: image/png<br/>x-upsert: true

    alt Upload succeeds
        SB-->>PS: 200 OK
        PS->>PS: Construct public URL
        Note right of PS: {SUPABASE_URL}/storage/v1/object/public/rfq-artifacts/screenshots/{rfqId}/...
    else Upload fails
        SB-->>PS: 4xx/5xx + error text
        PS->>PS: throw Error("Supabase upload failed: {status} - {errorText}")
    end
```

**Retry/Error Handling:** There is no automatic retry for Supabase uploads. A failed upload causes the entire request to fail with a 500 response. The idempotency key is marked as `failed`, allowing the caller to retry.

### Upstream Integration (RFQ Ingest Service)

The Puppeteer Service is a downstream consumer. It does not call back to the RFQ Ingest Service. The integration contract is:

| Aspect | Detail |
|--------|--------|
| Protocol | HTTP/HTTPS |
| Method | POST |
| Endpoint | `/puppeteer/fill-rfq` |
| Auth | None (network-level) |
| Required headers | `Content-Type: application/json`, `X-RFQ-ID: {uuid}` |
| Optional headers | `X-Request-ID: {uuid}` |
| Request body | JSON with `rfq_details`, `quote_details`, `isTestMode` |
| Success response | 200 with `screenshot_data` array containing Supabase URLs |
| Error response | 4xx/5xx with `error` message and `requestId` |
| Idempotency | Same `X-RFQ-ID` + URL + mode returns cached result (production) or allows retry (test/failed) |

---

## Graceful Shutdown Flow

When the service receives SIGTERM or SIGINT:

```mermaid
sequenceDiagram
    participant OS as Operating System
    participant SRV as Express Server
    participant RTR as Puppeteer Router
    participant BRW as Browser Service

    OS->>SRV: SIGTERM / SIGINT
    SRV->>SRV: server.close() (stop accepting connections)

    par Puppeteer shutdown
        OS->>RTR: SIGTERM / SIGINT
        RTR->>BRW: setShuttingDown(true)
        Note right of BRW: New requests get 503
        RTR->>BRW: closeAllBrowsers()
        BRW->>BRW: Close all entries in activeBrowsers Set
    end

    SRV->>SRV: process.exit(0)
```

Any in-flight requests to `/puppeteer/fill-rfq` that check `getShuttingDown()` will receive a 503 response. Readiness probe (`/puppeteer/ready`) also returns 503 during shutdown.
