# VigilanteVanguard — Catalyst Deployment Guide

> **Project:** `vigilante-vanguard` · ID `54786000000021001`  
> **Environment:** Development (`60077849137`)  
> **AppSail URL:** `https://vigilante-vanguard-60077849137.development.catalystappsail.in`  
> **Frontend (Slate):** served from the same domain after Slate publish

---

## Architecture

```
Browser
  │
  ├─── Static SPA (Catalyst Slate)
  │      frontend/dist/  →  vv-frontend client
  │
  └─── REST + WebSocket (Catalyst AppSail)
         backend/  →  vv-backend  (Docker, FastAPI)
                        port 8000, 1024 MB, 1 worker
```

The frontend is a **separate static site** (Slate). In production every `/api/v1/*`
call goes to the AppSail HTTPS URL via `VITE_API_URL`.  The WebSocket uses `wss://`
via `VITE_WS_URL`. Both env vars are pre-set in `frontend/.env.production`.

---

## Pre-deployment Checklist

### 1 · Generate a strong token secret

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Copy the output — you'll paste it as `VV_TOKEN_SECRET` below.

### 2 · Create the Stratus training-data bucket

In **Catalyst Console → Cloud Scale → Stratus**:
- Create bucket: **`vv-training-data`**
- This stores all uploaded training images/videos, scoped per branch:
  `BLR_SOUTH/road_accident/SAMPLE-000001.jpg`

### 3 · Set environment variables in Catalyst Console

Open **Catalyst Console → AppSail → vv-backend → Environment Variables** and
set every variable listed in `appsail.json → environment`:

| Variable | Required | Notes |
|---|---|---|
| `CATALYST_PROJECT_ID` | ✅ | Your numeric project ID |
| `CATALYST_ENV` | ✅ | `production` |
| `VV_TOKEN_SECRET` | ✅ | 64-char hex from step 1 |
| `GEMINI_API_KEY` | ✅ | Google AI Studio |
| `GOOGLE_MAPS_API_KEY` | ✅ | Maps JS API |
| `GOOGLE_GEOCODING_API_KEY` | optional | Geocoding API |
| `ALLOWED_ORIGINS_STR` | ✅ | `https://vigilante-vanguard-60077849137.development.catalystappsail.in` |
| `VV_TRAINING_DATA_DIR` | ✅ | `/app/training_data` |
| `MSG91_AUTH_KEY` | optional | SMS alert integration |
| `MSG91_SENDER_ID` | optional | e.g. `VVPOL` |
| `MSG91_TEMPLATE_ID` | optional | MSG91 DLT template |

### 3 · Verify `catalyst.json` and `appsail.json`

Both files are already updated in this repo — no manual edits needed.

---

## Deploy

### Backend (AppSail — Docker)

```bash
# From project root
catalyst deploy --service vv-backend
```

This builds the Docker image from `backend/Dockerfile`, pushes it to AppSail,
and starts the container with `uvicorn --workers 1 --timeout-keep-alive 75`.

> **Why 1 worker?** In-memory stores (`_HIST_INDEX`, `_RF_STATE`, `_SVM_STATE`,
> `_INCIDENTS`) are not shared across processes. Multiple workers would cause
> detection misses and duplicate incidents.

### Frontend (Catalyst Slate)

```bash
# From project root
catalyst deploy --client vv-frontend
```

Vite reads `frontend/.env.production` during `npm run build`, which sets
`VITE_API_URL` and `VITE_WS_URL` to the AppSail HTTPS/WSS domain automatically.

---

## Post-deploy Verification

```bash
# Health check
curl https://vigilante-vanguard-60077849137.development.catalystappsail.in/health

# Expected: {"status":"healthy","version":"5.0.0","env":"production"}
```

Open the frontend URL in a browser and:
1. Log in with demo credentials (`officer@karnataka.gov.in` / `admin123`)
2. Go to **CCTV** — WebSocket indicator should turn green
3. Go to **AI Training → Model tab** — verify model status banner
4. Upload a test image via **Test AI** to confirm detection works

---

## Training Data (Uploading Videos / Images)

After deployment, upload training videos through the **AI Training Studio** page:

1. **Video tab** → upload `.mp4`/`.avi` incident videos → frames extracted
   automatically to `/app/training_data/<label>/`
2. **Scan Disk** → registers all on-disk frames into the in-memory sample list
3. **Train tab** → runs the full multi-algorithm benchmark (RF, SVM, KNN, MLP,
   Gradient Boosting, Decision Tree, Logistic Regression, Naive Bayes, KMeans,
   Cosine NN) via 5-fold cross-validation
4. **Model tab → Algorithm Performance Report** — compare all algorithms;
   Random Forest (PRIMARY) + SVM (SECONDARY) are retrained on the full dataset

> Training data persists in `/app/training_data/` inside the container. If the
> AppSail instance is replaced, data is lost — upload again or mount a volume.
> For persistence across redeploys, upload your dataset each time or use Catalyst
> FileStore to back up the `.pkl` models between deploys.

---

## Rollback

```bash
# List recent deployments
catalyst appsail deployments --service vv-backend

# Roll back
catalyst appsail rollback --service vv-backend --deployment <deployment-id>
```

---

