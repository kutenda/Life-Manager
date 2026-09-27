# Outlet Vault Worker

Secure backend for The Outlet Vault.

## Routes
- GET /api/health
- POST /api/analyse — image + lot-description product identification via Gemini
- POST /api/monitor/run — authenticated monitor trigger (source adapters remain opt-in)

## Secrets
Set GEMINI_API_KEY and ADMIN_TOKEN as Cloudflare Worker secrets. Never commit real values.

## Monitoring
An hourly Cron Trigger calls the scheduled handler. Source-specific auction adapters must respect the source's terms, robots/access controls and rate limits. No automatic bidding is implemented.
