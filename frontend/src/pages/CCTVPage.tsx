/**
 * CCTVPage.tsx — AI Smart CCTV Surveillance & Emergency Dispatch
 * VigilanteVanguard — Karnataka State Police
 *
 * Features:
 *  • Real-time incident feed via WebSocket
 *  • Multi-source video input (webcam, IP cam, file upload, demo simulation)
 *  • Interactive Google Maps / Leaflet showing incidents + stations
 *  • AI incident details: snapshot, summary, confidence, timestamp
 *  • Officer actions: Confirm / False Alarm / Dispatch
 *  • Analytics panel
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MapContainer, TileLayer, Marker, Popup, Circle, useMap,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Video, Camera, Upload, Wifi, WifiOff, AlertTriangle,
  CheckCircle, XCircle, Siren, MapPin, Shield, Eye, Square,
  Activity, RefreshCw, Users, Clock, Zap, TrendingUp,
  Play, ChevronRight, Info, Download, BrainCircuit,
  VolumeX, Volume2, Gauge, History, Film, X,
} from 'lucide-react'
import { useCCTVStore, type CCTVIncident } from '@/store/cctv'
import { useCCTVSocket, playAlertSound, playConfirmSound } from '@/hooks/useCCTVSocket'
import {
  fetchIncidents, fetchCameras, fetchStations,
  updateIncident, uploadVideo, analyseFrame,
  fetchCCTVAnalytics, registerCamera,
  grabIPCamFrame, grabIPCamFramesBatch, mjpegStreamUrl,
} from '@/lib/cctvApi'
import { cn } from '@/lib/utils'

// ── Fix Leaflet default icon paths ────────────────────────────
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// ─── Custom incident icon factory ──────────────────────────────
function makeIncidentIcon(colour: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;background:${colour};border:2px solid white;border-radius:50%;box-shadow:0 0 6px ${colour}"></div>`,
    iconSize:  [14, 14],
    iconAnchor:[7, 7],
  })
}

const INCIDENT_COLOURS: Record<string, string> = {
  'Road Accident':      '#ef4444',
  'Physical Fight':     '#f97316',
  'Weapon Detected':    '#a855f7',
  'Fire / Smoke':       '#f59e0b',
  'Theft / Robbery':    '#06b6d4',
  'Person Unconscious': '#64748b',
  'Suspicious Activity':'#14b8a6',
  'Vehicle Collision':  '#ec4899',
}
const DEFAULT_COLOUR = '#6b7280'

function incidentColour(type: string) {
  return INCIDENT_COLOURS[type] ?? DEFAULT_COLOUR
}

// ─── Status badges ─────────────────────────────────────────────
const STATUS_STYLE: Record<string, string> = {
  PENDING:     'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  CONFIRMED:   'bg-green-900/50  text-green-300  border border-green-700',
  FALSE_ALARM: 'bg-gray-800      text-gray-400   border border-gray-600',
  DISPATCHED:  'bg-blue-900/50   text-blue-300   border border-blue-700',
}

// ─── Confidence bar colour ──────────────────────────────────────
function confColour(c: number) {
  if (c >= 0.80) return 'bg-red-500'
  if (c >= 0.60) return 'bg-amber-500'
  return 'bg-green-500'
}

// ─── Format timestamp ──────────────────────────────────────────
function fmtTs(ts: string) {
  try {
    return new Date(ts).toLocaleString('en-IN', {
      dateStyle: 'short', timeStyle: 'medium',
    })
  } catch { return ts }
}

// ═══════════════════════════════════════════════════════════════
//  MAP AUTO-FIT
// ═══════════════════════════════════════════════════════════════

function MapFit({ incidents }: { incidents: CCTVIncident[] }) {
  const map = useMap()
  useEffect(() => {
    if (!incidents.length) return
    const bounds = L.latLngBounds(incidents.map(i => [i.latitude, i.longitude]))
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
    }
  }, [incidents.length]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// ═══════════════════════════════════════════════════════════════
//  INCIDENT CARD
// ═══════════════════════════════════════════════════════════════

function IncidentCard({
  incident,
  selected,
  onClick,
}: {
  incident: CCTVIncident
  selected: boolean
  onClick: () => void
}) {
  const colour = incidentColour(incident.incident_type)
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 rounded-lg border transition-all',
        selected
          ? 'bg-gray-700 border-blue-500 ring-1 ring-blue-500/50'
          : 'bg-gray-800/80 border-gray-700 hover:bg-gray-700/80 hover:border-gray-600'
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5"
            style={{ background: colour }}
          />
          <span className="text-xs font-semibold text-white truncate">
            {incident.incident_type}
          </span>
        </div>
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0',
          STATUS_STYLE[incident.status] ?? STATUS_STYLE.PENDING)}>
          {incident.status}
        </span>
      </div>

      {/* Camera */}
      <p className="text-[11px] text-gray-400 truncate mb-1">
        📷 {incident.camera_name}
      </p>

      {/* Confidence + time */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <div className="h-1.5 flex-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', confColour(incident.confidence))}
              style={{ width: `${Math.round(incident.confidence * 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-400 flex-shrink-0">
            {Math.round(incident.confidence * 100)}%
          </span>
        </div>
        <span className="text-[10px] text-gray-500 flex-shrink-0">
          {fmtTs(incident.timestamp)}
        </span>
      </div>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════
//  INCIDENT DETAIL PANEL
// ═══════════════════════════════════════════════════════════════

function IncidentDetail({
  incident,
  onClose,
  onAction,
  loading,
}: {
  incident: CCTVIncident
  onClose: () => void
  onAction: (action: 'CONFIRM' | 'FALSE_ALARM' | 'DISPATCH', notes?: string) => void
  loading: boolean
}) {
  const [notes, setNotes] = useState('')

  const colour     = incidentColour(incident.incident_type)
  const isPending  = incident.status === 'PENDING'
  const isConfirmed= incident.status === 'CONFIRMED'

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${incident.latitude},${incident.longitude}`

  const sev = incident.severity
  const loc = incident.location

  // Severity badge styles
  const SEV_STYLE: Record<string, string> = {
    CRITICAL: 'bg-red-900/60 text-red-300 border-red-700',
    HIGH:     'bg-orange-900/60 text-orange-300 border-orange-700',
    MEDIUM:   'bg-yellow-900/40 text-yellow-300 border-yellow-700/60',
    LOW:      'bg-gray-800 text-gray-400 border-gray-700',
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700"
           style={{ borderLeft: `4px solid ${sev?.colour ?? colour}` }}>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-bold text-white">{incident.incident_type}</h3>
            {sev && (
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded border font-bold',
                SEV_STYLE[sev.level] ?? SEV_STYLE.LOW
              )}>
                {sev.level}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">{incident.incident_id} · {fmtTs(incident.timestamp)}</p>
        </div>
        <button onClick={onClose}
          className="text-gray-500 hover:text-white transition-colors text-xl leading-none">
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Severity block */}
        {sev && (
          <div className={cn(
            'rounded-lg p-3 border space-y-1',
            SEV_STYLE[sev.level]
          )} style={{ background: `${sev.colour}15` }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Siren className="h-3.5 w-3.5" style={{ color: sev.colour }} />
                <span className="text-xs font-bold" style={{ color: sev.colour }}>
                  Severity Score: {sev.score}/100
                </span>
              </div>
              <span className="text-xs font-medium" style={{ color: sev.colour }}>
                ETA ~{sev.response_eta_minutes} min
              </span>
            </div>
            <p className="text-[11px] text-gray-400">{sev.description}</p>
          </div>
        )}

        {/* Snapshot */}
        <div className="rounded-lg overflow-hidden border border-gray-700 bg-gray-950">
          <img
            src={incident.snapshot}
            alt="Incident snapshot"
            className="w-full object-cover"
            style={{ minHeight: 100, maxHeight: 150 }}
          />
          <div className="px-3 py-1.5 flex items-center justify-between">
            <span className="text-[10px] text-gray-500">AI Snapshot</span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded',
              STATUS_STYLE[incident.status] ?? STATUS_STYLE.PENDING)}>
              {incident.status}
            </span>
          </div>
        </div>

        {/* Confidence */}
        <div className="bg-gray-800/60 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400 font-medium">Confidence Score</span>
            <span className="text-sm font-bold" style={{ color: colour }}>
              {Math.round(incident.confidence * 100)}%
            </span>
          </div>
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', confColour(incident.confidence))}
              style={{ width: `${Math.round(incident.confidence * 100)}%` }}
            />
          </div>
        </div>

        {/* AI Summary */}
        <div className="bg-gray-800/60 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Zap className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-xs font-medium text-blue-400">AI Summary</span>
          </div>
          <p className="text-xs text-gray-300 leading-relaxed">{incident.ai_summary}</p>
        </div>

        {/* Exact Location */}
        <div className="bg-gray-800/60 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-3.5 w-3.5 text-red-400" />
            <span className="text-xs font-semibold text-white">Location</span>
          </div>
          <div className="flex items-center gap-2">
            <Camera className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs text-gray-300">{incident.camera_name}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs text-gray-300 truncate">
              {loc?.address || incident.camera_location}
            </span>
          </div>
          {loc?.what3words && (
            <div className="flex items-center gap-2">
              <Info className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-[11px] text-blue-300 font-medium">{loc.what3words}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs text-gray-300">
              {incident.assigned_station}
              {incident.assigned_station_phone && (
                <span className="text-blue-400 ml-2">· {incident.assigned_station_phone}</span>
              )}
            </span>
          </div>
          <a
            href={loc?.maps_url ?? mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] text-blue-400 hover:text-blue-300 mt-1"
          >
            <MapPin className="h-3 w-3" />
            Open in Google Maps ↗
          </a>
        </div>

        {/* Last 5-second incident clip */}
        <IncidentClipPlayer incident={incident} />

        {/* Dispatch recommendation (if confirmed) */}
        {incident.dispatch_recommended && incident.status === 'CONFIRMED' && (
          <div className="bg-blue-950/40 border border-blue-700/40 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Siren className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-xs font-semibold text-blue-400">Dispatch Recommended</span>
            </div>
            <p className="text-xs text-blue-300">
              Nearest station: <strong>{incident.assigned_station}</strong>
              {incident.assigned_station_phone && (
                <span className="text-blue-400 ml-2">· 📞 {incident.assigned_station_phone}</span>
              )}
            </p>
          </div>
        )}

        {/* Notes */}
        {(isPending || isConfirmed) && (
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add officer notes (optional)"
            rows={2}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs
                       text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
          />
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-gray-700 space-y-2">
        {isPending && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onAction('CONFIRM', notes || undefined)}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 bg-green-700 hover:bg-green-600
                         disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Confirm Incident
            </button>
            <button
              onClick={() => onAction('FALSE_ALARM', notes || undefined)}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 bg-gray-700 hover:bg-gray-600
                         disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
            >
              <XCircle className="h-3.5 w-3.5" />
              False Alarm
            </button>
          </div>
        )}
        {isConfirmed && (
          <button
            onClick={() => onAction('DISPATCH')}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-600
                       disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-lg transition-colors"
          >
            <Siren className="h-4 w-4" />
            Dispatch — {incident.assigned_station}
          </button>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  VIDEO SOURCE PANEL
// ═══════════════════════════════════════════════════════════════

// ── RPi5 / IP Camera address — persisted to localStorage ─────────
// The user types the RPi5's current IP once per WiFi network.
// This is saved and used to build stream URLs automatically.
export const RPI_IP_LS_KEY = 'vv_rpi_ip'

export function loadRpiIp(): string {
  try { return localStorage.getItem(RPI_IP_LS_KEY) ?? '' } catch { return '' }
}
export function saveRpiIp(ip: string) {
  try { localStorage.setItem(RPI_IP_LS_KEY, ip.trim()) } catch { /* ignore */ }
}

/** Build the RPi5 Flask live-stream URL from a bare IP or full URL */
export function rpiStreamUrl(ip: string): string {
  if (!ip.trim()) return ''
  if (ip.startsWith('http')) return ip.trim()
  return `http://${ip.trim()}:5000/video_feed`
}

// ── Animated demo CCTV canvas ──────────────────────────────────
// Renders a simulated live feed when no real stream is available.
function DemoCCTVCanvas({ width = 640, height = 360 }: { width?: number; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef  = useRef(0)
  const rafRef    = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const INCIDENT_LABELS = [
      'Normal / No Incident', 'Normal / No Incident', 'Normal / No Incident',
      'Suspicious Activity', 'Road Accident', 'Vehicle Collision',
    ]
    let incidentLabel = ''
    let incidentFlash = 0

    const draw = () => {
      frameRef.current++
      const f = frameRef.current

      // Background — dark night road scene
      ctx.fillStyle = '#0a0f1a'
      ctx.fillRect(0, 0, width, height)

      // Road
      ctx.fillStyle = '#1a1f2e'
      ctx.fillRect(0, height * 0.55, width, height)

      // Lane markings
      ctx.strokeStyle = '#ffffff33'
      ctx.lineWidth = 3
      ctx.setLineDash([30, 20])
      ctx.beginPath()
      ctx.moveTo(width / 2, height * 0.55)
      ctx.lineTo(width / 2, height)
      ctx.stroke()
      ctx.setLineDash([])

      // Moving cars
      const car1x = ((f * 1.5) % (width + 100)) - 60
      const car2x = width - (((f * 2.2) % (width + 120)) - 80)
      // car 1
      ctx.fillStyle = '#3b82f6'
      ctx.fillRect(car1x, height * 0.65, 80, 30)
      ctx.fillStyle = '#1d4ed8'
      ctx.fillRect(car1x + 10, height * 0.58, 55, 20)
      // headlights
      ctx.fillStyle = '#fef9c3'
      ctx.fillRect(car1x + 72, height * 0.67, 8, 8)
      // car 2
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(car2x - 80, height * 0.72, 80, 30)
      ctx.fillStyle = '#b91c1c'
      ctx.fillRect(car2x - 70, height * 0.65, 55, 20)
      // tail lights
      ctx.fillStyle = '#fca5a5'
      ctx.fillRect(car2x - 80, height * 0.74, 8, 8)

      // Buildings silhouette
      ctx.fillStyle = '#111827'
      const buildings = [
        [20, 80, 70, height * 0.55], [110, 120, 60, height * 0.55],
        [190, 90, 80, height * 0.55], [290, 140, 55, height * 0.55],
        [365, 100, 65, height * 0.55], [450, 110, 70, height * 0.55],
        [540, 85, 75, height * 0.55],
      ]
      buildings.forEach(([x, bh, w2, y]) => {
        ctx.fillRect(x, (y as number) - (bh as number), w2 as number, bh as number)
        // windows
        ctx.fillStyle = '#fef08a44'
        for (let wy = (y as number) - (bh as number) + 10; wy < (y as number) - 10; wy += 18) {
          for (let wx = (x as number) + 6; wx < (x as number) + (w2 as number) - 6; wx += 14) {
            if (Math.sin(wx * 7 + wy * 3 + f * 0.01) > 0.2) {
              ctx.fillRect(wx, wy, 8, 10)
            }
          }
        }
        ctx.fillStyle = '#111827'
      })

      // Occasional incident flash (every ~600 frames)
      if (f % 600 === 0) {
        incidentLabel = INCIDENT_LABELS[Math.floor(Math.random() * INCIDENT_LABELS.length)]
        incidentFlash = 60
      }
      if (incidentFlash > 0) {
        incidentFlash--
        const alpha = Math.min(1, incidentFlash / 20)
        if (incidentLabel !== 'Normal / No Incident') {
          ctx.fillStyle = `rgba(220,38,38,${alpha * 0.25})`
          ctx.fillRect(0, 0, width, height)
          // Bounding box
          ctx.strokeStyle = `rgba(239,68,68,${alpha})`
          ctx.lineWidth = 3
          ctx.strokeRect(car2x - 95, height * 0.6, 110, 50)
          ctx.fillStyle = `rgba(239,68,68,${alpha})`
          ctx.fillRect(car2x - 95, height * 0.6 - 20, 130, 20)
          ctx.fillStyle = 'white'
          ctx.font = 'bold 11px monospace'
          ctx.fillText(incidentLabel.toUpperCase(), car2x - 90, height * 0.6 - 6)
        }
      }

      // Scan-line effect (subtle)
      for (let y = 0; y < height; y += 4) {
        ctx.fillStyle = 'rgba(0,0,0,0.06)'
        ctx.fillRect(0, y, width, 2)
      }

      // Timestamp
      const now = new Date()
      const ts = now.toLocaleString('en-IN', { hour12: false })
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, height - 26, width, 26)
      ctx.fillStyle = '#e5e7eb'
      ctx.font = '11px monospace'
      ctx.fillText(`CAM-DEMO  ${ts}`, 8, height - 10)

      // REC badge
      ctx.fillStyle = '#dc2626'
      ctx.beginPath()
      ctx.arc(width - 52, height - 14, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#f9fafb'
      ctx.font = 'bold 10px monospace'
      ctx.fillText('REC', width - 44, height - 10)

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [width, height])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full rounded"
      style={{ imageRendering: 'pixelated' }}
    />
  )
}

// ── Shared IP-cam state type (passed down from CCTVPage) ──────
interface IPCamState {
  ipUrl:        string
  setIpUrl:     (u: string) => void
  ipCamId:      string
  setIpCamId:   (id: string) => void
  ipUsername:   string
  setIpUsername:(u: string) => void
  ipPassword:   string
  setIpPassword:(p: string) => void
  ipStreaming:  boolean
  ipStatus:     'idle' | 'connecting' | 'live' | 'error'
  setIpStatus:  (s: 'idle' | 'connecting' | 'live' | 'error') => void
  ipPreview:    string
  ipLastDetect: string
  ipFrameCount: number
  errMsg:       string
  setErrMsg:    (m: string) => void
  startIPCam:   () => void
  stopIPCam:    () => void
}

function VideoSourcePanel({
  onIncidentDetected,
  ipcam,
}: {
  onIncidentDetected: () => void
  ipcam: IPCamState
}) {
  // Default to 'ipcam' since phone camera is the primary source
  const [tab, setTab] = useState<'webcam' | 'ipcam' | 'upload'>('ipcam')
  const [streaming,  setStreaming]  = useState(false)

  // ── RPi5 IP state — persisted to localStorage ──────────────────
  const [rpiIp,     setRpiIpState] = useState<string>(loadRpiIp)
  const [rpiSaved,  setRpiSaved]   = useState(false)

  const handleRpiIpChange = (val: string) => {
    setRpiIpState(val)
    setRpiSaved(false)
    // Auto-fill the stream URL when user types a bare IP
    const url = rpiStreamUrl(val)
    if (url) ipcam.setIpUrl(url)
  }
  const saveRpiIpNow = () => {
    saveRpiIp(rpiIp)
    setRpiSaved(true)
    setTimeout(() => setRpiSaved(false), 2000)
  }

  // ── Destructure shared IP cam state ──────────────────────────
  const {
    ipUrl, setIpUrl, ipCamId, setIpCamId,
    ipUsername, setIpUsername, ipPassword, setIpPassword,
    ipStreaming, ipStatus, setIpStatus, ipPreview, ipLastDetect, ipFrameCount,
    errMsg: ipErrMsg, setErrMsg: setIpErrMsg, startIPCam, stopIPCam,
  } = ipcam

  // ── Webcam state ──────────────────────────────────────────────
  const [uploadPct,   setUploadPct]  = useState<number | null>(null)
  const [uploadMsg,   setUploadMsg]  = useState('')
  const [webcamErr,   setWebcamErr]  = useState('')
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wcTimerRef= useRef<ReturnType<typeof setInterval> | null>(null)
  const fileRef   = useRef<HTMLInputElement>(null)

  // ── Cleanup webcam on unmount (IP cam lives in parent) ───────
  useEffect(() => { return () => stopWebcam() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stopWebcam = useCallback(() => {
    if (wcTimerRef.current) clearInterval(wcTimerRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setStreaming(false)
  }, [])

  const startWebcam = useCallback(async () => {
    setWebcamErr('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setStreaming(true)
      wcTimerRef.current = setInterval(async () => {
        if (!canvasRef.current || !videoRef.current) return
        const ctx = canvasRef.current.getContext('2d')
        if (!ctx) return
        canvasRef.current.width  = videoRef.current.videoWidth  || 320
        canvasRef.current.height = videoRef.current.videoHeight || 240
        ctx.drawImage(videoRef.current, 0, 0)
        const b64 = canvasRef.current.toDataURL('image/jpeg', 0.7)
        try {
          const result = await analyseFrame('CAM-WEBCAM', b64)
          if (result.detected) onIncidentDetected()
        } catch { /* ignore */ }
      }, 5_000)
    } catch (e: any) {
      setWebcamErr(e.message || 'Camera access denied')
    }
  }, [onIncidentDetected])

  // ─────────────────────────────────────────────────────────────
  //  FILE UPLOAD
  // ─────────────────────────────────────────────────────────────

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadPct(0)
    setUploadMsg('')
    try {
      const result = await uploadVideo(file, 'CAM-UPLOAD', (pct) => setUploadPct(pct))
      setUploadPct(100)
      setUploadMsg(`✓ ${result.incident.incident_type} detected (${Math.round(result.incident.confidence * 100)}% confidence)`)
      onIncidentDetected()
    } catch (e: any) {
      setUploadMsg(`Error: ${e.response?.data?.detail || e.message || 'Upload failed'}`)
    } finally {
      setUploadPct(null)
    }
  }, [onIncidentDetected])

  // ─────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        {(['ipcam', 'webcam', 'upload'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 py-2.5 text-xs font-medium transition-colors',
              tab === t
                ? 'bg-gray-800 text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-white'
            )}
          >
            {t === 'ipcam'  && <><Wifi   className="h-3 w-3 inline mr-1" />IP Camera</>}
            {t === 'webcam' && <><Camera className="h-3 w-3 inline mr-1" />Webcam</>}
            {t === 'upload' && <><Upload className="h-3 w-3 inline mr-1" />Upload Video</>}
          </button>
        ))}
      </div>

      <div className="p-3">

        {/* ══ IP CAMERA TAB ══════════════════════════════════════ */}
        {tab === 'ipcam' && (
          <div className="space-y-2.5">

            {/* ── RPi5 Unit IP Address ─────────────────────────── */}
            {/* Set this once per WiFi network — it fills the stream URL automatically */}
            <div className="bg-blue-950/30 border border-blue-800/50 rounded-lg p-3 space-y-2">
              <p className="text-[10px] text-blue-300 font-semibold uppercase tracking-wide flex items-center gap-1.5">
                <Shield className="h-3 w-3" />RPi5 Unit IP Address
              </p>
              <p className="text-[10px] text-gray-400">
                Enter your Raspberry Pi 5's IP on the current WiFi network. Changes when you switch networks.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={rpiIp}
                  onChange={e => handleRpiIpChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveRpiIpNow() }}
                  placeholder="192.168.x.x"
                  className="flex-1 bg-gray-900 border border-blue-700/50 rounded-lg px-3 py-2
                             text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500
                             font-mono"
                />
                <button
                  onClick={saveRpiIpNow}
                  className={cn(
                    'px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex-shrink-0',
                    rpiSaved
                      ? 'bg-green-700 text-white'
                      : 'bg-blue-700 hover:bg-blue-600 text-white',
                  )}
                >
                  {rpiSaved ? '✓ Saved' : 'Save IP'}
                </button>
              </div>
              {rpiIp.trim() && (
                <div className="flex flex-col gap-1">
                  {/* Quick-connect presets for RPi5 */}
                  {[
                    { label: 'RPi5 Live Feed',   url: `http://${rpiIp.trim()}:5000/video_feed`, note: 'VigilanteVanguard pipeline' },
                    { label: 'IP Webcam (8081)',  url: `http://${rpiIp.trim()}:8081/video`,      note: 'IP Webcam app (Android)' },
                    { label: 'IP Webcam (4747)',  url: `http://${rpiIp.trim()}:4747/video`,      note: 'DroidCam app' },
                    { label: 'IP Cam Pro (8080)', url: `http://${rpiIp.trim()}:8080/video`,      note: 'IP Cam Pro (iOS)' },
                  ].map(({ label, url, note }) => (
                    <button
                      key={url}
                      onClick={() => { ipcam.setIpUrl(url); if (ipStreaming) stopIPCam() }}
                      className={cn(
                        'flex items-center justify-between gap-2 text-left px-2 py-1.5 rounded-lg border transition-colors w-full',
                        ipUrl === url
                          ? 'bg-blue-900/50 border-blue-600 text-blue-300'
                          : 'bg-gray-900 border-gray-700 hover:border-blue-700 text-gray-400 hover:text-white',
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-semibold flex-shrink-0">{label}</span>
                        <span className="font-mono text-[9px] text-gray-500 truncate">{url}</span>
                      </div>
                      <span className="text-[9px] text-gray-600 flex-shrink-0">{note}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Camera Stream URL — type any IP camera address ── */}
            <div className="space-y-1">
              <label className="text-[10px] text-gray-300 font-semibold uppercase tracking-wide flex items-center gap-1.5">
                <Wifi className="h-3 w-3 text-blue-400" />Stream URL
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={ipUrl}
                  onChange={e => { setIpUrl(e.target.value); if (ipStreaming) stopIPCam() }}
                  onKeyDown={e => { if (e.key === 'Enter' && ipUrl.trim()) startIPCam() }}
                  placeholder="http://192.168.x.x:5000/video_feed"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2.5
                             text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500
                             font-mono pr-16"
                />
                {ipUrl.trim() && (
                  <button
                    onClick={() => { setIpUrl(''); stopIPCam() }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 hover:text-white px-1.5 py-0.5 rounded"
                  >✕ clear</button>
                )}
              </div>
              <p className="text-[10px] text-gray-500">
                Filled automatically from RPi5 IP above. Press <kbd className="bg-gray-800 border border-gray-700 rounded px-1 text-[9px]">Enter</kbd> or click Connect.
              </p>
            </div>

            {/* ── Quick format reference ── */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-2.5 space-y-1.5">
              <p className="text-[10px] text-gray-400 font-semibold">Other common formats:</p>
              {[
                { fmt: 'http://[ip]:5000/video_feed', note: 'VigilanteVanguard RPi5' },
                { fmt: 'http://[ip]:8081/video',      note: 'IP Webcam app (Android)' },
                { fmt: 'http://[ip]:4747/video',      note: 'DroidCam app' },
                { fmt: 'rtsp://[ip]:8554/live',       note: 'RTSP cameras / CCTV DVR' },
              ].map(({ fmt, note }) => (
                <div key={fmt} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-blue-300/80">{fmt}</span>
                  <span className="text-[9px] text-gray-500 flex-shrink-0">{note}</span>
                </div>
              ))}
            </div>

            {/* ── Camera ID + Auth (collapsible) ── */}
            <div className="space-y-1.5">
              <input
                type="text"
                value={ipCamId}
                onChange={e => setIpCamId(e.target.value)}
                placeholder="Camera label (e.g. Gate-1, Lobby-Cam)"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5
                           text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={ipUsername}
                  onChange={e => setIpUsername(e.target.value)}
                  placeholder="Username (if required)"
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5
                             text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="password"
                  value={ipPassword}
                  onChange={e => setIpPassword(e.target.value)}
                  placeholder="Password"
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5
                             text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* ── Connect / Stop button ── */}
            <button
              onClick={ipStreaming ? stopIPCam : startIPCam}
              disabled={!ipUrl.trim() || ipStatus === 'connecting'}
              className={cn(
                'w-full py-2.5 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2',
                ipStreaming
                  ? 'bg-red-700 hover:bg-red-600 text-white'
                  : ipStatus === 'connecting'
                    ? 'bg-gray-700 text-gray-400 cursor-wait'
                    : 'bg-green-700 hover:bg-green-600 text-white'
              )}
            >
              {ipStatus === 'connecting' && <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Connecting…</>}
              {ipStatus === 'live'       && <><Square    className="h-3.5 w-3.5" />Disconnect Camera</>}
              {(ipStatus === 'idle' || ipStatus === 'error') && <><Play className="h-3.5 w-3.5" />Connect &amp; Start AI Analysis</>}
            </button>

            {/* Live preview — continuous MJPEG stream, no polling, no flicker */}
            {ipStreaming && (
              <div className="relative rounded-lg overflow-hidden border border-gray-700 bg-gray-950"
                   style={{ minHeight: 180 }}>

                {/*
                  MJPEG stream is mounted once per connect (key=ipUrl).
                  The backend proxy reconnects to the camera automatically
                  on any drop — this <img> never needs to be remounted.
                */}
                <img
                  key={ipUrl}
                  src={mjpegStreamUrl(ipUrl, ipUsername || undefined, ipPassword || undefined)}
                  alt="Live IP Camera"
                  className="w-full object-cover"
                  onLoad={() => setIpStatus('live')}
                  onError={() => {
                    // Only show error if we never reached 'live' — once live
                    // the backend proxy handles reconnection transparently.
                    if (ipStatus !== 'live') {
                      setIpStatus('error')
                      setIpErrMsg('Cannot reach camera — check IP and that the app is running')
                    }
                  }}
                />

                {/* Connecting overlay — shown until first frame arrives */}
                {ipStatus === 'connecting' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-950">
                    <RefreshCw className="h-6 w-6 animate-spin text-blue-400" />
                    <p className="text-xs text-gray-400">Connecting to {ipUrl}</p>
                    <p className="text-[10px] text-gray-600">Backend is proxying your phone's stream…</p>
                  </div>
                )}

                {/* Error state — only shown when stream never connected */}
                {ipStatus === 'error' && (
                  <div className="absolute inset-0 bg-gray-950 p-4 space-y-3 overflow-y-auto">
                    <div className="flex items-center gap-2">
                      <WifiOff className="h-5 w-5 text-red-400 flex-shrink-0" />
                      <p className="text-sm font-semibold text-red-300">Cannot reach camera</p>
                    </div>
                    <p className="text-[10px] text-gray-400 font-mono bg-gray-800 rounded px-2 py-1.5 break-all">{ipErrMsg}</p>
                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-400 font-semibold">Checklist:</p>
                      {[
                        'Phone and PC on the same WiFi network?',
                        'IP Webcam / DroidCam app running on phone?',
                        'Correct IP address? (check the app screen)',
                        'Correct port? Try :8080, :8081, or :4747',
                        'Try the Snapshot endpoint: :8080/shot.jpg',
                      ].map((item, i) => (
                        <p key={i} className="text-[10px] text-gray-500 flex items-start gap-1.5">
                          <span className="text-yellow-500 flex-shrink-0">→</span>{item}
                        </p>
                      ))}
                    </div>
                    <button onClick={startIPCam}
                      className="w-full py-2 text-xs font-bold bg-blue-800/60 hover:bg-blue-700 border border-blue-700 text-blue-300 rounded-lg transition-colors flex items-center justify-center gap-2">
                      <RefreshCw className="h-3.5 w-3.5" />Retry Connection
                    </button>
                  </div>
                )}

                {/* LIVE badge — shown once stream is up (no ipPreview check) */}
                {ipStatus === 'live' && (
                  <div className="absolute top-2 left-2 flex items-center gap-1.5">
                    <span className="flex items-center gap-1 bg-black/70 rounded px-2 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[10px] text-white font-medium">LIVE</span>
                    </span>
                    <span className="text-[10px] bg-black/60 rounded px-1.5 py-0.5 text-gray-300 font-mono">
                      AI: {ipFrameCount} scans
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Last detection */}
            {ipLastDetect && (
              <div className="flex items-center gap-2 bg-amber-950/40 border border-amber-700/40
                              rounded-lg px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-amber-300 font-medium">AI Detection</p>
                  <p className="text-[11px] text-amber-200">{ipLastDetect}</p>
                </div>
              </div>
            )}

            {/* note: port buttons moved to quick-connect builder above */}

          </div>
        )}

        {/* ══ WEBCAM TAB ═════════════════════════════════════════ */}
        {tab === 'webcam' && (
          <div className="space-y-3">
            <div className="relative rounded-lg overflow-hidden bg-gray-950 border border-gray-700"
                 style={{ minHeight: 140 }}>
              <video
                ref={videoRef}
                muted
                playsInline
                className="w-full"
                style={{ display: streaming ? 'block' : 'none' }}
              />
              {!streaming && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-500">
                  <Camera className="h-8 w-8 mb-2 opacity-40" />
                  <p className="text-xs">Camera not started</p>
                </div>
              )}
              {streaming && (
                <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/70 rounded px-2 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] text-white font-medium">LIVE</span>
                </div>
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <button
              onClick={streaming ? stopWebcam : startWebcam}
              className={cn(
                'w-full py-2 text-xs font-semibold rounded-lg transition-colors',
                streaming
                  ? 'bg-red-700 hover:bg-red-600 text-white'
                  : 'bg-blue-700 hover:bg-blue-600 text-white'
              )}
            >
              {streaming ? 'Stop Stream' : 'Start Webcam & Analyse'}
            </button>
            <p className="text-[10px] text-gray-500 text-center">
              Frames are sent to AI every 5 seconds
            </p>
          </div>
        )}

        {/* ══ UPLOAD TAB ═════════════════════════════════════════ */}
        {tab === 'upload' && (
          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept=".mp4,.avi,.mov,.mkv,.webm"
              className="hidden"
              onChange={handleFileUpload}
            />
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center
                         cursor-pointer hover:border-blue-500 transition-colors"
            >
              <Upload className="h-7 w-7 mx-auto mb-2 text-gray-500" />
              <p className="text-xs text-gray-400">Click to upload video</p>
              <p className="text-[10px] text-gray-600 mt-1">MP4 · AVI · MOV · MKV · WebM</p>
            </div>
            {uploadPct !== null && (
              <div className="space-y-1">
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-center">
                  Analysing… {uploadPct}%
                </p>
              </div>
            )}
          </div>
        )}

        {/* Feedback messages */}
        {webcamErr && (
          <p className="mt-2 text-[11px] text-red-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />{webcamErr}
          </p>
        )}
        {ipErrMsg && tab === 'ipcam' && (
          <p className="mt-2 text-[11px] text-red-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />{ipErrMsg}
          </p>
        )}
        {uploadMsg && (
          <p className={cn('mt-2 text-[11px] flex items-center gap-1',
            uploadMsg.startsWith('Error') ? 'text-red-400' : 'text-green-400')}>
            {uploadMsg}
          </p>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  INCIDENT CLIP PLAYER — simulates 5-second pre-incident window
// ═══════════════════════════════════════════════════════════════

function IncidentClipPlayer({ incident }: { incident: CCTVIncident }) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const rafRef     = useRef<number>(0)
  const frameRef   = useRef(0)
  const [playing,  setPlaying]  = useState(false)
  const [progress, setProgress] = useState(0)  // 0–100

  // Load the snapshot image once
  const imgRef = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = incident.snapshot
    img.onload = () => { imgRef.current = img }
  }, [incident.snapshot])

  const stopClip = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    setPlaying(false)
    setProgress(0)
    frameRef.current = 0
  }, [])

  const playClip = useCallback(() => {
    if (playing) { stopClip(); return }
    setPlaying(true)
    frameRef.current = 0

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const TOTAL_FRAMES = 150  // ~5 s at 30 fps
    const colour = incidentColour(incident.incident_type)

    const draw = () => {
      frameRef.current++
      const f = frameRef.current
      const pct = Math.min(100, Math.round((f / TOTAL_FRAMES) * 100))
      setProgress(pct)

      const W = canvas.width, H = canvas.height

      // Phase 1 (f < 80): pre-incident — normal scene, snapshot faded
      // Phase 2 (f >= 80): incident detected — red alert overlay, bounding box
      const phase2 = f >= 80

      ctx.clearRect(0, 0, W, H)

      // Draw snapshot as base
      if (imgRef.current) {
        // fade from 40% opacity to 100% as we near incident
        const alpha = phase2 ? 1 : 0.4 + (f / 80) * 0.6
        ctx.globalAlpha = alpha
        ctx.drawImage(imgRef.current, 0, 0, W, H)
        ctx.globalAlpha = 1
      } else {
        // fallback dark scene
        ctx.fillStyle = '#0a0f1a'
        ctx.fillRect(0, 0, W, H)
      }

      // Scanline overlay
      for (let y = 0; y < H; y += 4) {
        ctx.fillStyle = 'rgba(0,0,0,0.12)'
        ctx.fillRect(0, y, W, 2)
      }

      // Pre-incident: "NORMAL" label
      if (!phase2) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.fillRect(0, H - 22, W, 22)
        ctx.fillStyle = '#9ca3af'
        ctx.font = 'bold 10px monospace'
        ctx.fillText(`NORMAL  t-${((80 - f) / 30).toFixed(1)}s`, 6, H - 7)
      }

      // Phase 2: detection flash + bounding box
      if (phase2) {
        const flash = f - 80
        const alpha2 = Math.max(0, 1 - flash / 40)

        // Red alert vignette
        ctx.fillStyle = `rgba(220,38,38,${alpha2 * 0.3})`
        ctx.fillRect(0, 0, W, H)

        // Animated bounding box (centre area, vibrates slightly)
        const jitter = Math.sin(flash * 0.8) * 3
        const bx = W * 0.2 + jitter, by = H * 0.15
        const bw = W * 0.6, bh = H * 0.65
        ctx.strokeStyle = `rgba(239,68,68,${0.5 + alpha2 * 0.5})`
        ctx.lineWidth = 2
        ctx.strokeRect(bx, by, bw, bh)

        // Corner brackets
        const cl = 14
        ctx.strokeStyle = colour
        ctx.lineWidth = 3
        ;[[bx,by],[bx+bw,by],[bx,by+bh],[bx+bw,by+bh]].forEach(([cx,cy]) => {
          const sx = cx === bx ? 1 : -1, sy = cy === by ? 1 : -1
          ctx.beginPath(); ctx.moveTo(cx, cy+sy*cl); ctx.lineTo(cx, cy); ctx.lineTo(cx+sx*cl, cy); ctx.stroke()
        })

        // Label banner
        ctx.fillStyle = `rgba(${colour.replace('#','').match(/.{2}/g)!.map(h=>parseInt(h,16)).join(',')},0.9)`
        ctx.fillRect(bx, by - 20, bw, 20)
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 10px monospace'
        ctx.fillText(`⚠ ${incident.incident_type.toUpperCase()}  ${Math.round(incident.confidence*100)}%`, bx + 6, by - 6)

        // Timestamp overlay
        ctx.fillStyle = 'rgba(0,0,0,0.7)'
        ctx.fillRect(0, H - 22, W, 22)
        ctx.fillStyle = '#ef4444'
        ctx.font = 'bold 10px monospace'
        ctx.fillText(`INCIDENT DETECTED  ${incident.camera_name}`, 6, H - 7)
      }

      // REC badge
      ctx.fillStyle = f % 60 < 30 ? '#dc2626' : '#991b1b'
      ctx.beginPath(); ctx.arc(W - 22, 14, 5, 0, Math.PI*2); ctx.fill()
      ctx.fillStyle = '#f9fafb'; ctx.font = 'bold 9px monospace'
      ctx.fillText('REC', W - 14, 18)

      if (f < TOTAL_FRAMES) {
        rafRef.current = requestAnimationFrame(draw)
      } else {
        setPlaying(false)
        setProgress(100)
      }
    }
    rafRef.current = requestAnimationFrame(draw)
  }, [playing, incident, stopClip])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  return (
    <div className="bg-gray-800/60 rounded-lg overflow-hidden border border-gray-700">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <Film className="h-3.5 w-3.5 text-purple-400" />
        <span className="text-xs font-medium text-purple-300">Pre-Incident Clip (–5s)</span>
        <span className="text-[10px] text-gray-500 ml-auto">{incident.video_path.split('/').pop()}</span>
      </div>
      <div className="relative bg-gray-950">
        <canvas ref={canvasRef} width={320} height={180} className="w-full" />
        {/* Play overlay when not playing */}
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 cursor-pointer"
               onClick={playClip}>
            <div className="bg-white/10 hover:bg-white/20 transition-colors rounded-full p-3 border border-white/30">
              <Play className="h-6 w-6 text-white fill-white" />
            </div>
          </div>
        )}
      </div>
      {/* Progress bar */}
      <div className="px-3 py-2 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-purple-500 rounded-full transition-all"
               style={{ width: `${progress}%` }} />
        </div>
        <button onClick={playing ? stopClip : playClip}
          className="text-[10px] text-purple-400 hover:text-purple-300 px-2 py-0.5 border border-purple-800 rounded transition-colors flex-shrink-0">
          {playing ? '■ Stop' : '▶ Play'}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  IP CAM STATE PERSISTENCE
//  Survives React Router navigation (CCTVPage unmounts on tab switch)
// ═══════════════════════════════════════════════════════════════

const IPCAM_LS_KEY = 'vv_ipcam_state'

interface PersistedIPCamState {
  ipUrl: string
  ipCamId: string
  ipUsername: string
  ipPassword: string
  wasStreaming: boolean  // was live when user navigated away
}

function loadIPCamState(): PersistedIPCamState {
  try {
    const raw = localStorage.getItem(IPCAM_LS_KEY)
    if (!raw) return { ipUrl: '', ipCamId: 'CAM-1', ipUsername: '', ipPassword: '', wasStreaming: false }
    return JSON.parse(raw)
  } catch {
    return { ipUrl: '', ipCamId: 'CAM-1', ipUsername: '', ipPassword: '', wasStreaming: false }
  }
}

function saveIPCamState(s: PersistedIPCamState) {
  try { localStorage.setItem(IPCAM_LS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════
//  CAMERA HISTORY PANEL
// ═══════════════════════════════════════════════════════════════

interface CamHistoryEntry {
  id: string; name: string; location: string; source_type: string
  source_url: string; district: string; added_at: string
  lat?: number; lng?: number; online?: boolean
}

const CAM_HISTORY_KEY = 'vv_cam_history'

function loadCamHistory(): CamHistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(CAM_HISTORY_KEY) || '[]') }
  catch { return [] }
}
function saveCamHistory(entry: CamHistoryEntry) {
  const all = loadCamHistory()
  const exists = all.some(c => c.id === entry.id)
  const updated = exists
    ? all.map(c => c.id === entry.id ? { ...c, ...entry, added_at: c.added_at } : c)
    : [entry, ...all]
  localStorage.setItem(CAM_HISTORY_KEY, JSON.stringify(updated.slice(0, 100)))
}

function CameraHistoryPanel({ cameras, ipStreaming, ipUrl, ipCamId, ipStatus }: {
  cameras: any[]; ipStreaming: boolean; ipUrl: string; ipCamId: string
  ipStatus: 'idle' | 'connecting' | 'live' | 'error'
}) {
  const [history, setHistory] = useState<CamHistoryEntry[]>(loadCamHistory)
  const [expanded, setExpanded] = useState(false)

  // When a new IP cam goes live, upsert it into history
  useEffect(() => {
    if (ipStreaming && ipUrl.trim()) {
      const entry: CamHistoryEntry = {
        id: ipCamId || 'CAM-1',
        name: `IP Camera (${ipUrl.replace(/https?:\/\//, '')})`,
        location: 'Live feed',
        source_type: 'ipcam',
        source_url: ipUrl,
        district: 'Bengaluru City',
        added_at: new Date().toISOString(),
        online: ipStatus === 'live',
      }
      saveCamHistory(entry)
      setHistory(loadCamHistory())
    }
  }, [ipStreaming, ipStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Merge API cameras with local history
  const apiCams: CamHistoryEntry[] = (cameras ?? []).map((c: any) => ({
    id: c.camera_id ?? c.id ?? String(c.id),
    name: c.name ?? c.camera_id,
    location: c.location ?? c.camera_location ?? '—',
    source_type: c.source_type ?? 'api',
    source_url: c.source_url ?? '',
    district: c.district ?? '—',
    added_at: c.created_at ?? c.registered_at ?? new Date().toISOString(),
    lat: c.lat, lng: c.lng, online: true,
  }))

  const allCams: CamHistoryEntry[] = [
    ...apiCams,
    ...history.filter(h => !apiCams.some(a => a.id === h.id)),
  ]

  const displayed = expanded ? allCams : allCams.slice(0, 4)

  const fmtAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`
    return new Date(iso).toLocaleDateString('en-IN', { day:'2-digit', month:'short' })
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-cyan-400" />
          <span className="text-xs font-semibold text-white">Camera History</span>
          {allCams.length > 0 && (
            <span className="text-[10px] bg-cyan-900/40 border border-cyan-800 text-cyan-400 px-1.5 py-0.5 rounded-full">
              {allCams.length}
            </span>
          )}
        </div>
        {allCams.length > 4 && (
          <button onClick={() => setExpanded(e => !e)}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors">
            {expanded ? '▲ Less' : `+${allCams.length - 4} more`}
          </button>
        )}
      </div>

      {allCams.length === 0 ? (
        <div className="px-3 py-4 text-center">
          <Camera className="h-6 w-6 text-gray-700 mx-auto mb-1.5" />
          <p className="text-[11px] text-gray-600">No cameras registered yet.</p>
          <p className="text-[10px] text-gray-700 mt-0.5">Connect an IP camera to start.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-800">
          {displayed.map(cam => (
            <div key={cam.id} className="px-3 py-2 flex items-start gap-2.5 hover:bg-gray-800/40 transition-colors">
              {/* Online dot */}
              <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${cam.online ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-white truncate">{cam.name}</p>
                  <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${
                    cam.source_type === 'ipcam' ? 'bg-blue-900/40 text-blue-400'
                    : cam.source_type === 'webcam' ? 'bg-purple-900/40 text-purple-400'
                    : 'bg-gray-800 text-gray-500'
                  }`}>{cam.source_type}</span>
                </div>
                <p className="text-[10px] text-gray-500 truncate">{cam.location}</p>
                {cam.source_url && (
                  <p className="text-[9px] text-gray-700 font-mono truncate">{cam.source_url.replace(/https?:\/\//, '')}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[9px] text-gray-600">{fmtAgo(cam.added_at)}</p>
                <p className="text-[9px] text-gray-700">{cam.district}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  ANALYTICS MINI-PANEL
// ═══════════════════════════════════════════════════════════════

function AnalyticsPanel() {
  const { data } = useQuery({
    queryKey: ['cctv-analytics'],
    queryFn:  fetchCCTVAnalytics,
    refetchInterval: 30_000,
  })

  if (!data) return null

  const { total_incidents, by_status, avg_confidence, ws_connected } = data
  const typeEntries = Object.entries(data.by_type)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 4)

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-blue-400" />
        <span className="text-sm font-semibold text-white">Analytics</span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Total', value: total_incidents,              colour: 'text-white' },
          { label: 'Pending', value: by_status.PENDING ?? 0,    colour: 'text-yellow-400' },
          { label: 'Confirmed', value: by_status.CONFIRMED ?? 0,colour: 'text-green-400' },
          { label: 'Avg Conf', value: `${Math.round(avg_confidence * 100)}%`, colour: 'text-blue-400' },
        ].map(({ label, value, colour }) => (
          <div key={label} className="bg-gray-800/60 rounded-lg p-2 text-center">
            <p className={cn('text-lg font-bold', colour)}>{value}</p>
            <p className="text-[10px] text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Incident type breakdown */}
      {typeEntries.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">By Type</p>
          {typeEntries.map(([type, count]) => (
            <div key={type} className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: incidentColour(type) }}
              />
              <span className="text-[11px] text-gray-400 flex-1 truncate">{type}</span>
              <span className="text-[11px] text-white font-medium">{count}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-[10px] text-gray-500 border-t border-gray-700 pt-2">
        <Users className="h-3 w-3" />
        <span>{ws_connected} officer{ws_connected !== 1 ? 's' : ''} online</span>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════

export default function CCTVPage() {
  // ── Connect WebSocket + sound controls ───────────────────────
  const { muted, toggleMute } = useCCTVSocket()

  const qc = useQueryClient()

  // ═══════════════════════════════════════════════════════════
  //  BACKGROUND IP CAM SERVICE
  //  State is seeded from localStorage so the URL/ID survive
  //  React Router navigation (CCTVPage unmounts on tab switch).
  // ═══════════════════════════════════════════════════════════
  const _persisted = loadIPCamState()
  const [ipUrl,        setIpUrlRaw]     = useState(_persisted.ipUrl)
  const [ipCamId,      setIpCamIdRaw]   = useState(_persisted.ipCamId || 'CAM-1')
  const [ipUsername,   setIpUsernameRaw]= useState(_persisted.ipUsername)
  const [ipPassword,   setIpPasswordRaw]= useState(_persisted.ipPassword)
  const [ipStreaming,  setIpStreaming]   = useState(false)
  const [ipPreview,    setIpPreview]    = useState('')
  const [ipStatus,     setIpStatus]     = useState<'idle'|'connecting'|'live'|'error'>('idle')
  const [ipLastDetect, setIpLastDetect] = useState('')
  const [ipFrameCount, setIpFrameCount] = useState(0)
  const [ipFps,        setIpFps]        = useState(0)
  const [ipScanInterval, setIpScanInterval] = useState(120)
  const [ipErrMsg,     setIpErrMsg]     = useState('')
  // Banner shown when user returns and the camera was previously streaming
  const [showReconnectBanner, setShowReconnectBanner] = useState(
    !!_persisted.wasStreaming && !!_persisted.ipUrl.trim()
  )

  // ── Setters that also persist to localStorage ───────────────
  const setIpUrl = useCallback((v: string) => {
    setIpUrlRaw(v)
    saveIPCamState({ ...loadIPCamState(), ipUrl: v })
  }, [])
  const setIpCamId = useCallback((v: string) => {
    setIpCamIdRaw(v)
    saveIPCamState({ ...loadIPCamState(), ipCamId: v })
  }, [])
  const setIpUsername = useCallback((v: string) => {
    setIpUsernameRaw(v)
    saveIPCamState({ ...loadIPCamState(), ipUsername: v })
  }, [])
  const setIpPassword = useCallback((v: string) => {
    setIpPasswordRaw(v)
    saveIPCamState({ ...loadIPCamState(), ipPassword: v })
  }, [])

  const ipRunningRef      = useRef(false)
  const ipCamIdRef        = useRef(ipCamId)
  const ipUrlRef          = useRef(ipUrl)
  const ipUsernameRef     = useRef(ipUsername)
  const ipPasswordRef     = useRef(ipPassword)
  const ipScanIntervalRef = useRef(ipScanInterval)
  const mutedRef          = useRef(muted)
  // FPS tracking: count scans per second
  const fpsCountRef     = useRef(0)
  const fpsTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  // Ref that always holds the current status
  const ipStatusRef     = useRef<'idle'|'connecting'|'live'|'error'>('idle')
  useEffect(() => { ipStatusRef.current       = ipStatus       }, [ipStatus])
  useEffect(() => { ipCamIdRef.current        = ipCamId        }, [ipCamId])
  useEffect(() => { ipUrlRef.current          = ipUrl          }, [ipUrl])
  useEffect(() => { ipUsernameRef.current     = ipUsername     }, [ipUsername])
  useEffect(() => { ipPasswordRef.current     = ipPassword     }, [ipPassword])
  useEffect(() => { ipScanIntervalRef.current = ipScanInterval }, [ipScanInterval])
  useEffect(() => { mutedRef.current          = muted          }, [muted])

  // ── Persist wasStreaming flag on stream state changes ────────
  useEffect(() => {
    saveIPCamState({ ...loadIPCamState(), wasStreaming: ipStreaming })
  }, [ipStreaming])

  const stopIPCam = useCallback(() => {
    ipRunningRef.current = false
    setIpStreaming(false)
    setIpStatus('idle')
    setIpPreview('')
    setIpFps(0)
    if (fpsTimerRef.current) clearInterval(fpsTimerRef.current)
    setShowReconnectBanner(false)
  }, [])

  // ── Alert sound uses the centralised playAlertSound from the hook ────────────
  const onIpcamIncident = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['cctv-incidents'] })
    qc.invalidateQueries({ queryKey: ['cctv-analytics'] })
  }, [qc])

  const startIPCam = useCallback(async () => {
    const url = ipUrlRef.current
    if (!url.trim()) return
    stopIPCam()
    setIpErrMsg('')
    setIpFrameCount(0)
    setIpFps(0)
    setIpLastDetect('')
    setIpStreaming(true)
    setIpStatus('connecting')

    // ── Get real GPS + human-readable address from browser ──────────
    let gpsLat = 12.9716, gpsLng = 77.5946
    let gpsAddress = ''
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000, enableHighAccuracy: true })
      )
      gpsLat = pos.coords.latitude
      gpsLng = pos.coords.longitude
      try {
        const geo = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${gpsLat}&lon=${gpsLng}&format=json&zoom=16`,
          { headers: { 'User-Agent': 'VigilanteVanguard/6.0' } }
        ).then(r => r.json())
        gpsAddress = geo?.display_name ?? ''
        if (gpsAddress.length > 120) gpsAddress = gpsAddress.slice(0, 120)
      } catch { /* reverse geocode failed */ }
    } catch { /* geolocation denied */ }

    const locationLabel = gpsAddress
      || (gpsLat !== 12.9716 ? `${gpsLat.toFixed(5)}, ${gpsLng.toFixed(5)}` : 'Bengaluru City')

    try {
      await registerCamera({
        camera_id:   ipCamIdRef.current,
        name:        `IP Camera (${url.replace(/https?:\/\//, '')})`,
        location:    locationLabel,
        lat:         gpsLat,
        lng:         gpsLng,
        source_type: 'ipcam',
        source_url:  url,
        district:    'Bengaluru City',
        zone:        'Bengaluru',
      })
    } catch { /* silent */ }

    // ── FPS counter — updates every second ──────────────────────────
    fpsCountRef.current = 0
    fpsTimerRef.current = setInterval(() => {
      setIpFps(fpsCountRef.current)
      fpsCountRef.current = 0
    }, 1000)

    // ══════════════════════════════════════════════════════════════════
    //  HIGH-SPEED ADAPTIVE SCAN LOOP
    //
    //  Strategy: use grab-frames-batch to drain up to 4 buffered frames
    //  per HTTP call.  This multiplies effective scan throughput by up to
    //  4× compared to single-frame polling, while keeping the number of
    //  HTTP round trips the same.
    //
    //  Adaptive floor:
    //    • Minimum interval = user-controlled slider (default 120 ms ≈ 8 fps)
    //    • If backend returns quickly (< floor), we wait the remainder.
    //    • If backend is slower (busy CPU), we start the next call immediately.
    //    • Error back-off: on failure wait 2× the floor (max 3 s).
    //
    //  No second camera connection is ever opened — batch reads from the
    //  same _FRAME_BUFFER that the MJPEG proxy fills continuously.
    // ══════════════════════════════════════════════════════════════════
    ipRunningRef.current = true
    let errorBackoff = 0

    const scanLoop = async () => {
      while (ipRunningRef.current) {
        const floor = ipScanIntervalRef.current   // live-updated via ref
        const t0 = Date.now()
        fpsCountRef.current++
        setIpFrameCount(n => n + 1)

        try {
          // Batch: grab up to 4 frames and run parallel detection on all
          const r = await grabIPCamFramesBatch(
            ipUrlRef.current,
            ipCamIdRef.current,
            4,
            ipUsernameRef.current || undefined,
            ipPasswordRef.current || undefined,
          )
          setIpStatus('live')
          setIpErrMsg('')
          errorBackoff = 0

          if (r.detected) {
            const inc   = r.incident
            const label = inc?.incident_type ?? 'Incident'
            const pct   = Math.round((inc?.confidence ?? 0) * 100)
            setIpLastDetect(`${label} (${pct}%)`)
            if (inc && !r.cooldown) {
              onIpcamIncident()
              playAlertSound(label, inc.severity?.level ?? 'HIGH', mutedRef.current)
            }
          }
        } catch (e: any) {
          errorBackoff = Math.min(errorBackoff + floor, 3000)
          if (ipStatusRef.current !== 'live') {
            setIpStatus('error')
            setIpErrMsg(e?.response?.data?.detail || e?.message || 'Camera unreachable')
          }
        }

        // Adaptive wait: respect the floor, add error back-off if needed
        const elapsed = Date.now() - t0
        const wait = Math.max(0, floor - elapsed) + errorBackoff
        if (wait > 0) await new Promise(r => setTimeout(r, wait))
      }
    }
    scanLoop()
  }, [stopIPCam, onIpcamIncident, setIpFps])

  // Clean up on page unmount
  useEffect(() => () => stopIPCam(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const ipcamState: IPCamState = {
    ipUrl, setIpUrl, ipCamId, setIpCamId,
    ipUsername, setIpUsername, ipPassword, setIpPassword,
    ipStreaming, ipStatus, setIpStatus, ipPreview, ipLastDetect, ipFrameCount,
    errMsg: ipErrMsg, setErrMsg: setIpErrMsg, startIPCam, stopIPCam,
  }

  // Expose scan rate to the IP-cam panel via a separate state so user can
  // tune it from a slider without re-creating the scan loop.
  // ipScanIntervalRef is read inside the loop on every iteration.

  // ── Training model status (poll every 10 s) ───────────────
  const trainQ = useQuery({
    queryKey:        ['training-status'],
    queryFn:         () => fetch('/api/v1/training/status').then(r => r.json()),
    refetchInterval: 10_000,
    retry:           false,
  })
  const trainStatus = trainQ.data as {
    model_ready: boolean; hist_index_size: number; total_labels: number;
    last_session_id: string | null; training_running: boolean;
    hist_by_label: Record<string, number>
  } | undefined

  const {
    incidents, cameras, stations,
    selectedIncident, selectIncident,
    wsConnected, connectedUsers, alertCount, clearAlerts,
    filterStatus, setFilterStatus,
    filterType, setFilterType,
    setIncidents, setCameras, setStations,
  } = useCCTVStore()

  // ── Bootstrap data from REST on mount ───────────────────
  const incQ = useQuery({
    queryKey:        ['cctv-incidents'],
    queryFn:         () => fetchIncidents({ limit: 100 }),
    refetchInterval: 60_000,
  })
  useEffect(() => {
    if (incQ.data?.incidents) setIncidents(incQ.data.incidents)
  }, [incQ.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const camQ = useQuery({
    queryKey: ['cctv-cameras'],
    queryFn:  fetchCameras,
  })
  useEffect(() => {
    if (camQ.data) setCameras(camQ.data)
  }, [camQ.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const stQ = useQuery({
    queryKey: ['cctv-stations'],
    queryFn:  fetchStations,
  })
  useEffect(() => {
    if (stQ.data) setStations(stQ.data)
  }, [stQ.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Action mutation ────────────────────────────────────────
  const actionMutation = useMutation({
    mutationFn: ({
      id, action, notes,
    }: { id: string; action: 'CONFIRM' | 'FALSE_ALARM' | 'DISPATCH'; notes?: string }) =>
      updateIncident(id, action, notes),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['cctv-incidents'] })
      qc.invalidateQueries({ queryKey: ['cctv-analytics'] })
      if (selectedIncident?.incident_id === data.incident.incident_id) {
        selectIncident(data.incident)
      }
      // Positive audio feedback on officer action
      if (!muted) playConfirmSound()
    },
  })

  // ── Filtered incident list ─────────────────────────────────
  const filtered = incidents.filter(inc => {
    if (filterStatus && inc.status !== filterStatus) return false
    if (filterType  && inc.incident_type !== filterType) return false
    return true
  })

  // ── Map: Bengaluru default centre ─────────────────────────
  const mapCenter: [number, number] = [12.9716, 77.5946]

  return (
    <div className="h-full flex flex-col bg-gray-950">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800
                      bg-gray-900 flex-shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-red-700 p-2 rounded-lg">
            <Video className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">
              AI Smart CCTV Surveillance &amp; Emergency Dispatch
            </h1>
            <p className="text-[11px] text-gray-400">
              Karnataka State Police · Real-time AI Incident Detection
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {/* AI model status badge */}
          {trainStatus && (
            <span className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border',
              trainStatus.model_ready
                ? 'bg-purple-950/40 text-purple-300 border-purple-700/40'
                : 'bg-yellow-950/40 text-yellow-400 border-yellow-700/40'
            )}>
              <BrainCircuit className="h-3 w-3" />
              {trainStatus.model_ready
                ? `AI Model: ${trainStatus.hist_index_size} samples · ${trainStatus.total_labels} classes`
                : 'AI Model: not loaded'}
            </span>
          )}

          {/* WS status */}
          <span className={cn(
            'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border',
            wsConnected
              ? 'bg-green-950/40 text-green-400 border-green-700/40'
              : 'bg-gray-800 text-gray-500 border-gray-700'
          )}>
            {wsConnected
              ? <><Wifi className="h-3 w-3" /><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />Live</>
              : <><WifiOff className="h-3 w-3" />Connecting…</>
            }
          </span>

          {/* Users online */}
          {wsConnected && connectedUsers > 0 && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Users className="h-3.5 w-3.5" />
              {connectedUsers}
            </span>
          )}

          {/* Alert badge */}
          {alertCount > 0 && (
            <button
              onClick={clearAlerts}
              className="flex items-center gap-1.5 bg-red-900/50 border border-red-700
                         text-red-300 text-xs px-2.5 py-1 rounded-full hover:bg-red-900 transition-colors"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {alertCount} new alert{alertCount !== 1 ? 's' : ''}
            </button>
          )}

          {/* Scan rate slider — visible only when camera is live */}
          {ipStreaming && ipStatus === 'live' && (
            <div className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1">
              <Gauge className="h-3.5 w-3.5 text-cyan-400 flex-shrink-0" />
              <span className="text-[10px] text-gray-400 flex-shrink-0">Scan rate</span>
              <input
                type="range" min={60} max={2000} step={20}
                value={ipScanInterval}
                onChange={e => setIpScanInterval(Number(e.target.value))}
                className="w-20 accent-cyan-500 cursor-pointer"
                title={`Scan interval: ${ipScanInterval} ms`}
              />
              <span className="text-[10px] font-mono text-cyan-300 w-12 flex-shrink-0">
                {ipScanInterval < 1000 ? `${ipScanInterval}ms` : `${(ipScanInterval/1000).toFixed(1)}s`}
              </span>
              {ipFps > 0 && (
                <span className="text-[10px] font-mono text-green-400 flex-shrink-0">
                  {ipFps} fps
                </span>
              )}
            </div>
          )}

          {/* Mute toggle */}
          <button
            onClick={toggleMute}
            title={muted ? 'Alerts muted — click to unmute' : 'Alerts active — click to mute'}
            className={cn(
              'flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors',
              muted
                ? 'bg-gray-800 border-gray-700 text-gray-500 hover:text-white'
                : 'bg-gray-800 border-gray-700 text-green-400 hover:text-green-300'
            )}
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            {muted ? 'Muted' : 'Sound'}
          </button>

          {/* Export CSV */}
          <a
            href="/api/v1/cctv/incidents/export?fmt=csv"
            download
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800
                       hover:bg-gray-700 border border-gray-700 rounded-lg px-2.5 py-1.5 transition-colors"
            title="Export incidents as CSV"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </a>

          {/* Refresh */}
          <button
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['cctv-incidents'] })
              qc.invalidateQueries({ queryKey: ['cctv-analytics'] })
            }}
            className="text-gray-500 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Background camera live bar ────────────────────── */}
      {ipStreaming && (
        <div className={cn(
          'flex items-center gap-3 px-4 py-1.5 flex-shrink-0 border-b text-xs',
          ipStatus === 'live'  ? 'bg-green-950/30 border-green-800/40' :
          ipStatus === 'error' ? 'bg-red-950/30 border-red-800/40' :
                                 'bg-blue-950/30 border-blue-800/40'
        )}>
          {/* Status dot */}
          <span className={cn(
            'w-2 h-2 rounded-full flex-shrink-0',
            ipStatus === 'live'  ? 'bg-green-400 animate-pulse' :
            ipStatus === 'error' ? 'bg-red-400' : 'bg-blue-400 animate-pulse'
          )} />
          <span className={cn(
            'font-semibold flex-shrink-0',
            ipStatus === 'live' ? 'text-green-300' : ipStatus === 'error' ? 'text-red-300' : 'text-blue-300'
          )}>
            {ipStatus === 'live' ? 'LIVE' : ipStatus === 'error' ? 'ERROR' : 'CONNECTING'}
          </span>
          <span className="text-gray-400 truncate">{ipUrl.replace(/https?:\/\//, '')}</span>
          <span className="text-gray-600 flex-shrink-0">{ipFrameCount} scanned</span>
          {ipFps > 0 && (
            <span className="text-cyan-500 font-mono text-[10px] flex-shrink-0">{ipFps} fps</span>
          )}
          {ipLastDetect && (
            <span className="ml-auto flex items-center gap-1 text-amber-300 flex-shrink-0">
              <AlertTriangle className="h-3 w-3" />
              {ipLastDetect}
            </span>
          )}
          {/* Live thumbnail */}
          {ipPreview && ipStatus === 'live' && (
            <img src={ipPreview} alt="live" className="h-8 w-12 object-cover rounded border border-green-700/40 flex-shrink-0" />
          )}
          <button onClick={stopIPCam}
            className="ml-auto flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-red-400 hover:bg-red-900/30 transition-colors border border-red-800/40">
            <Square className="h-3 w-3" />Stop
          </button>
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex gap-0">

        {/* Left column: video source + analytics */}
        <div className="w-96 flex-shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
          {/* ── Reconnect banner — shown when returning after nav ── */}
          {showReconnectBanner && !ipStreaming && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 bg-blue-950/60 border-b border-blue-800/60 flex-shrink-0">
              <Wifi className="h-3.5 w-3.5 text-blue-400 flex-shrink-0 animate-pulse" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-blue-300">Camera was connected</p>
                <p className="text-[10px] text-blue-400/70 truncate font-mono">{ipUrl}</p>
              </div>
              <button
                onClick={() => { setShowReconnectBanner(false); startIPCam() }}
                className="text-[10px] font-bold bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded-lg transition-colors flex-shrink-0"
              >
                Reconnect
              </button>
              <button
                onClick={() => { setShowReconnectBanner(false); saveIPCamState({ ...loadIPCamState(), wasStreaming: false }) }}
                className="text-gray-500 hover:text-white transition-colors flex-shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            <VideoSourcePanel
              onIncidentDetected={() => {
                qc.invalidateQueries({ queryKey: ['cctv-incidents'] })
                qc.invalidateQueries({ queryKey: ['cctv-analytics'] })
              }}
              ipcam={ipcamState}
            />
            <CameraHistoryPanel
              cameras={cameras}
              ipStreaming={ipStreaming}
              ipUrl={ipUrl}
              ipCamId={ipCamId}
              ipStatus={ipStatus}
            />
            <AnalyticsPanel />
          </div>
        </div>

        {/* Centre: map + incident list */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Map */}
          <div className="flex-1 relative">
            <MapContainer
              center={mapCenter}
              zoom={11}
              style={{ height: '100%', width: '100%' }}
              className="bg-gray-950"
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              />

              <MapFit incidents={filtered} />

              {/* Police stations (blue icons) */}
              {stations.map(st => (
                <Marker
                  key={st.id}
                  position={[st.lat, st.lng]}
                  icon={L.divIcon({
                    className: '',
                    html: `<div style="background:#1d4ed8;border:2px solid white;border-radius:4px;width:12px;height:12px;"></div>`,
                    iconSize: [12, 12],
                    iconAnchor: [6, 6],
                  })}
                >
                  <Popup>
                    <div className="text-xs">
                      <strong>🛡 {st.name}</strong><br />
                      {st.district}<br />
                      📞 {st.phone}
                    </div>
                  </Popup>
                </Marker>
              ))}

              {/* Incident markers */}
              {filtered.map(inc => (
                <Marker
                  key={inc.incident_id}
                  position={[inc.latitude, inc.longitude]}
                  icon={makeIncidentIcon(incidentColour(inc.incident_type))}
                  eventHandlers={{ click: () => selectIncident(inc) }}
                >
                  <Circle
                    center={[inc.latitude, inc.longitude]}
                    radius={150}
                    pathOptions={{
                      color: incidentColour(inc.incident_type),
                      fillColor: incidentColour(inc.incident_type),
                      fillOpacity: 0.08,
                      weight: 1,
                    }}
                  />
                  <Popup>
                    <div className="text-xs space-y-1">
                      <p><strong>{inc.incident_type}</strong></p>
                      <p className="text-gray-600">{inc.camera_name}</p>
                      <p>Confidence: <strong>{Math.round(inc.confidence * 100)}%</strong></p>
                      <p>Status: <strong>{inc.status}</strong></p>
                      <p className="text-gray-600">{fmtTs(inc.timestamp)}</p>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>

            {/* Legend */}
            <div className="absolute bottom-3 right-3 bg-gray-900/90 border border-gray-700
                            rounded-lg p-2 text-[10px] space-y-1 z-[1000]">
              <p className="text-gray-400 font-semibold mb-1">Legend</p>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-blue-700 border border-white" />
                <span className="text-gray-400">Police Station</span>
              </div>
              {Object.entries(INCIDENT_COLOURS).slice(0, 4).map(([t, c]) => (
                <div key={t} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full border border-white" style={{ background: c }} />
                  <span className="text-gray-400">{t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Filters + incident list */}
          <div className="h-56 border-t border-gray-800 flex flex-col bg-gray-900">
            {/* Filter bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 flex-shrink-0">
              <Activity className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-xs text-gray-400 font-medium">
                {filtered.length} incident{filtered.length !== 1 ? 's' : ''}
              </span>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="ml-auto bg-gray-800 border border-gray-700 text-xs text-white
                           rounded px-2 py-1 focus:outline-none"
              >
                <option value="">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="FALSE_ALARM">False Alarm</option>
                <option value="DISPATCHED">Dispatched</option>
              </select>
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-xs text-white
                           rounded px-2 py-1 focus:outline-none"
              >
                <option value="">All Types</option>
                {Object.keys(INCIDENT_COLOURS).map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* Scrollable incident row */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden">
              <div className="flex gap-2 h-full items-stretch px-3 py-2 min-w-0">
                {filtered.length === 0 ? (
                  <div className="flex items-center justify-center w-full text-gray-600 text-xs">
                    <Info className="h-4 w-4 mr-2" />
                    No incidents yet — AI simulation is running in background
                  </div>
                ) : (
                  filtered.slice(0, 20).map(inc => (
                    <div key={inc.incident_id} className="w-64 flex-shrink-0">
                      <IncidentCard
                        incident={inc}
                        selected={selectedIncident?.incident_id === inc.incident_id}
                        onClick={() => selectIncident(inc)}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right column: incident detail */}
        <div className="w-80 flex-shrink-0 border-l border-gray-800 overflow-hidden flex flex-col">
          {selectedIncident ? (
            <IncidentDetail
              incident={selectedIncident}
              onClose={() => selectIncident(null)}
              onAction={(action, notes) =>
                actionMutation.mutate({
                  id: selectedIncident.incident_id,
                  action,
                  notes,
                })
              }
              loading={actionMutation.isPending}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3 p-6">
              <Eye className="h-10 w-10 opacity-30" />
              <p className="text-sm text-center">
                Select an incident from the map or list to view AI details &amp; take action
              </p>
              <div className="text-[11px] text-gray-700 space-y-1 text-left w-full bg-gray-900/50 rounded-lg p-3">
                <p className="text-gray-500 font-medium mb-2">Workflow:</p>
                <p>1. AI detects incident → alert sent</p>
                <p>2. Officer reviews snapshot + summary</p>
                <p>3. Confirm Incident or Mark False Alarm</p>
                <p>4. Only after confirm → Dispatch station</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