## Local Development

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill in secrets
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev            # http://localhost:3000
```

The Vite dev server proxies `/api → http://localhost:8000` automatically — no
`VITE_API_URL` needed locally.

---

## Multi-Branch User System

Every login has a **`branch_id`** that scopes all data. Non-admin users see only
their own branch's cameras, incidents, training samples, and FIRs.

### Branch IDs

| Branch ID | Division / District | City |
|---|---|---|
| `HQ` | State HQ — full admin access | Bengaluru |
| `BLR_CITY` | Bengaluru City Police | Bengaluru |
| `BLR_SOUTH` | Bengaluru South Division | Bengaluru |
| `BLR_NORTH` | Bengaluru North Division | Bengaluru |
| `BLR_EAST` | Bengaluru East Division | Bengaluru |
| `BLR_WEST` | Bengaluru West Division | Bengaluru |
| `MYS_CITY` | Mysuru City Police | Mysuru |
| `HBL_CITY` | Hubballi-Dharwad City Police | Hubballi |
| `MGD_DIST` | Mangaluru District Police | Mangaluru |
| `BLG_DIST` | Belagavi District Police | Belagavi |
| `SHG_DIST` | Shivamogga District Police | Shivamogga |
| `GUL_DIST` | Kalaburagi District Police | Kalaburagi |

### Default Logins (Change Passwords Before Production!)

| Email | Password | Role | Branch |
|---|---|---|---|
| `admin@ksp.gov.in` | `admin123` | ADMINISTRATOR | HQ (all access) |
| `venkat.25cse@cambridge.edu.in` | `Karthi@007` | ADMINISTRATOR | HQ (all access) |
| `blr.city.admin@ksp.gov.in` | `BLR@City1` | ADMINISTRATOR | BLR_CITY |
| `blr.south.supervisor@ksp.gov.in` | `BLR@South1` | SUPERVISOR | BLR_SOUTH |
| `mys.admin@ksp.gov.in` | `MYS@Admin1` | ADMINISTRATOR | MYS_CITY |
| `mys.supervisor@ksp.gov.in` | `MYS@Sup1` | SUPERVISOR | MYS_CITY |
| `hbl.admin@ksp.gov.in` | `HBL@Admin1` | ADMINISTRATOR | HBL_CITY |
| `mgd.admin@ksp.gov.in` | `MGD@Admin1` | ADMINISTRATOR | MGD_DIST |
| `blg.admin@ksp.gov.in` | `BLG@Admin1` | ADMINISTRATOR | BLG_DIST |
| `shg.admin@ksp.gov.in` | `SHG@Admin1` | ADMINISTRATOR | SHG_DIST |
| `gul.admin@ksp.gov.in` | `GUL@Admin1` | ADMINISTRATOR | GUL_DIST |

### Creating New Branch Users via API

```bash
# Admin login to get a token
TOKEN=$(curl -s -X POST https://<appSailUrl>/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ksp.gov.in","password":"admin123"}' | jq -r .token)

# Create a new user assigned to Mysuru City branch
curl -X POST https://<appSailUrl>/api/v1/auth/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "new.officer@ksp.gov.in",
    "password": "SecurePass@123",
    "role": "INVESTIGATOR",
    "display_name": "Officer Name",
    "branch_id": "MYS_CITY",
    "station_code": "MYS_C_02"
  }'
```

### Data Isolation Rules

| User Role | Data Visible |
|---|---|
| `ADMINISTRATOR` (HQ branch) | **All** branches, all incidents, all training data |
| `ADMINISTRATOR` (branch-specific) | Only their branch |
| `SUPERVISOR` | Only their branch |
| `INVESTIGATOR` / `ANALYST` | Only their branch |

Training samples uploaded from Mysuru will be stored in Catalyst Stratus at:
`vv-training-data/MYS_CITY/<label>/<filename>`

An HQ admin logging into AI Training sees **all** uploaded samples. A Mysuru
officer sees **only** their own branch's samples.

---

## Algorithm Performance — What Was Benchmarked

The system runs **10 algorithms** in parallel to find the best classifier for
CCTV incident detection. Evaluated via stratified 5-fold cross-validation:

| # | Algorithm | Role | Notes |
|---|---|---|---|
| 1 | **Random Forest** | ★ PRIMARY | 200 trees, balanced class weights |
| 2 | **SVM (RBF)** | SECONDARY | Calibrated probs, C=10, gamma=scale |
| 3 | **MLP (256,128)** | Benchmark | Neural net, early stopping |
| 4 | **Gradient Boosting** | Benchmark | 100 estimators, lr=0.1 |
| 5 | **KNN (k=5)** | Benchmark | Euclidean distance |
| 6 | **Decision Tree** | Benchmark | Interpretable, depth=20 |
| 7 | **Logistic Regression** | Benchmark | Linear baseline |
| 8 | **Naive Bayes** | Benchmark | Probabilistic baseline |
| 9 | **KMeans** | Unsupervised | Cluster purity (not accuracy) |
| 10 | **Cosine NN** | FALLBACK | Histogram nearest-neighbour |

**Detection priority chain at inference time:**
`Random Forest → SVM → Cosine NN → YOLOv8 contextual guard → OpenCV heuristics`
