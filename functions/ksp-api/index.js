/**
 * index.js
 * ────────────────────────────────────────────────────────────────
 * VigilanteVanguard — Catalyst Advanced I/O Cloud Function
 * Entry point for the ksp-api function.
 *
 * Routes:
 *   POST /receive_incident     — receive RPi5 accident incident
 *   POST /update_incident      — update video URL after upload
 *   POST /register_device      — register police officer FCM token
 *   GET  /health               — function health check
 *
 * Deploy: Catalyst Console → Functions → ksp-api → Deploy
 * Runtime: Node.js 18
 * Type: Advanced I/O
 */

const catalyst = require("zcatalyst-sdk-node");

// ── Table names ───────────────────────────────────────────────────
const RPI_TABLE    = "RpiIncidentTable";
const DEVICE_TABLE = "DeviceTokenTable";

// ── Config from Catalyst env vars ────────────────────────────────
const POLICE_EMAIL   = process.env.POLICE_EMAIL   || "police@station.gov.in";
const FROM_EMAIL     = process.env.FROM_EMAIL     || "alerts@vigilantevanguard.zohoapp.in";
const CC_EMAIL       = process.env.CC_EMAIL       || "";

// ── Severity helpers ──────────────────────────────────────────────
const SEV_COLOUR = {
  CRITICAL: "#dc2626", HIGH: "#f97316",
  MEDIUM: "#f59e0b",   LOW:  "#4CAF50", MONITOR: "#2196F3",
};
const SEV_EMOJI = {
  CRITICAL: "🔴", HIGH: "🟠", MEDIUM: "🟡", LOW: "🟢", MONITOR: "🔵",
};
const SEV_PRIORITY = {
  CRITICAL: "high", HIGH: "high", MEDIUM: "normal", LOW: "low", MONITOR: "low",
};


// ═══════════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════

