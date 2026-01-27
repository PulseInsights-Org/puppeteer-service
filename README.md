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
| `/puppeteer/api/fill-rfq` | POST | Fill RFQ form |

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

## EC2 Deployment (T2 Nano)

### Option 1: Docker (Recommended)

```bash
# Install Docker on Amazon Linux 2
sudo yum update -y
sudo yum install -y docker
sudo service docker start
sudo usermod -a -G docker ec2-user

# Pull and run
docker pull your-registry/puppeteer-service:latest
docker run -d \
  --name puppeteer-service \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_SERVICE_ROLE_KEY=your-key \
  your-registry/puppeteer-service:latest
```

### Option 2: Direct Node.js

```bash
# Install Node.js 18
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Install Chrome dependencies
sudo yum install -y \
  alsa-lib \
  atk \
  cups-libs \
  gtk3 \
  libXcomposite \
  libXcursor \
  libXdamage \
  libXext \
  libXi \
  libXrandr \
  libXScrnSaver \
  libXtst \
  pango \
  xorg-x11-fonts-100dpi \
  xorg-x11-fonts-75dpi \
  xorg-x11-fonts-cyrillic \
  xorg-x11-fonts-misc \
  xorg-x11-fonts-Type1 \
  xorg-x11-utils

# Clone and setup
git clone your-repo puppeteer-service
cd puppeteer-service
npm ci --only=production

# Create .env file
cp .env.example .env
nano .env  # Add your credentials

# Run with PM2 (recommended)
npm install -g pm2
pm2 start server.js --name puppeteer-service
pm2 save
pm2 startup
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
curl -X POST http://localhost:3000/puppeteer/api/fill-rfq \
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
