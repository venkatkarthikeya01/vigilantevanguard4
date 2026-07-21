/**
 * VigilanteVanguard Backend — Node.js Express
 * Zoho Catalyst AppSail — Karnataka State Police Datathon 2026
 *
 * Self-contained REST API with:
 * - JWT-style HMAC token auth
 * - FIR CRUD with monthly table routing
 * - Access logging (console + in-memory)
 * - Catalyst SDK integration (optional, best-effort)
 * - WebSocket live feed (ws) — multi-user real-time events
 */

const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const http    = require('http');

let WebSocketServer = null;
try {
  const ws = require('ws');
  WebSocketServer = ws.WebSocketServer || ws.Server;
} catch(e) {
  console.log('[WS] ws module not available — live feed disabled');
}

const PORT = parseInt(process.env.PORT || process.env.CATALYST_PORT || '8000', 10);
const TOKEN_SECRET = 'vv_ksp_demo_2026';

// ─── In-memory stores (fallback when Catalyst unavailable) ────
const MEMORY_FIRS  = [];
const MEMORY_LOGS  = [];
let   FIR_COUNTER  = 0;

// ─── Live feed store + WebSocket broadcast ─────────────────────
const LIVE_EVENTS = [];
const MAX_EVENTS  = 100;
let wsClients     = new Set();

function broadcast(event) {
  const msg = JSON.stringify(event);
  for (const client of wsClients) {
    try { if (client.readyState === 1) client.send(msg); } catch(e) {}
  }
}

function pushEvent(type, payload) {
  const event = {
    id:      Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    type,
    payload,
    ts:      new Date().toISOString(),
  };
  LIVE_EVENTS.push(event);
  if (LIVE_EVENTS.length > MAX_EVENTS) LIVE_EVENTS.shift();
  broadcast(event);
  return event;
}

// ─── Catalyst SDK (optional) ─────────────────────────────────
let CATALYST_APP = null;
try {
  const catalyst = require('zcatalyst-sdk-node');
  CATALYST_APP = catalyst.initialize();
  console.log('[Catalyst] SDK initialized (Node)');
} catch(e) {
  console.log(`[Catalyst] SDK unavailable: ${e.message}`);
}

// ─── Demo users ───────────────────────────────────────────────
const USERS = {
  'admin@ksp.gov.in':              { password:'admin123',       role:'ADMINISTRATOR', name:'Admin Officer',    district_id:5 },
  'venkat.25cse@cambridge.edu.in': { password:'Karthi@007',     role:'ADMINISTRATOR', name:'Venkat (Admin)',   district_id:5 },
  'raj.kumar@ksp.gov.in':          { password:'Inspector@123',  role:'INVESTIGATOR',  name:'Insp. Raj Kumar',  district_id:5 },
  'priya.sharma@ksp.gov.in':       { password:'Analyst@123',    role:'ANALYST',       name:'Priya Sharma',     district_id:1 },
  'suresh.babu@ksp.gov.in':        { password:'Supervisor@123', role:'SUPERVISOR',    name:'DSP Suresh Babu',  district_id:5 },
  'inspector@ksp.gov.in':          { password:'pass123',        role:'INVESTIGATOR',  name:'S.K. Ravi Kumar',  district_id:5 },
  'analyst@ksp.gov.in':            { password:'pass123',        role:'ANALYST',       name:'Priya Nair',       district_id:1 },
  'supervisor@ksp.gov.in':         { password:'pass123',        role:'SUPERVISOR',    name:'DSP Venkatesh',    district_id:5 },
};

