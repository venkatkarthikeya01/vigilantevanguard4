# VigilanteVanguard — Catalyst Deployment Guide
# Project: vigilante-vanguard | ID: 54786000000021001
# URL: console.catalyst.zoho.in/baas/60077849137/project/54786000000021001
# ─────────────────────────────────────────────────────────────────────────

## STEP 1 — Install Catalyst CLI

```bash
npm install -g zcatalyst-cli
```

## STEP 2 — Login & link project

```bash
catalyst auth:login
# → Opens browser to sign in with your Zoho account

cd playground/vigilante-vanguard
catalyst init --project-id 54786000000021001
# → Links this folder to the vigilante-vanguard project
```

## STEP 3 — Set Environment Variables in Catalyst Console

Go to: console.catalyst.zoho.in → vigilante-vanguard → Functions → Environment Variables

Add:
```
GEMINI_API_KEY       = <your Gemini API key>
GOOGLE_MAPS_API_KEY  = <your Google Maps key>
NODE_ENV             = production
```

Also set these in AppSail → vv-backend → Environment:
```
GEMINI_API_KEY       = <same>
GOOGLE_MAPS_API_KEY  = <same>
CATALYST_PROJECT_ID  = 54786000000021001
```

## STEP 4 — Deploy Serverless Functions

```bash
cd playground/vigilante-vanguard

# Deploy all functions
catalyst deploy functions

# Or deploy individually:
catalyst deploy functions --name fir-api
catalyst deploy functions --name ai-orchestrator
catalyst deploy functions --name crime-analytics
catalyst deploy functions --name ocr-processor
catalyst deploy functions --name report-generator
catalyst deploy functions --name auth-middleware
```

## STEP 5 — Deploy Frontend (Catalyst Slate)

```bash
cd playground/vigilante-vanguard

# Build the React frontend
cd frontend
npm install
npm run build
cd ..

# Deploy to Catalyst Slate
catalyst deploy client
```

Or via Catalyst Console:
1. Go to Slate → Web Client Hosting
2. Click "Deploy New Version"
3. Upload `frontend/dist/` folder

## STEP 6 — Deploy Backend (Catalyst AppSail)

```bash
cd playground/vigilante-vanguard/backend

# Build Docker image
docker build -t vigilante-vanguard-backend .

# Deploy to Catalyst AppSail
catalyst deploy appsail --name vv-backend
```

Or via Catalyst Console:
1. Go to AppSail → New Service
2. Select "Docker Container"
3. Connect your GitHub repo OR upload Dockerfile
4. Set port: 8000
5. Add environment variables (GEMINI_API_KEY etc.)
6. Deploy

## STEP 7 — Configure Catalyst Data Store Tables

Run the SQL migrations in Catalyst Console → Data Store → Run ZCQL:

```sql
-- Copy from: data/migrations/001_initial_schema.sql
-- Then seed:  data/seeds/002_seed_data.sql
```

## STEP 8 — Configure Catalyst Services

### NoSQL Tables (Console → Cloud Scale → NoSQL)
Create tables:
- conversation_history
- ai_context
- session_state
- investigation_notes
- cached_intelligence

### Stratus Buckets (Console → Cloud Scale → Stratus)
Create buckets:
- crime-pdfs
- evidence
- reports
- ocr-outputs

### Cache Segments (Console → Cloud Scale → Cache)
Create segments:
- fir-cache
- offender-cache
- hotspot-cache
- dashboard-cache
- ai-response-cache

### Cron Jobs (Console → Job Scheduler → New Job)
| Name                      | Schedule    | Function            |
|---------------------------|-------------|---------------------|
| daily-intelligence-report | 0 6 * * *   | report-generator    |
| rebuild-embeddings        | 0 2 * * *   | ai-orchestrator     |
| refresh-hotspot-analysis  | 0 */4 * * * | crime-analytics     |
| cache-cleanup             | 0 3 * * *   | crime-analytics     |

## STEP 9 — Configure Signals (Event Triggers)

Console → Serverless → Signals:
- Trigger: `stratus.upload` on bucket `crime-pdfs` → function `ocr-processor`
- Trigger: `datastore.insert` on table `CaseMaster`  → function `fir-api`
- Trigger: `auth.user_created`                      → function `auth-middleware`

## STEP 10 — Set API Gateway Routes

Console → Serverless → API Gateway:
```
POST   /auth/login        → auth-middleware
POST   /auth/logout       → auth-middleware
GET    /firs              → fir-api
POST   /firs              → fir-api
GET    /firs/:id          → fir-api
GET    /analytics/*       → crime-analytics
POST   /ai/chat           → ai-orchestrator
POST   /ai/report         → report-generator
POST   /ocr/process       → ocr-processor
```

## STEP 11 — Full Deploy

```bash
# From project root:
catalyst deploy
# Deploys: Functions + Slate client + AppSail
```

## STEP 12 — Verify Deployment

Visit your Slate URL from Catalyst Console → Slate → Web Client Hosting

Test endpoints:
```bash
curl -X POST https://<your-catalyst-domain>/server/auth-middleware/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ksp.gov.in","password":"admin123"}'
```

## Architecture Summary

```
Browser (React/Vite)
  │
  ▼ Catalyst Slate (Web Client Hosting)
  │
  ▼ Catalyst API Gateway ──► Rate Limiting, Auth
  │
  ├──► Catalyst Serverless Functions (Node.js 18)
  │      ├── fir-api          ◄──► Catalyst Data Store (ZCQL)
  │      ├── ai-orchestrator  ◄──► Catalyst QuickML + Cache + NoSQL
  │      ├── crime-analytics  ◄──► Catalyst Cache + Zia AutoML
  │      ├── ocr-processor    ◄──► Catalyst Zia OCR + Stratus
  │      ├── report-generator ◄──► Catalyst SmartBrowz + Mail
  │      └── auth-middleware  ◄──► Catalyst Authentication + NoSQL
  │
  ├──► Catalyst AppSail (Docker — FastAPI)
  │      └── vv-backend:8000  ◄──► All services via Catalyst SDK
  │
  ├──► Catalyst Cron → daily reports, embeddings, hotspots
  ├──► Catalyst Signals → PDF upload → OCR → AI pipeline
  └──► Catalyst Circuits → FIR → classification → alerts
```
