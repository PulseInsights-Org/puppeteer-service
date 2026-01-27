# Puppeteer Service

A standalone browser automation service for RFQ form filling. Designed to run on lightweight EC2 instances (T2 nano).

## Features

- Browser automation with Puppeteer
- ASP.NET form field population
- Screenshot capture and upload to Supabase
- Rate limiting per IP
- Graceful shutdown handling
- Health check endpoints

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service info |
| `/puppeteer/health` | GET | Health check with memory stats |
| `/puppeteer/ready` | GET | Readiness probe |
| `/puppeteer/fill-rfq` | POST | Fill RFQ form |

## Requirements

- Node.js >= 18
- Supabase account with storage bucket named `rfq-artifacts`

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your Supabase credentials
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Start in development mode
npm run dev
```

### Docker

```bash
# Build image
docker build -t puppeteer-service .

# Run container
docker run -d \
  --name puppeteer-service \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=your-key \
  puppeteer-service
```

## CI/CD Pipeline

Automated deployment via GitHub Actions. Pushes to `main` branch trigger:
1. **Test** - Runs `npm test`
2. **Deploy** - If tests pass, deploys to EC2

### Setup GitHub Secrets

Go to your repo: **Settings → Secrets and variables → Actions → New repository secret**

Add these 3 secrets:

| Secret Name | Value |
|-------------|-------|
| `EC2_HOST` | `98.93.213.13` |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | Contents of `rfq.pem` file (entire key including BEGIN/END lines) |

### How to Get SSH Key Content

```powershell
# Windows PowerShell - copy key to clipboard
Get-Content "C:\Users\91948\Downloads\rfq.pem" | Set-Clipboard
```

Then paste into the `EC2_SSH_KEY` secret field.

### Workflow Triggers

| Event | Action |
|-------|--------|
| Push to `main` | Run tests → Deploy if pass |
| Pull request to `main` | Run tests only |
| Manual dispatch | Run tests → Deploy |

### Manual Trigger

Go to **Actions → Test and Deploy → Run workflow**

---

## Production Deployment

**Live URL:** https://api.puppeteer-service.skynetparts.com

### Server Details

- **EC2 IP:** 98.93.213.13
- **OS:** Ubuntu 24.04 LTS
- **Domain:** api.puppeteer-service.skynetparts.com
- **SSL:** Let's Encrypt (auto-renews)

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

---

## Manual Deployment (Alternative to CI/CD)

If you need to deploy manually without using GitHub Actions:

### Option 1: Push to GitHub (Recommended)

Just push your changes to `main` branch - CI/CD handles the rest:

```bash
git add .
git commit -m "Your changes"
git push origin main
```

### Option 2: Manual SSH Deployment

```bash
# SSH into server
ssh -i "C:\Users\91948\Downloads\rfq.pem" ubuntu@98.93.213.13

# Pull latest code
cd ~/puppeteer-service
git pull origin main

# If package.json changed, reinstall dependencies
npm install --omit=dev

# Restart the application
pm2 restart puppeteer-service

# Check status
pm2 status
pm2 logs puppeteer-service --lines 20
```

### Quick One-Liner (SSH & Deploy)

```bash
ssh -i "C:\Users\91948\Downloads\rfq.pem" ubuntu@98.93.213.13 "cd ~/puppeteer-service && git pull origin main && npm install --omit=dev && pm2 restart puppeteer-service"
```

---

## PM2 Commands Reference

```bash
# View status
pm2 status

# View logs
pm2 logs puppeteer-service
pm2 logs puppeteer-service --lines 50

# Restart application
pm2 restart puppeteer-service

# Stop application
pm2 stop puppeteer-service

# Start application
pm2 start puppeteer-service

# Delete and re-add
pm2 delete puppeteer-service
pm2 start server.js --name puppeteer-service
pm2 save
```

---

## Nginx Commands Reference

```bash
# Test configuration
sudo nginx -t

# Reload (after config changes)
sudo systemctl reload nginx

# Restart
sudo systemctl restart nginx

# View status
sudo systemctl status nginx

# View logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## SSL Certificate Management

SSL certificate auto-renews via Certbot timer. To manually manage:

