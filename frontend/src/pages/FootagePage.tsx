/**
 * FootagePage.tsx — Evidence Footage Download
 * VigilanteVanguard — Karnataka State Police
 *
 * Police officers can:
 *   • Pick a camera from the dropdown
 *   • Filter by severity (ALL / CRITICAL / HIGH / MEDIUM / LOW)
 *   • Browse all recorded incidents for that camera
 *   • Play each incident's video inline in the browser
 *   • Download individual 5-minute chunks
 *   • Download the full recording in one click
 */

import { useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Film, Camera, Download, Play, Pause, AlertTriangle,
  RefreshCw, MapPin, Clock, Shield, ChevronDown,
  ChevronRight, Video, FileVideo, Eye, ExternalLink,
  Wifi, Save,
} from 'lucide-react'
import { apiClient } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── RPi5 IP persistence (shared with CCTVPage) ────────────────────
const RPI_IP_LS_KEY = 'vv_rpi_ip'
function loadRpiIp(): string {
  try { return localStorage.getItem(RPI_IP_LS_KEY) ?? '' } catch { return '' }
}
function saveRpiIp(ip: string) {
  try { localStorage.setItem(RPI_IP_LS_KEY, ip.trim()) } catch { /* ignore */ }
}

// ── Types ─────────────────────────────────────────────────────────

interface VideoChunk {
  chunk:       number
  label:       string
  url:         string
  incident_id: string
  size_mb:     number | null
  exists:      boolean | null
}

interface FootageItem {
  incident_id:   string
  camera_id:     string
  severity:      string
  incident_type: string
  description:   string
  timestamp:     string
  address:       string
  lat:           number
  lng:           number
  plates:        string[]
  video_url:     string
  chunks:        VideoChunk[]
  source:        string
}

// ── API calls ─────────────────────────────────────────────────────

async function fetchFootageCameras(): Promise<string[]> {
  const r = await apiClient.get('/rpi/footage/cameras')
  return r.data.cameras ?? []
}

async function fetchFootage(
  cameraId: string | null,
  severity: string | null,
  chunkMinutes: number,
): Promise<FootageItem[]> {
  const params: Record<string, string> = { chunk_minutes: String(chunkMinutes) }
  if (cameraId) params.camera_id = cameraId
  if (severity && severity !== 'ALL') params.severity = severity
  const r = await apiClient.get('/rpi/footage', { params })
  return r.data.footage ?? []
}

// ── Helpers ───────────────────────────────────────────────────────

const SEV_STYLE: Record<string, string> = {
  CRITICAL: 'bg-red-900/50 text-red-400 border-red-700',
  HIGH:     'bg-orange-900/50 text-orange-400 border-orange-700',
  MEDIUM:   'bg-yellow-900/50 text-yellow-400 border-yellow-700',
  LOW:      'bg-green-900/50 text-green-400 border-green-700',
  MONITOR:  'bg-blue-900/50 text-blue-400 border-blue-700',
}

const SEV_DOT: Record<string, string> = {
  CRITICAL: 'bg-red-500',
  HIGH:     'bg-orange-400',
  MEDIUM:   'bg-yellow-400',
  LOW:      'bg-green-400',
  MONITOR:  'bg-blue-400',
}

function fmtTs(ts?: string) {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return d.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
  } catch { return ts }
}

function navUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
}

// ── Inline video player + chunk download panel ────────────────────