// ─── Token helpers ────────────────────────────────────────────
function makeToken(email, user, uid) {
  const payload = Buffer.from(JSON.stringify({
    user_id:email.indexOf('@') >= 0 ? uid : '1', email, role:user.role,
    display_name:user.name, district_id:user.district_id, type:'vv_demo'
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex').slice(0,16);
  return `${payload}.${sig}`;
}

function decodeToken(token) {
  if (!token || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(b64).digest('hex').slice(0,16);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(b64, 'base64url').toString());
    return p.type === 'vv_demo' ? p : null;
  } catch { return null; }
}

function monthlyTable() {
  const d = new Date();
  return `fir_${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`;
}

function genCrimeNo(districtId, stationId, year, serial) {
  return `1${String(districtId).padStart(4,'0')}${String(stationId).padStart(4,'0')}${year}${String(serial).padStart(5,'0')}`;
}

// Catalyst DataStore insert (best-effort)
async function dsInsert(table, row) {
  if (!CATALYST_APP) return row;
  try {
    return await CATALYST_APP.datastore().table(table).insertRow(row);
  } catch(e) {
    console.log(`[DS] ${table} insert failed: ${e.message}`);
    return row;
  }
}

// Catalyst NoSQL insert (best-effort)
async function nosqlInsert(table, doc) {
  if (!CATALYST_APP) { MEMORY_LOGS.push(doc); return; }
  try {
    await CATALYST_APP.nosql().table(table).insertRow(doc);
  } catch(e) {
    console.log(`[NoSQL] ${table} insert failed: ${e.message}`);
    MEMORY_LOGS.push(doc);
  }
}

// ─── Express app ──────────────────────────────────────────────
const app = express();

app.use(cors({ origin: '*', methods: ['GET','POST','PATCH','DELETE','OPTIONS'], allowedHeaders: '*' }));
app.use(express.json({ limit: '2mb' }));

// ─── Access Logging Middleware ─────────────────────────────────
app.use((req, res, next) => {
  const t0 = Date.now();
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  let user = 'anonymous';
  try { const p = decodeToken(token); if (p) user = p.email; } catch {}

  res.on('finish', () => {
    const ms = Date.now() - t0;
    const ip  = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?';
    console.log(`[${res.statusCode}] ${req.method} ${req.path} ${ms}ms user=${user} ip=${ip}`);
    const log = { key:`al:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`,
                  method:req.method, path:req.path, status:res.statusCode,
                  user, ip, ms, ts:new Date().toISOString() };
    nosqlInsert('access_log', log).catch(()=>{});
  });
  next();
});

// ─── Health ────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status:'healthy', service:'VigilanteVanguard', version:'4.1.0',
             platform:'Zoho Catalyst AppSail (Node)', catalyst_sdk:!!CATALYST_APP,
             node: process.version, in_memory_firs: MEMORY_FIRS.length });
});

// ─── Auth ──────────────────────────────────────────────────────
app.post('/api/v1/auth/login', (req, res) => {
  const { email='', password='' } = req.body;
  const u = USERS[email.toLowerCase().trim()];
  if (!u || u.password !== password) return res.status(401).json({ detail:'Invalid credentials' });
  const uid = String(Object.keys(USERS).indexOf(email.toLowerCase().trim()) + 1);
  const token = makeToken(email, u, uid);
  res.json({ token, user:{ user_id:uid, email, role:u.role, display_name:u.name, district_id:u.district_id }});
});

app.get('/api/v1/auth/me', (req, res) => {
  res.json({ user_id:'1', email:'admin@ksp.gov.in', role:'ADMINISTRATOR', display_name:'Admin Officer', district_id:5 });
});