```bash
# Check certificate expiry
sudo certbot certificates

# Test renewal
sudo certbot renew --dry-run

# Force renewal
sudo certbot renew --force-renewal
```

---

## Troubleshooting

### Check if service is running

```bash
pm2 status
curl http://localhost:3000/puppeteer/health
```

### View application logs

```bash
pm2 logs puppeteer-service --lines 100
```

### Check Nginx status

```bash
sudo systemctl status nginx
sudo nginx -t
```

### Restart everything

```bash
pm2 restart puppeteer-service
sudo systemctl reload nginx
```

### Memory issues

```bash
# Check memory usage
free -m
pm2 monit
```

---

## Initial Server Setup (Reference)

This section documents the initial setup for Ubuntu 24.04. Use only when setting up a new server.

### Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Install Chrome Dependencies

```bash
sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
  libasound2t64 libpango-1.0-0 libcairo2 fonts-liberation libfontconfig1 xdg-utils
```

### Install PM2

```bash
sudo npm install -g pm2
pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

### Install Nginx & Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/puppeteer-service
# Add server block configuration

sudo ln -s /etc/nginx/sites-available/puppeteer-service /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### Obtain SSL Certificate

```bash
sudo certbot --nginx -d api.puppeteer-service.skynetparts.com
```

## Memory Optimization for T2 Nano

T2 nano has only 512MB RAM. Add these environment variables:

```bash
# Limit Node.js heap
export NODE_OPTIONS="--max-old-space-size=256"

# Or in .env
NODE_OPTIONS=--max-old-space-size=256
```

## API Usage

### Fill RFQ Form

```bash
curl -X POST http://localhost:3000/puppeteer/fill-rfq \
  -H "Content-Type: application/json" \
  -H "X-RFQ-ID: rfq-123" \
  -d '{
    "rfq_details": {
      "quote_submission_url": "https://example.com/rfq-form"
    },
    "quote_details": {
      "items": [
        {
          "part_no": "ABC123",
          "qty_available": "100",
          "traceability": "NEW",
          "uom": "EA",
          "price_usd": "25.00",
          "price_type": "OUTRIGHT",
          "lead_time": "5 days"
        }
      ],
      "supplier_comments": "Ready to ship",
      "quote_prepared_by": "John Doe"
    }
  }'
```

### Response

```json
{
  "success": true,
  "message": "Form filled and cancelled successfully",
  "requestId": "uuid",
  "screenshot_data": [
    {
      "url": "https://your-project.supabase.co/storage/v1/object/public/rfq-artifacts/screenshots/rfq-123/rfq-filled-1234567890.png",
      "type": "filled",
      "captured_at": "2024-01-01T00:00:00.000Z",
      "storage_path": "screenshots/rfq-123/rfq-filled-1234567890.png",
      "form_url": "https://example.com/rfq-form"
    }
  ]
}
```

## Project Structure

```
puppeteer-standalone/
├── server.js                 # Express server entry point
├── package.json
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md
└── src/
    ├── index.js              # Router with health endpoints
    ├── routes/
    │   └── fill-rfq.js       # Main form filling endpoint
    ├── services/
    │   ├── browser.js        # Browser lifecycle management
    │   ├── form-filler.js    # Form field population logic
    │   └── screenshot.js     # Screenshot capture & Supabase upload
    ├── middleware/
    │   └── rate-limiter.js   # Request rate limiting
    └── utils/
        ├── logger.js         # Structured logging
        └── validation.js     # Request validation
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Server port |
| `NODE_ENV` | No | development | Environment mode |
| `SUPABASE_URL` | Yes | - | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | - | Supabase service role key |
| `CHROME_PATH` | No | auto-detect | Path to Chrome executable |
| `PUPPETEER_LOG_LEVEL` | No | info | Log level (error/warn/info/debug) |
| `PUPPETEER_RATE_LIMIT_WINDOW_MS` | No | 60000 | Rate limit window (ms) |
| `PUPPETEER_RATE_LIMIT_MAX_REQUESTS` | No | 10 | Max requests per window |
| `CORS_ORIGIN` | No | * | CORS allowed origin |

## License

ISC
