# Outlet Vault Worker — Render

Node backend for The Outlet Vault.

Routes: GET /api/health, POST /api/analyse, POST /api/monitor/run.

Start command: node src/server.js
Cron command: node src/monitor.js

Required secret for AI: GEMINI_API_KEY. Optional authenticated manual-monitor secret: ADMIN_TOKEN. Do not commit either value.

Auction source adapters remain deliberately disabled until each source's permitted access method is implemented. Automatic bidding is not implemented.