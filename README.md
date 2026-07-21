# VigilanteVanguard 4
### Karnataka State Police Datathon — AI-Powered Crime Intelligence Platform

> Built on **Zoho Catalyst** as the cloud operating system.

---

## Overview

VigilanteVanguard is a full-stack, production-ready crime intelligence platform built exclusively for the Karnataka State Police Datathon. It transforms raw FIR data and monthly crime review statistics into actionable intelligence using AI, machine learning, geospatial analysis, and automated workflows — all hosted natively on Zoho Catalyst.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        VigilanteVanguard                            │
│                   Karnataka State Police Datathon                   │
├──────────────┬──────────────┬────────────────┬──────────────────────┤
│   Frontend   │   Backend    │   AI/ML        │   Data               │
│   (Slate)    │  (AppSail)   │  (QuickML/Zia) │  (Data Store)        │
│              │              │                │                      │
│  React 18    │  FastAPI     │  RAG           │  Catalyst Data Store │
│  TailwindCSS │  Catalyst    │  AutoML        │  Catalyst NoSQL      │
│  Shadcn/UI   │  Serverless  │  OCR (Zia)     │  Catalyst Stratus    │
│  Google Maps │  Functions   │  Speech (Zia)  │  Catalyst Cache      │
└──────────────┴──────────────┴────────────────┴──────────────────────┘
```

### Catalyst Services Used

| Service | Purpose |
|---|---|
| Catalyst Serverless Functions | REST APIs, AI orchestration, auth middleware |
| Catalyst AppSail | FastAPI backend, AI services (Docker) |
| Catalyst Slate | React frontend hosting |
| Catalyst Data Store | FIRs, cases, officers, suspects, victims |
| Catalyst NoSQL | Chat memory, AI context, session state |
| Catalyst Stratus | PDFs, evidence, FIR attachments, OCR output |
| Catalyst Cache | Hot FIR lookups, crime hotspot data, dashboard widgets |
| Catalyst Data Store Search | Full-text FIR/accused/location search |
| Catalyst QuickML | RAG, LLM, semantic search, case summarisation |
| Catalyst Zia AutoML | Crime hotspot, repeat offender, risk scoring models |
| Catalyst Zia Services | OCR on historical crime PDFs |
| Catalyst Zia Speech | English + Kannada voice assistant |
| Catalyst SmartBrowz | PDF report generation, dashboard screenshots |
| Catalyst Authentication | JWT auth, RBAC (Investigator/Analyst/Supervisor/Admin) |
| Catalyst API Gateway | Route protection, rate limiting |
| Catalyst Connections | Google Maps, Google Geocoding, Gmail |
| Catalyst Cron | Daily intel reports, embedding refresh, cache cleanup |
| Catalyst Signals | Event triggers on FIR creation, PDF upload |
| Catalyst Circuits | PDF→OCR→RAG pipeline, FIR→AI→Alert pipeline |
| Catalyst Mail | Investigation reports, daily summaries, alerts |
| Catalyst Push Notifications | High-risk case alerts, hotspot notifications |
| Catalyst Pipelines | CI/CD for all services |

---

## Karnataka Districts Covered

Bagalkot, Ballari, Belagavi City, Belagavi District, Bengaluru City, Bengaluru District, Bengaluru South, Bidar, Chamarajanagar, Chickballapura, Chikkamagaluru, Chitradurga, Dakshina Kannada, Davanagere, Dharwad, Gadag, Hassan, Haveri, Hubballi Dharwad City, K.G.F, Kalaburagi, Kalaburagi City, Karnataka Railways, Kodagu, Kolar, Koppal, Mandya, Mangaluru City, Mysuru City, Mysuru District, Raichur, Shivamogga, Tumakuru, Udupi, Uttara Kannada, Vijayanagara, Vijayapur, Yadgir

---

## Key Features

- **FIR Management** — Create, search, manage FIRs with real Karnataka CrimeNo format
- **AI Case Assistant** — RAG-powered Q&A on case files, English + Kannada
- **Crime Analytics Dashboard** — Real KSP data (Jan–Jun 2026) visualised
- **Crime Heatmap** — Google Maps with live FIR markers, cluster views, hotspot overlays
- **Repeat Offender Detection** — AutoML-powered risk scoring
- **OCR Pipeline** — Upload historical PDFs → auto-extract → index in knowledge base
- **Smart Reports** — One-click PDF intelligence reports via SmartBrowz
- **Voice Assistant** — English + Kannada speech-to-text Q&A
- **Automated Alerts** — Push notifications + email for high-risk cases
- **SAKALA / CCTNS Integration** — Performance metrics from real KSP reports

---

## Project Structure

```
vigilante-vanguard/
├── backend/              # FastAPI — Catalyst AppSail
├── frontend/             # React 18 — Catalyst Slate
├── functions/            # Catalyst Serverless Functions
├── catalyst-config/      # All Catalyst service configs
├── data/
│   ├── pdfs/             # Source KSP crime review PDFs
│   ├── seeds/            # Database seed data (districts, acts, sections)
│   └── migrations/       # Catalyst Data Store SQL migrations
├── ml/                   # Catalyst Zia AutoML training configs
├── circuits/             # Catalyst Circuits workflow definitions
└── docs/                 # Architecture diagrams, API docs
```

---

## Data Sources

- KSP Monthly Crime Review — January to June 2026 (official CCTNS data)
- Karnataka Police FIR System ER Diagram (official database schema)
- 38 Police units across Karnataka State

---

## Quick Start

```bash
# Install Catalyst CLI
npm install -g zcatalyst-cli

# Login
zcatalyst login

# Initialize project
cd vigilante-vanguard
zcatalyst init

# Deploy all services
zcatalyst deploy
```

---

*VigilanteVanguard — Powered by Zoho Catalyst | Karnataka State Police Datathon 2026*