// ─── FIR ───────────────────────────────────────────────────────
app.post('/api/v1/fir/', async (req, res) => {
  FIR_COUNTER++;
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const table = monthlyTable();
  const yr = now.getFullYear();
  const stationId = req.body.police_station_id || 5;
  const crimeNo = genCrimeNo(stationId, stationId, yr, FIR_COUNTER);
  const caseNo  = `${yr}${String(FIR_COUNTER).padStart(5,'0')}`;
  const caseId  = Math.abs(Buffer.from(crimeNo).reduce((a,b) => a*31+b, 0)) % 100000;

  const row = {
    CrimeNo: crimeNo, CaseNo: caseNo, MonthlyTable: table,
    CrimeRegisteredDate: today, PoliceStationID: stationId,
    CaseCategoryID: req.body.case_category_id || 1,
    CrimeMajorHeadID: req.body.crime_major_head_id || 1,
    CaseStatusID: 1, IncidentFromDate: req.body.incident_from_date || today,
    Latitude: req.body.latitude || null, Longitude: req.body.longitude || null,
    BriefFacts: req.body.brief_facts || '', CreatedAt: now.toISOString(),
  };
  MEMORY_FIRS.push(row);

  // Best-effort Catalyst writes
  await dsInsert('CaseMaster', row);
  await dsInsert(table, { ...row, CaseMasterID: caseId });
  await nosqlInsert('audit_log', { key:`fir:${crimeNo}:${Date.now()}`, event:'FIR_CREATED',
    crime_no:crimeNo, table, lat:row.Latitude, lng:row.Longitude, ts:now.toISOString() });

  // Broadcast live event to all connected clients
  pushEvent('FIR_REGISTERED', {
    crime_no:   crimeNo,
    station_id: stationId,
    brief_facts: (row.BriefFacts || '').slice(0, 80),
    table,
  });

  res.json({ case_master_id:caseId, crime_no:crimeNo, case_no:caseNo, monthly_table:table,
             crime_registered_date:today, police_station_id:stationId, case_category:'FIR',
             crime_major_head:'', brief_facts:row.BriefFacts, case_status:'Under Investigation',
             latitude:row.Latitude, longitude:row.Longitude, created_at:today });
});

app.get('/api/v1/fir/', (req, res) => {
  const { page=1, page_size=20 } = req.query;
  const offset = (parseInt(page)-1) * parseInt(page_size);
  const rows = MEMORY_FIRS.slice(offset, offset + parseInt(page_size));
  res.json({ data:rows, page:parseInt(page), page_size:parseInt(page_size), total:MEMORY_FIRS.length });
});

app.get('/api/v1/fir/monthly/summary', (req, res) => {
  const table = monthlyTable();
  const month_firs = MEMORY_FIRS.filter(f => f.MonthlyTable === table);
  res.json({ table, year:new Date().getFullYear(), month:new Date().getMonth()+1, total:month_firs.length, by_head:[] });
});

// ─── AI ────────────────────────────────────────────────────────
const KSP_INTEL = {
  murder:    'Karnataka 2026: 98 murders in Jan, 113 in Jun. Bengaluru City highest (13-17/month). Motives: disputes (38%), property (22%).',
  theft:     'Theft is highest-volume. Jan 2026: 2,867 statewide. Bengaluru City: 498 Jan, 710 Mar 2026.',
  cyber:     'Cyber crimes declining — Jan 680 to Jun 496 cases. Online fraud 78%. Bengaluru City 213 in Jan.',
  ndps:      'NDPS: Jan 729 to Jun 640. Shivamogga highest (37-88/month). Ganja, brown sugar most seized.',
  pocso:     'POCSO rising — Jan 593 to Jun 699. Tumakuru, Belagavi, Davanagere highest districts.',
  scst:      'SC/ST POA rising — Jan 436 to Jun 518. Ballari, Raichur, Bidar worst.',
  bengaluru: 'Bengaluru City: highest in state. Jan: 498 theft, 213 cyber, 85 POCSO, 446 hurt, 13 murder (~38% state total).',
  hotspot:   'Hotspots: Bengaluru (all zones), Belagavi District, Tumakuru, Shivamogga, Davanagere.',
  trend:     '2026 trends: Cyber -27%, POCSO +18%, murder stable, theft +14%, hurt +9%.',
};

app.post('/api/v1/ai/query', (req, res) => {
  const q = (req.body.query || '').toLowerCase();
  let response = `KSP 2026 Intelligence: Jan-Jun data across 38 districts. Ask about murder, theft, cyber, NDPS, POCSO, hotspots, trends, or districts like Bengaluru, Mysuru, Hubballi.`;
  for (const [key, val] of Object.entries(KSP_INTEL)) {
    if (q.includes(key)) { response = val; break; }
  }
  res.json({ response, language:req.body.language||'en', source:'embedded-ksp-2026' });
});