function VideoPanel({ item }: { item: FootageItem }) {
  const [playing, setPlaying]     = useState(false)
  const [activeUrl, setActiveUrl] = useState(item.video_url)
  const [expanded, setExpanded]   = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const playChunk = (url: string) => {
    setActiveUrl(url)
    setPlaying(true)
    setTimeout(() => videoRef.current?.play(), 100)
  }

  const togglePlay = () => {
    if (!videoRef.current) return
    if (videoRef.current.paused) { videoRef.current.play(); setPlaying(true) }
    else                         { videoRef.current.pause(); setPlaying(false) }
  }

  return (
    <div className="mt-3 space-y-3">
      {/* Inline player */}
      {activeUrl && (
        <div className="relative bg-black rounded-lg overflow-hidden border border-gray-700">
          <video
            ref={videoRef}
            src={activeUrl}
            controls
            className="w-full max-h-56 object-contain"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setPlaying(false)}
          />
          {/* Overlay when not started */}
          {!playing && (
            <button
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center
                         bg-black/60 hover:bg-black/40 transition-colors group"
            >
              <div className="bg-blue-600 group-hover:bg-blue-500 rounded-full p-3 transition-colors">
                <Play className="h-6 w-6 text-white ml-0.5" />
              </div>
            </button>
          )}
        </div>
      )}

      {/* Chunk list */}
      <div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1.5 text-[11px] text-gray-400
                     hover:text-white transition-colors"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {item.chunks.length > 1
            ? `${item.chunks.length} parts · ${item.chunks.length * 5} min total`
            : 'Full recording'
          }
        </button>

        {expanded && (
          <div className="mt-2 space-y-1.5">
            {item.chunks.map(chunk => (
              <div
                key={chunk.chunk}
                className={cn(
                  'flex items-center justify-between gap-2 px-3 py-2 rounded-lg border',
                  activeUrl === chunk.url
                    ? 'bg-blue-950/50 border-blue-700'
                    : 'bg-gray-800/50 border-gray-700',
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileVideo className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
                  <span className="text-[11px] text-gray-300 truncate">{chunk.label}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Play this chunk */}
                  <button
                    onClick={() => playChunk(chunk.url)}
                    title="Play"
                    className="p-1 rounded hover:bg-blue-900/50 text-blue-400 hover:text-blue-300
                               transition-colors"
                  >
                    <Play className="h-3 w-3" />
                  </button>
                  {/* Download this chunk */}
                  <a
                    href={chunk.url}
                    download={`INC-${chunk.incident_id}_part${chunk.chunk}.mp4`}
                    target="_blank"
                    rel="noreferrer"
                    title="Download"
                    className="p-1 rounded hover:bg-green-900/50 text-green-400 hover:text-green-300
                               transition-colors"
                  >
                    <Download className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Incident card ─────────────────────────────────────────────────

function FootageCard({ item }: { item: FootageItem }) {
  const [showVideo, setShowVideo] = useState(false)

  const hasFootage = Boolean(item.video_url)
  const plateStr   = item.plates.length ? item.plates.join(', ') : '—'

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          {/* Severity dot */}
          <div className={cn(
            'w-2 h-2 rounded-full mt-1.5 flex-shrink-0',
            SEV_DOT[item.severity] ?? 'bg-gray-500',
          )} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-white">
                INC-{item.incident_id}
              </span>
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full border',
                SEV_STYLE[item.severity] ?? SEV_STYLE.MONITOR,
              )}>
                {item.severity}
              </span>
              <span className="text-[10px] text-gray-500 font-mono">
                {item.camera_id}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
              {item.incident_type.replace(/_/g, ' ')}
              {item.description && ` — ${item.description.slice(0, 60)}`}
            </p>
          </div>
        </div>

        {/* Timestamp */}
        <div className="flex items-center gap-1 text-[10px] text-gray-500 flex-shrink-0">
          <Clock className="h-3 w-3" />
          {fmtTs(item.timestamp)}
        </div>
      </div>

      {/* Location + plates */}
      <div className="mt-2.5 flex items-start gap-4 text-[11px] text-gray-500">
        {item.address && (
          <span className="flex items-start gap-1">
            <MapPin className="h-3 w-3 flex-shrink-0 mt-0.5" />
            <span className="text-gray-400">{item.address}</span>
          </span>
        )}
        {item.plates.length > 0 && (
          <span className="flex items-center gap-1 font-mono">
            🚗 {plateStr}
          </span>
        )}
      </div>

      {/* Action row */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {hasFootage ? (
          <>
            {/* Toggle inline player */}
            <button
              onClick={() => setShowVideo(v => !v)}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg
                         bg-blue-900/40 hover:bg-blue-900 border border-blue-700 text-blue-300
                         transition-colors"
            >
              {showVideo ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {showVideo ? 'Hide Video' : 'Play Evidence'}
            </button>

            {/* Direct download (full file) */}
            <a
              href={item.video_url}
              download={`INC-${item.incident_id}.mp4`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg
                         bg-green-900/40 hover:bg-green-900 border border-green-700 text-green-300
                         transition-colors"
            >
              <Download className="h-3 w-3" />
              Download Full
            </a>

            {/* Open in new tab */}
            <a
              href={item.video_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg
                         bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400
                         hover:text-white transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </a>
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] text-gray-600 px-2.5 py-1.5
                           bg-gray-800 border border-gray-700 rounded-lg">
            <Video className="h-3 w-3" />
            No footage yet
          </span>
        )}

        {/* Navigate to scene */}
        {item.lat !== 0 && (
          <a
            href={navUrl(item.lat, item.lng)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg
                       bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400
                       hover:text-white transition-colors ml-auto"
          >
            <MapPin className="h-3 w-3" />
            Navigate
          </a>
        )}
      </div>

      {/* Inline player + chunk panel */}
      {showVideo && hasFootage && <VideoPanel item={item} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════

const SEVERITY_OPTIONS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'MONITOR']
const CHUNK_OPTIONS = [{ label: '5 min', value: 5 }, { label: '10 min', value: 10 }, { label: 'Full', value: 60 }]

export default function FootagePage() {
  const [selectedCamera,   setSelectedCamera]   = useState<string>('')
  const [selectedSeverity, setSelectedSeverity] = useState<string>('ALL')
  const [chunkMinutes,     setChunkMinutes]      = useState<number>(5)

  // ── RPi5 IP state ─────────────────────────────────────────────
  const [rpiIp,      setRpiIpState] = useState<string>(loadRpiIp)
  const [rpiSaved,   setRpiSaved]   = useState(false)
  const [showIpBox,  setShowIpBox]  = useState(!loadRpiIp())

  const handleSaveRpiIp = () => {
    saveRpiIp(rpiIp)
    setRpiSaved(true)
    setShowIpBox(false)
    setTimeout(() => setRpiSaved(false), 2000)
  }

  // Fetch available cameras
  const { data: cameras = [], isLoading: camsLoading } = useQuery({
    queryKey: ['footage-cameras'],
    queryFn:  fetchFootageCameras,
    staleTime: 60_000,
  })

  // Fetch footage list
  const {
    data: footage = [],
    isLoading: footageLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['footage', selectedCamera, selectedSeverity, chunkMinutes],
    queryFn:  () => fetchFootage(
      selectedCamera || null,
      selectedSeverity === 'ALL' ? null : selectedSeverity,
      chunkMinutes,
    ),
    staleTime: 30_000,
  })

  // Stats
  const withFootage    = footage.filter(f => f.video_url)
  const withoutFootage = footage.length - withFootage.length

  return (
    <div className="h-full flex flex-col bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800
                      bg-gray-900 flex-shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-blue-700 p-2 rounded-lg">
            <Film className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">Evidence Footage</h1>
            <p className="text-[11px] text-gray-400">
              {footage.length} incidents · {withFootage.length} with footage
            </p>
          </div>
        </div>

        {/* RPi5 IP indicator + edit button */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {rpiIp.trim() ? (
            <button
              onClick={() => setShowIpBox(v => !v)}
              className="flex items-center gap-1.5 text-[10px] bg-green-950/40 border border-green-700/50
                         text-green-400 px-2.5 py-1.5 rounded-lg hover:bg-green-900/40 transition-colors"
              title="Click to change RPi5 IP"
            >
              <Wifi className="h-3 w-3" />
              RPi5: {rpiIp.trim()}
            </button>
          ) : (
            <button
              onClick={() => setShowIpBox(true)}
              className="flex items-center gap-1.5 text-[10px] bg-yellow-950/40 border border-yellow-700/50
                         text-yellow-400 px-2.5 py-1.5 rounded-lg hover:bg-yellow-900/40 transition-colors animate-pulse"
            >
              <Wifi className="h-3 w-3" />
              Set RPi5 IP
            </button>
          )}
          {/* Refresh */}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-gray-500 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* RPi5 IP input box — shown when no IP set or user clicks to edit */}
      {showIpBox && (
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-blue-800/40
                        bg-blue-950/20 flex-shrink-0">
          <Wifi className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-[10px] text-blue-300 font-semibold mb-1">
              RPi5 Unit IP Address
              <span className="text-gray-400 font-normal ml-2">
                — The IP of your Raspberry Pi on the current WiFi network
              </span>
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={rpiIp}
                onChange={e => setRpiIpState(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveRpiIp() }}
                placeholder="192.168.x.x"
                autoFocus
                className="flex-1 bg-gray-900 border border-blue-700/60 rounded-lg px-3 py-1.5
                           text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500
                           font-mono"
              />
              <button
                onClick={handleSaveRpiIp}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex-shrink-0',
                  rpiSaved
                    ? 'bg-green-700 text-white'
                    : 'bg-blue-700 hover:bg-blue-600 text-white',
                )}
              >
                <Save className="h-3 w-3" />
                {rpiSaved ? 'Saved ✓' : 'Save'}
              </button>
              {rpiIp.trim() && (
                <a
                  href={`http://${rpiIp.trim()}:5000`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                             bg-gray-800 border border-gray-700 text-gray-300 hover:text-white
                             hover:bg-gray-700 transition-colors flex-shrink-0"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open RPi5 Dashboard
                </a>
              )}
              <button
                onClick={() => setShowIpBox(false)}
                className="text-gray-500 hover:text-white transition-colors flex-shrink-0 px-1"
              >
                ✕
              </button>
            </div>
            {rpiIp.trim() && (
              <p className="text-[9px] text-gray-600 mt-1 font-mono">
                Live stream: http://{rpiIp.trim()}:5000/video_feed
              </p>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800
                      bg-gray-900/50 flex-shrink-0 flex-wrap">

        {/* Camera picker */}
        <div className="flex items-center gap-2">
          <Camera className="h-3.5 w-3.5 text-gray-500" />
          <select
            value={selectedCamera}
            onChange={e => setSelectedCamera(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-xs text-white rounded-lg
                       px-2.5 py-1.5 focus:outline-none focus:border-blue-500 min-w-[140px]"
          >
            <option value="">All Cameras</option>
            {cameras.map(cam => (
              <option key={cam} value={cam}>{cam}</option>
            ))}
            {camsLoading && <option disabled>Loading…</option>}
          </select>
        </div>

        {/* Severity filter */}
        <div className="flex items-center gap-1">
          {SEVERITY_OPTIONS.map(sev => (
            <button
              key={sev}
              onClick={() => setSelectedSeverity(sev)}
              className={cn(
                'text-[10px] px-2.5 py-1 rounded-full border transition-colors font-medium',
                selectedSeverity === sev
                  ? sev === 'ALL'
                    ? 'bg-gray-700 border-gray-500 text-white'
                    : `${SEV_STYLE[sev] ?? SEV_STYLE.MONITOR} opacity-100`
                  : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300',
              )}
            >
              {sev}
            </button>
          ))}
        </div>

        {/* Chunk size */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-gray-500">Chunk size:</span>
          <div className="flex gap-1">
            {CHUNK_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setChunkMinutes(opt.value)}
                className={cn(
                  'text-[10px] px-2.5 py-1 rounded border transition-colors',
                  chunkMinutes === opt.value
                    ? 'bg-blue-900/50 border-blue-700 text-blue-300'
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-white',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      {footage.length > 0 && (
        <div className="flex items-center gap-4 px-5 py-2 border-b border-gray-800
                        bg-gray-900/30 flex-shrink-0 text-[11px] text-gray-500">
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" /> {footage.length} incidents
          </span>
          <span className="flex items-center gap-1">
            <Video className="h-3 w-3 text-green-500" />
            <span className="text-green-400">{withFootage.length} with footage</span>
          </span>
          {withoutFootage > 0 && (
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-yellow-500" />
              <span className="text-yellow-500">{withoutFootage} uploading…</span>
            </span>
          )}
          {selectedCamera && (
            <span className="flex items-center gap-1 ml-auto">
              <Camera className="h-3 w-3" /> {selectedCamera}
            </span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {footageLoading && (
          <div className="flex items-center justify-center h-40 text-gray-600">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            Loading footage…
          </div>
        )}

        {!footageLoading && footage.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-3">
            <Film className="h-10 w-10 opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium text-gray-500">No footage found</p>
              <p className="text-[11px] text-gray-600 mt-1">
                {selectedCamera
                  ? `No incidents recorded by ${selectedCamera}`
                  : 'No incidents with uploaded video yet'}
              </p>
              <p className="text-[10px] text-gray-700 mt-1">
                Videos appear here after the RPi5 uploads them to Cloudinary/Backblaze
              </p>
            </div>
          </div>
        )}

        {!footageLoading && footage.map(item => (
          <FootageCard key={item.incident_id} item={item} />
        ))}
      </div>

      {/* Info footer */}
      <div className="px-5 py-2 border-t border-gray-800 bg-gray-900/50 flex-shrink-0
                      flex items-center gap-2 text-[10px] text-gray-600">
        <Shield className="h-3 w-3" />
        Evidence footage is stored on the RPi5 NVMe SSD and uploaded to cloud storage.
        5-min chunks are generated automatically. Download requires network access.
      </div>
    </div>
  )
}