module.exports = async (context, basicIO) => {
  const app    = catalyst.initialize(context);
  const method = basicIO.getRequestMethod ? basicIO.getRequestMethod() : "POST";
  const path   = basicIO.getRequestPath   ? basicIO.getRequestPath()   : "";

  // Parse body
  let body = {};
  try {
    const raw = basicIO.getRequestBody();
    body = typeof raw === "string" ? JSON.parse(raw) : (raw || {});
  } catch (e) {
    basicIO.setStatusCode(400);
    basicIO.setResponse(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  console.log(`[ksp-api] ${method} ${path}  update_type=${body.update_type || "none"}`);

  try {
    // ── Route by update_type or path ──────────────────────────────
    if (body.update_type === "video_ready" || path.includes("update_incident")) {
      await _handleVideoUpdate(app, body, basicIO);

    } else if (path.includes("register_device")) {
      await _handleDeviceRegister(app, body, basicIO);

    } else if (path.includes("health") || method === "GET") {
      basicIO.setStatusCode(200);
      basicIO.setResponse(JSON.stringify({
        status: "active",
        function: "ksp-api",
        version: "2.0.0",
        tables: [RPI_TABLE, DEVICE_TABLE],
      }));

    } else {
      // Default: receive_incident
      await _handleReceiveIncident(app, body, basicIO);
    }

  } catch (err) {
    console.error("[ksp-api] Unhandled error:", err);
    basicIO.setStatusCode(500);
    basicIO.setResponse(JSON.stringify({ error: err.message }));
  }
};


// ═══════════════════════════════════════════════════════════════════
//  RECEIVE INCIDENT
// ═══════════════════════════════════════════════════════════════════

async function _handleReceiveIncident(app, body, basicIO) {
  // Validate required fields
  if (!body.incident_id || !body.severity || !body.incident || !body.location) {
    basicIO.setStatusCode(400);
    basicIO.setResponse(JSON.stringify({ error: "Missing required fields: incident_id, severity, incident, location" }));
    return;
  }

  const severity  = body.severity  || {};
  const incident  = body.incident  || {};
  const location  = body.location  || {};
  const video     = body.video     || {};
  const dispatch  = body.dispatch  || {};

  console.log(`[ksp-api] Incident ${body.incident_id}  severity=${severity.label}`);

  // ── 1. Store in RpiIncidentTable ──────────────────────────────
  const rowId = await _storeIncident(app, {
    incident_id:      body.incident_id,
    camera_id:        body.camera_id      || "CAM0",
    severity_label:   severity.label      || "MONITOR",
    severity_score:   severity.score      || 0,
    incident_type:    incident.type       || "unknown",
    description:      incident.description || "",
    lat:              location.lat        || 0,
    lng:              location.lng        || 0,
    address_short:    location.address_short || "",
    address_full:     location.address_full  || "",
    maps_url:         location.maps_url   || "",
    plates:           JSON.stringify(incident.plates || []),
    video_url:        video.cloud_url     || "",
    all_classes:      JSON.stringify(incident.all_classes || []),
    vehicle_count:    incident.vehicle_count  || 0,
    person_down:      incident.person_down    ? "true" : "false",
    fire_detected:    incident.fire_detected  ? "true" : "false",
    rollover:         incident.rollover       ? "true" : "false",
    dispatch_actions: JSON.stringify(dispatch.actions || []),
    timestamp_utc:    body.timestamp_utc  || new Date().toISOString(),
    timestamp_local:  body.timestamp_local || new Date().toString(),
    raw_payload:      JSON.stringify(body).substring(0, 4000),
  });

  // ── 2. Push notification (MEDIUM and above, score >= 2) ───────
  if ((severity.score || 0) >= 2) {
    _sendPush(app, {
      incident_id:    body.incident_id,
      severity_label: severity.label,
      severity_score: severity.score,
      incident_type:  incident.type,
      description:    incident.description,
      address_short:  location.address_short,
      maps_url:       location.maps_url || location.google_maps,
      video_url:      video.cloud_url || "",
      lat:            location.lat,
      lng:            location.lng,
      person_down:    incident.person_down,
      fire_detected:  incident.fire_detected,
    }).catch(e => console.error("[ksp-api] Push error:", e));
  }

  // ── 3. Email alert (HIGH and CRITICAL, score >= 3) ────────────
  if ((severity.score || 0) >= 3) {
    _sendEmail(app, body).catch(e => console.error("[ksp-api] Email error:", e));
  }

  basicIO.setStatusCode(200);
  basicIO.setResponse(JSON.stringify({
    status:      "received",
    incident_id: body.incident_id,
    row_id:      rowId,
    severity:    severity.label,
  }));
}


// ═══════════════════════════════════════════════════════════════════
//  VIDEO URL UPDATE
// ═══════════════════════════════════════════════════════════════════

async function _handleVideoUpdate(app, body, basicIO) {
  const { incident_id, video_url } = body;
  if (!incident_id || !video_url) {
    basicIO.setStatusCode(400);
    basicIO.setResponse(JSON.stringify({ error: "incident_id and video_url required" }));
    return;
  }

  try {
    const zcql   = app.zcql();
    const result = await zcql.executeZCQLQuery(
      `SELECT ROWID FROM ${RPI_TABLE} WHERE incident_id = '${incident_id}' LIMIT 1`
    );

    if (result && result.length > 0) {
      const rowId = result[0][RPI_TABLE]?.ROWID;
      if (rowId) {
        await app.datastore().table(RPI_TABLE).updateRow({
          ROWID:     rowId,
          video_url: video_url,
        });
        console.log(`[ksp-api] Video URL updated: ${incident_id} → ${video_url}`);
      }
    }

    basicIO.setStatusCode(200);
    basicIO.setResponse(JSON.stringify({ status: "updated", incident_id, video_url }));
  } catch (err) {
    console.error("[ksp-api] Video update error:", err);
    basicIO.setStatusCode(500);
    basicIO.setResponse(JSON.stringify({ error: err.message }));
  }
}


// ═══════════════════════════════════════════════════════════════════
//  DEVICE REGISTER
// ═══════════════════════════════════════════════════════════════════

async function _handleDeviceRegister(app, body, basicIO) {
  const { officer_name, station, fcm_token } = body;
  if (!fcm_token) {
    basicIO.setStatusCode(400);
    basicIO.setResponse(JSON.stringify({ error: "fcm_token required" }));
    return;
  }

  try {
    const zcql    = app.zcql();
    const table   = app.datastore().table(DEVICE_TABLE);

    // Check if token already exists → update, else insert
    const existing = await zcql.executeZCQLQuery(
      `SELECT ROWID FROM ${DEVICE_TABLE} WHERE fcm_token = '${fcm_token}' LIMIT 1`
    );

    const row = {
      officer_name:  officer_name  || "Unknown Officer",
      station:       station       || "Unknown Station",
      fcm_token:     fcm_token,
      active:        "true",
      registered_at: new Date().toISOString(),
    };

    let rowId;
    if (existing && existing.length > 0) {
      rowId = existing[0][DEVICE_TABLE]?.ROWID;
      if (rowId) {
        await table.updateRow({ ROWID: rowId, ...row });
        console.log(`[ksp-api] Device token updated: ${officer_name}`);
      }
    } else {
      const inserted = await table.insertRow(row);
      rowId = inserted.ROWID;
      console.log(`[ksp-api] New device registered: ${officer_name}`);
    }

    basicIO.setStatusCode(200);
    basicIO.setResponse(JSON.stringify({
      status: "registered", row_id: rowId,
      officer: officer_name, station,
    }));
  } catch (err) {
    console.error("[ksp-api] Device register error:", err);
    basicIO.setStatusCode(500);
    basicIO.setResponse(JSON.stringify({ error: err.message }));
  }
}


// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════

async function _storeIncident(app, row) {
  try {
    const inserted = await app.datastore().table(RPI_TABLE).insertRow(row);
    return inserted.ROWID || null;
  } catch (err) {
    console.error("[ksp-api] DataStore insert error:", err.message);
    return null;
  }
}

async function _sendPush(app, data) {
  const zcql   = app.zcql();
  const tokens = await zcql.executeZCQLQuery(
    `SELECT fcm_token, officer_name FROM ${DEVICE_TABLE} WHERE active = 'true'`
  );
  if (!tokens || tokens.length === 0) return;

  const push  = app.push();
  const emoji = SEV_EMOJI[data.severity_label]  || "⚠️";
  const col   = SEV_COLOUR[data.severity_label] || "#888";
  const prio  = SEV_PRIORITY[data.severity_label] || "normal";

  const title = `${emoji} ${data.severity_label} ROAD ACCIDENT`;
  let   body  = `${(data.incident_type||"").replace(/_/g," ").toUpperCase()} — ${data.address_short || `${data.lat?.toFixed(4)}, ${data.lng?.toFixed(4)}`}`;
  if (data.person_down)   body += " | ⚠️ Person on road";
  if (data.fire_detected) body += " | 🔥 Fire";

  for (const row of tokens) {
    const fcm = row[DEVICE_TABLE]?.fcm_token;
    if (!fcm) continue;
    try {
      await push.send({
        token: fcm, title, body,
        data: {
          incident_id:   data.incident_id  || "",
          severity:      data.severity_label,
          severity_score:String(data.severity_score || 0),
          lat:           String(data.lat || 0),
          lng:           String(data.lng || 0),
          maps_url:      data.maps_url     || "",
          video_url:     data.video_url    || "",
          screen:        "IncidentDetail",
        },
        android: { priority: prio, channelId: "vv_incidents", color: col,
                   sound: (data.severity_score||0) >= 4 ? "alarm" : "default" },
        apns:    { sound: (data.severity_score||0) >= 4 ? "alarm.caf" : "default", badge: 1 },
      });
      console.log(`[ksp-api] Push → token ...${fcm.slice(-8)}`);
    } catch (e) {
      console.error(`[ksp-api] Push fail ...${fcm.slice(-8)}: ${e.message}`);
    }
  }
}

async function _sendEmail(app, body) {
  const sev       = body.severity   || {};
  const incident  = body.incident   || {};
  const location  = body.location   || {};
  const video     = body.video      || {};

  const col     = SEV_COLOUR[sev.label] || "#555";
  const mapsUrl = location.maps_url || location.google_maps ||
    `https://maps.google.com/?q=${location.lat},${location.lng}`;
  const plates  = (incident.plates || []).join(", ") || "Not detected";
  const videoSec = video.cloud_url
    ? `<p><strong>📹 Footage:</strong> <a href="${video.cloud_url}">▶ Watch Video</a></p>`
    : "<p><strong>📹 Footage:</strong> Upload in progress — check dashboard.</p>";

  const warnings = [
    incident.person_down    ? '<p style="color:#c62828;">⚠️ <strong>Person on road — urgent medical help</strong></p>' : "",
    incident.fire_detected  ? '<p style="color:#c62828;">🔥 <strong>Vehicle fire detected</strong></p>'               : "",
    incident.rollover       ? '<p style="color:#c62828;">🔄 <strong>Vehicle rollover detected</strong></p>'            : "",
  ].join("");

  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;">
<div style="background:#1a237e;padding:18px 28px;border-radius:8px 8px 0 0;">
  <h2 style="color:#fff;margin:0;">🚨 VigilanteVanguard — RPi5 Road Accident Alert</h2>
  <p style="color:#9fa8da;margin:4px 0 0;font-size:13px;">Edge Unit ${body.camera_id || "CAM0"}</p>
</div>
<div style="background:#fff;padding:22px 28px;border-radius:0 0 8px 8px;box-shadow:0 2px 8px rgba(0,0,0,.1);">
  <p><strong>Severity:</strong> <span style="background:${col};color:#fff;padding:4px 14px;border-radius:4px;font-weight:bold;">${sev.label}</span></p>
  <p><strong>ID:</strong> ${body.incident_id} &nbsp; <strong>Time:</strong> ${body.timestamp_local || new Date().toString()}</p>
  <p><strong>Type:</strong> ${(incident.type||"").replace(/_/g," ").toUpperCase()}</p>
  <p><strong>Description:</strong> ${incident.description || ""}</p>
  ${warnings}
  <hr style="border-top:1px solid #e0e0e0;margin:14px 0;">
  <h3 style="color:#1a237e;margin:0 0 6px;">📍 Location</h3>
  <p>${location.address_full || location.address_short || "GPS only"}</p>
  <p><strong>GPS:</strong> ${(location.lat||0).toFixed(6)}, ${(location.lng||0).toFixed(6)}</p>
  <a href="${mapsUrl}" style="background:#1565c0;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;display:inline-block;">📌 Google Maps</a>
  <hr style="border-top:1px solid #e0e0e0;margin:14px 0;">
  <p><strong>Vehicles:</strong> ${incident.vehicle_count || 0} &nbsp; <strong>Plates:</strong> ${plates}</p>
  ${videoSec}
  <p style="font-size:11px;color:#9e9e9e;text-align:center;">Auto-alert from VigilanteVanguard RPi5 • ${body.incident_id} • Do not reply</p>
</div></body></html>`;

  const mailOpts = {
    from_email: FROM_EMAIL,
    from_name:  "VigilanteVanguard Alert",
    to_email:   POLICE_EMAIL,
    subject:    `[${sev.label}] RPi5 Road Accident — ${location.address_short || incident.type} [${body.incident_id}]`,
    html_body:  html,
  };
  if (CC_EMAIL) mailOpts.cc_email = CC_EMAIL;

  await app.mail().sendMail(mailOpts);
  console.log(`[ksp-api] Email sent to ${POLICE_EMAIL}`);
}