// ─── Analytics ─────────────────────────────────────────────────
app.get('/api/v1/analytics/summary', (req, res) => {
  res.json({
    total_cases: { jan:6842, feb:7234, mar:7891, apr:6234, may:7102, jun:7456 },
    murder:      { jan:98,   feb:75,   mar:81,   apr:78,   may:94,   jun:113  },
    cyber:       { jan:680,  feb:612,  mar:703,  apr:502,  may:510,  jun:496  },
    ndps:        { jan:729,  feb:689,  mar:820,  apr:490,  may:423,  jun:640  },
    pocso:       { jan:593,  feb:601,  mar:680,  apr:740,  may:758,  jun:699  },
  });
});

// ─── Live events REST endpoint (for fallback polling) ──────────
app.get('/api/v1/live/events', (req, res) => {
  const since = req.query.since;
  const events = since
    ? LIVE_EVENTS.filter(e => e.ts > since)
    : LIVE_EVENTS.slice(-20);
  res.json({ events, clients: wsClients.size, ts: new Date().toISOString() });
});

// ─── Broadcast REST endpoint (SOS page officer broadcast) ──────
app.post('/api/v1/live/broadcast', (req, res) => {
  const { zone, message, priority } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const event = pushEvent('BROADCAST', { zone: zone || 'All Districts', message, priority: priority || 'Normal' });
  res.json({ ok: true, event });
});

// ─── Logs ──────────────────────────────────────────────────────
app.get('/api/v1/logs', (req, res) => {
  const limit = parseInt(req.query.limit || '100');
  res.json({ logs:MEMORY_LOGS.slice(-limit), total:MEMORY_LOGS.length, source:'in_memory' });
});

// ─── Search ────────────────────────────────────────────────────
app.get('/api/v1/search/', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const results = q ? MEMORY_FIRS.filter(f => JSON.stringify(f).toLowerCase().includes(q)) : MEMORY_FIRS;
  res.json({ results, query:q, total:results.length });
});

// ─── Cases / Officers / Reports stubs ──────────────────────────
app.get('/api/v1/cases/', (req, res) => res.json({ data:[], total:0 }));
app.get('/api/v1/officers/', (req, res) => res.json({ data:[], total:0 }));
app.get('/api/v1/reports/', (req, res) => res.json({ data:[], total:0 }));

// ─── Start: HTTP server + WebSocket server on same port ────────
const server = http.createServer(app);

if (WebSocketServer) {
  const wss = new WebSocketServer({ server, path: '/ws/live' });

  wss.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?';
    console.log(`[WS] client connected ip=${ip} total=${wsClients.size + 1}`);
    wsClients.add(ws);

    // Send last 20 events as backlog so new clients catch up immediately
    try {
      ws.send(JSON.stringify({
        type: 'BACKLOG',
        payload: { events: LIVE_EVENTS.slice(-20) },
        ts: new Date().toISOString(),
      }));
    } catch(e) {}

    ws.on('message', (raw) => {
      // Clients can push events too (e.g. alert triggers from SOS panel)
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type && msg.payload) pushEvent(msg.type, msg.payload);
      } catch(e) {}
    });

    ws.on('close', () => {
      wsClients.delete(ws);
      console.log(`[WS] client disconnected total=${wsClients.size}`);
    });

    ws.on('error', () => wsClients.delete(ws));
  });

  console.log('[WS] WebSocket server mounted at /ws/live');
} else {
  console.log('[WS] Disabled — install ws package: npm install ws');
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[OK] VigilanteVanguard v4.2 running on port ${PORT} (Node ${process.version})`);
  console.log(`[OK] Catalyst SDK: ${!!CATALYST_APP}`);
  console.log(`[OK] WebSocket live feed: ${!!WebSocketServer}`);
  console.log('[OK] Karnataka State Police Datathon 2026');
});
