# Puppeteer Service

[![CI](https://github.com/PulseInsights-Org/puppeteer-service/actions/workflows/deploy.yml/badge.svg)](https://github.com/PulseInsights-Org/puppeteer-service/actions/workflows/deploy.yml)

A standalone browser automation microservice for RFQ (Request for Quote) form filling. Built with Express and Puppeteer, designed for lightweight EC2 instances (T2 nano, 512 MB RAM).

---

## Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [API Reference](#api-reference)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Testing](#testing)
- [Quality Guardrails](#quality-guardrails)
- [CI/CD Pipeline](#cicd-pipeline)
- [Docker](#docker)
- [Production Deployment](#production-deployment)
- [Operations Reference](#operations-reference)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)

---

## Architecture

```
                         ┌──────────────────────────────┐
                         │       RFQ Ingest Service      │
                         │  (upstream caller)            │
                         └──────────┬───────────────────┘
                                    │ POST /puppeteer/fill-rfq
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Puppeteer Service                           │
│                                                                 │
│  ┌───────────┐   ┌──────────┐   ┌────────────┐   ┌──────────┐ │
│  │ Rate      │──▶│ Validate │──▶│ Idempotency│──▶│ Browser  │ │
│  │ Limiter   │   │ Request  │   │ Check      │   │ Launch   │ │
│  └───────────┘   └──────────┘   └────────────┘   └────┬─────┘ │
│                                                        │       │
│          ┌─────────────────────────────────────────────┘       │
│          ▼                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────────┐  │
│  │ Navigate to  │──▶│ Fill Form    │──▶│ Screenshot +      │  │
│  │ Form URL     │   │ Fields       │   │ Upload to Supabase│  │
│  │ (3 retries)  │   │ (ASP.NET)    │   └─────────┬─────────┘  │
│  └──────────────┘   └──────────────┘             │             │
│                                                   ▼             │
│                                      ┌─────────────────────┐   │
│                                      │ Submit or Cancel     │   │
│                                      │ (based on isTestMode)│   │
│                                      └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   Supabase Storage    │
                         │   rfq-artifacts/      │
                         │   screenshots/{rfqId} │
                         └──────────────────────┘
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Form Automation** | Fills ASP.NET RFQ forms using suffix-based field matching |
| **Idempotency** | Prevents duplicate production submissions (24h TTL, in-memory) |
| **Test / Production Modes** | `isTestMode=true` cancels form; `false` submits it |
| **Screenshot Capture** | Full-page PNG capture uploaded directly to Supabase Storage |
| **Rate Limiting** | Per-IP rate limiting with configurable window and max requests |
| **Navigation Retry** | 3-attempt retry with fresh page on navigation failure |
| **Graceful Shutdown** | SIGTERM/SIGINT handlers close all active browsers before exit |
| **Health Probes** | `/health` (liveness) and `/ready` (readiness) endpoints |
| **Structured Logging** | JSON in production, human-readable in development |
| **Memory Optimized** | Runs on 512 MB RAM (EC2 T2 nano) with single-process Chrome |

---

## API Reference

### `GET /`

Service information and available endpoints.

### `GET /puppeteer/health`

Liveness probe. Returns memory stats, uptime, and environment.

```json
{
  "status": "ok",
  "service": "puppeteer",
  "version": "1.0.0",
  "uptime": 3600,
  "memory": { "heapUsed": 45, "heapTotal": 80, "unit": "MB" }
}
```

### `GET /puppeteer/ready`

Readiness probe. Returns `503` during graceful shutdown.

### `POST /puppeteer/fill-rfq`

Fill an RFQ form via browser automation.

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `X-RFQ-ID` | Yes | RFQ UUID for screenshot organization |
| `X-Request-ID` | No | Request tracking ID (auto-generated if omitted) |

**Request Body:**

```json
{
  "rfq_details": {
    "quote_submission_url": "https://example.com/rfq-form"
  },
  "quote_details": {
    "items": [
      {
        "part_no": "ABC-123",
        "qty_available": "100",
        "traceability": "NEW",
        "uom": "EA",
        "price_usd": "25.00",
        "price_type": "OUTRIGHT",
        "lead_time": "5 days",
        "tag_date": "2024-01-15",
        "min_qty": 10,
        "comments": "Ready to ship",
        "no_quote": false
      }
    ],
    "supplier_comments": "Contact for bulk pricing",
    "quote_prepared_by": "John Doe"
  },
  "isTestMode": true,
  "keepOpen": false
}
```

**Responses:**

| Status | Condition |
|--------|-----------|
| `200` | Form filled successfully (or cached result for duplicate production requests) |
| `400` | Validation error (missing fields, invalid URL) |
| `409` | Duplicate request already processing or concurrent race condition |
| `429` | Rate limit exceeded (includes `Retry-After` header) |
| `503` | Supabase not configured or service shutting down |
| `500` | Browser launch failure, navigation failure, or form fill error |

**Success Response:**

```json
{
  "success": true,
  "message": "Form filled and cancelled successfully",
  "requestId": "uuid",
  "finalAction": "FORM_CANCELLED",
  "isTestMode": true,
  "screenshot_data": [
    {
      "url": "https://project.supabase.co/storage/v1/object/public/rfq-artifacts/screenshots/rfq-123/rfq-filled-1234567890.png",
      "type": "filled",
      "captured_at": "2024-01-01T00:00:00.000Z",
      "storage_path": "screenshots/rfq-123/rfq-filled-1234567890.png",
      "form_url": "https://example.com/rfq-form"
    }
  ]
}
```

**Field Mapping (ASP.NET suffix-based):**

| Field | Form Suffix | Type |
|-------|-------------|------|
| Quantity | `txtNEQty1` | Repeater input |
| Traceability | `ddlNETraceability1` | Dropdown |
| UOM | `txtNEUnitMeasure1` | Repeater input |
| Price | `txtNEPrice1` | Repeater input |
| Price Type | `rbOutrightNE1` / `rbExchangeNE1` | Radio button |
| Lead Time | `txtNELead1` | Repeater input |
| Tag Date | `txtNEDate1` | Repeater input (MMM-DD-YYYY) |
| Min Quantity | `txtNEMinQuantity1` | Repeater input |
| Comments | `txtNEComments1` | Repeater input |
| Supplier Comments | `txtComments` | Textarea |
| Prepared By | `quotePreparedBy` | Input |

---

## Getting Started

### Prerequisites

- Node.js >= 18
- A Supabase project with a storage bucket named `rfq-artifacts`

### Local Development

```bash
# Clone and install
git clone https://github.com/PulseInsights-Org/puppeteer-service.git
cd puppeteer-service
npm install

# Configure environment
cp .env.example .env
# Edit .env — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

# Start development server (non-headless browser, debug logging)
npm run dev

# Verify
curl http://localhost:3000/puppeteer/health
```

### Install Developer Tooling

```bash
# Install the pre-commit hook
npm run hooks:install
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server listening port |
| `NODE_ENV` | No | `development` | `development` / `production` / `test` |
| `SUPABASE_URL` | **Yes** | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | — | Supabase service role API key |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin |
| `CHROME_PATH` | No | auto-detect | Path to Chrome executable |
| `PUPPETEER_LOG_LEVEL` | No | `info` | Log level: `error` / `warn` / `info` / `debug` |
| `PUPPETEER_RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in ms |
| `PUPPETEER_RATE_LIMIT_MAX_REQUESTS` | No | `10` | Max requests per window |
| `NODE_OPTIONS` | No | — | Node.js flags (e.g., `--max-old-space-size=256`) |

### Environment Behavior

| Setting | Development | Production | Test |
|---------|-------------|------------|------|
| Browser | Visible window | Headless | N/A (mocked) |
| Logging | Debug level, human-readable | Info level, JSON | Error level only |
| Security flags | Relaxed (disable-web-security) | Strict | N/A |
| Error responses | Full stack traces | Generic messages | Full details |

---

## Testing

### Commands

```bash
npm test                  # Unit tests (default)
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only
npm run test:coverage     # Unit tests + coverage report (enforces 85% threshold)
npm run test:all          # All tests + coverage
npm run test:watch        # Watch mode
```

### Test Structure

```
tests/
├── setup.js                           # Environment + global fixtures
├── idempotency.test.js                # Idempotency service tests
├── unit/
│   ├── validation.test.js             # Request validation + date formatting
│   ├── logger.test.js                 # Structured logging (levels, formats)
│   ├── rate-limiter.test.js           # IP-based rate limiting
│   └── services/
│       ├── browser.test.js            # Browser lifecycle (mock isolation)
│       ├── form-filler.test.js        # Form field population
│       └── screenshot.test.js         # Capture + Supabase upload
└── integration/
    └── endpoints.test.js              # Full HTTP endpoint tests (supertest)
```

### Coverage

Coverage thresholds are enforced by Jest. CI will fail if any metric drops below **85%**:

```
Global threshold: 85% statements, 85% branches, 85% functions, 85% lines
```

Run `npm run test:coverage` to generate a detailed HTML report in `coverage/lcov-report/index.html`.

---

## Quality Guardrails

### Pre-Commit Hook

Installed via `npm run hooks:install`. Runs automatically on every `git commit`:

| Phase | Check | Skip Condition |
|-------|-------|----------------|
| 1 | **Secret detection** — scans staged diffs for API keys, passwords | Never |
| 2 | **ESLint** — lints staged `.js` files | No JS files staged |
| 3 | **Targeted tests** — runs `jest --findRelatedTests` for changed modules | No src/test files |
| 4 | **Coverage verification** — ensures changed files meet 85% threshold | No src files |

On failure, the hook prints a boxed explanation with the exact error and numbered next steps to fix it.

Emergency bypass: `git commit --no-verify`

### Linting

```bash
npm run lint          # Check for issues
npm run lint:fix      # Auto-fix what's possible
```

ESLint is configured with:
- `eslint:recommended` base rules
- Security rules: `no-eval`, `no-implied-eval`, `no-new-func`
- Code quality: `eqeqeq`, `prefer-const`, `no-var`, `no-throw-literal`
- Puppeteer override: `document`/`window` globals allowed in `page.evaluate()` files

### Change Summary

Generate a structured PR description with risk assessment:

```bash
npm run change-summary                # Compare against main
npm run change-summary -- --base=HEAD~3  # Compare last 3 commits
```

Output includes risk-rated file categories, testing impact analysis, and a review checklist.

---

## CI/CD Pipeline

Defined in `.github/workflows/deploy.yml`. Triggered on push to `main`, PRs to `main`, or manual dispatch.

```
┌────────┐     ┌────────────────────────┐     ┌───────────────────┐
│  Lint  │────▶│  Unit Tests + Coverage │────▶│                   │
│        │     │  (85% gate)            │     │   Deploy to EC2   │
│        │────▶│  Integration Tests     │────▶│   (main only)     │
└────────┘     └────────────────────────┘     └───────────────────┘
```

| Job | Runs | Purpose |
|-----|------|---------|
| **lint** | Always | ESLint across all JS files |
| **test** | After lint | Unit tests with coverage — fails if below 85% threshold |
| **test-integration** | After lint (parallel with test) | Integration tests via supertest |
| **deploy** | After test + test-integration, main branch only | SSH deploy to EC2, pm2 restart, health check |

Coverage reports are uploaded as artifacts (retained 14 days).

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `EC2_HOST` | EC2 instance IP address |
| `EC2_USER` | SSH username (e.g., `ubuntu`) |
| `EC2_SSH_KEY` | Full contents of the PEM private key |

Set these in **Settings > Secrets and variables > Actions > New repository secret**.

### Workflow Triggers

| Event | Action |
|-------|--------|
| Push to `main` | Lint > Test > Deploy |
| Pull request to `main` | Lint > Test (no deploy) |
| Manual dispatch | Lint > Test > Deploy |

Trigger manually: **Actions > Test and Deploy > Run workflow**

---

## Docker

```bash
# Build
docker build -t puppeteer-service .

# Run
docker run -d \
  --name puppeteer-service \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=your-key \
  puppeteer-service
```

The Dockerfile is optimized for small instances:
- Base image: `node:18-slim`
- Non-root user (`pptruser`) for security
- Built-in health check on `/puppeteer/health`
- Chrome dependencies installed without recommended packages

---

## Production Deployment

**Live URL:** `https://api.puppeteer-service.skynetparts.com`

### Server Details

| Property | Value |
|----------|-------|
| EC2 IP | `98.93.213.13` |
| OS | Ubuntu 24.04 LTS |
| Domain | `api.puppeteer-service.skynetparts.com` |
| SSL | Let's Encrypt (auto-renewing via Certbot) |
| Process Manager | PM2 |
| Reverse Proxy | Nginx |

### SSH Access

```bash
ssh -i "path/to/rfq.pem" ubuntu@98.93.213.13
```

### Application Location

```
/home/ubuntu/puppeteer-service/
├── server.js
├── package.json
├── .env
└── src/
```

### Manual Deployment

**Option 1: Push to GitHub (recommended)** — CI/CD handles the rest:

```bash
git push origin main
```

**Option 2: SSH deploy:**

```bash
ssh -i "rfq.pem" ubuntu@98.93.213.13 \
  "cd ~/puppeteer-service && git pull origin main && npm install --omit=dev && pm2 restart puppeteer-service"
```

---

## Operations Reference

### PM2

```bash
pm2 status                              # View process status
pm2 logs puppeteer-service --lines 50   # View recent logs
pm2 restart puppeteer-service           # Restart
pm2 stop puppeteer-service              # Stop
pm2 monit                               # Live monitoring (CPU/memory)
```

### Nginx

```bash
sudo nginx -t                           # Test config
sudo systemctl reload nginx             # Reload after config change
sudo tail -f /var/log/nginx/access.log  # Access logs
sudo tail -f /var/log/nginx/error.log   # Error logs
```

### SSL Certificate

```bash
sudo certbot certificates               # Check expiry
sudo certbot renew --dry-run            # Test renewal
sudo certbot renew --force-renewal      # Force renewal
```

### Memory (T2 Nano)

```bash
free -m                                 # Check system memory
pm2 monit                               # Per-process memory
```

For T2 nano (512 MB), set in `.env`:

```
NODE_OPTIONS=--max-old-space-size=256
```

---

## Troubleshooting

### Service not responding

```bash
pm2 status                                              # Is it running?
curl http://localhost:3000/puppeteer/health              # Can it respond?
pm2 logs puppeteer-service --lines 100                   # What happened?
```

### Browser launch failures

```bash
# Check Chrome dependencies
ldd $(which google-chrome) 2>/dev/null | grep "not found"

# Check available memory
free -m
```

### Screenshot upload failures

```bash
# Verify Supabase credentials
curl -s https://your-project.supabase.co/rest/v1/ \
  -H "apikey: your-key" | head -c 100
```

### Rate limited (429)

Check the `Retry-After` response header for seconds to wait. Default: 10 requests per 60-second window.

### Restart everything

```bash
pm2 restart puppeteer-service && sudo systemctl reload nginx
```

---

## Project Structure

```
puppeteer-service/
├── server.js                      # Express entry point, middleware, graceful shutdown
├── package.json                   # Dependencies, scripts, engine requirements
├── jest.config.js                 # Test config with 85% coverage thresholds
├── .eslintrc.json                 # Linting rules (security + Puppeteer awareness)
├── .env.example                   # Environment variable template
├── .gitignore
├── Dockerfile                     # Production container (node:18-slim)
├── README.md
│
├── src/
│   ├── index.js                   # Router: /health, /ready, mounts fill-rfq
│   ├── routes/
│   │   └── fill-rfq.js            # POST handler: validation → idempotency → browser → form → screenshot
│   ├── services/
│   │   ├── browser.js             # Puppeteer lifecycle: launch, setupPage, close, shutdown
│   │   ├── form-filler.js         # ASP.NET form field helpers (suffix-based matching)
│   │   ├── screenshot.js          # Capture + direct Supabase Storage upload
│   │   └── idempotency.js         # In-memory duplicate prevention (24h TTL)
│   ├── middleware/
│   │   └── rate-limiter.js        # Per-IP rate limiting with configurable window
│   └── utils/
│       ├── logger.js              # Structured logging (JSON prod / readable dev)
│       └── validation.js          # Request schema validation + date formatter
│
├── tests/
│   ├── setup.js                   # Test environment, global fixtures
│   ├── idempotency.test.js        # Idempotency unit tests
│   ├── unit/                      # Pure unit tests (mocked dependencies)
│   └── integration/               # HTTP-level tests (supertest)
│
├── scripts/
│   ├── pre-commit                 # Git hook: secrets → lint → tests → coverage
│   ├── install-hooks.sh           # Hook installer/uninstaller
│   └── change-summary.sh          # PR description generator with risk assessment
│
└── .github/
    └── workflows/
        └── deploy.yml             # CI: lint → test (85% gate) → integration → deploy
```

---

## Initial Server Setup (Reference)

For setting up a new Ubuntu 24.04 EC2 instance from scratch:

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Chrome dependencies
sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
  libasound2t64 libpango-1.0-0 libcairo2 fonts-liberation libfontconfig1 xdg-utils

# PM2
sudo npm install -g pm2
pm2 startup systemd -u ubuntu --hp /home/ubuntu

# Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# SSL
sudo certbot --nginx -d api.puppeteer-service.skynetparts.com
```

---

## License

ISC
