/**
 * CamerasPage.tsx — Camera Management
 * VigilanteVanguard — Karnataka State Police
 *
 * Features:
 *  • List all registered cameras (demo + live)
 *  • Add new IP camera with URL + GPS
 *  • Health check each camera (latency ping)
 *  • View incidents per camera
 *  • Connect directly to IP cam stream
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Camera, Wifi, WifiOff, Plus, CheckCircle, XCircle,
  RefreshCw, MapPin, AlertTriangle, Play, Activity,
  Video, Shield, Clock,
} from 'lucide-react'
import { fetchCameras, registerCamera, fetchIncidents, type CCTVCamera } from '@/lib/cctvApi'
import { apiClient } from '@/lib/api'
import { cn } from '@/lib/utils'

async function checkCameraHealth(cameraId: string) {
  const r = await apiClient.get(`/cctv/cameras/${encodeURIComponent(cameraId)}/health`)
  return r.data as { status: string; latency_ms: number; message?: string; error?: string }
}

const STATUS_STYLE: Record<string, string> = {
  active:      'bg-green-900/50 text-green-400 border-green-700',
  offline:     'bg-red-900/50 text-red-400 border-red-700',
  maintenance: 'bg-yellow-900/50 text-yellow-400 border-yellow-700',
  demo:        'bg-blue-900/50 text-blue-400 border-blue-700',
}

const SOURCE_ICON: Record<string, string> = {
  demo:   '🎭',
  ipcam:  '📷',
  rtsp:   '📡',
  webcam: '💻',
  upload: '📁',
}

function fmtTs(ts?: string) {
  if (!ts) return '—'
  try { return new Date(ts).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) }
  catch { return ts }
}

// ─── Camera card ─────────────────────────────────────────────────
function CameraCard({
  camera,
  onHealthCheck,
  healthResult,
  checking,
}: {
  camera: CCTVCamera & { last_seen?: string; incident_count?: number }
  onHealthCheck: (id: string) => void
  healthResult?: { status: string; latency_ms: number; message?: string; error?: string }
  checking: boolean
}) {
  const navigate = useNavigate()

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg flex-shrink-0">{SOURCE_ICON[camera.source_type] ?? '📷'}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{camera.name}</p>
            <p className="text-[10px] text-gray-500 truncate">{camera.camera_id}</p>
          </div>
        </div>
        <span className={cn('text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0',
          STATUS_STYLE[camera.status] ?? STATUS_STYLE.active)}>
          {camera.status}
        </span>
      </div>

      {/* Location */}
      <div className="flex items-start gap-1.5">
        <MapPin className="h-3.5 w-3.5 text-gray-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-[11px] text-gray-300 leading-snug">{camera.location || 'No location set'}</p>
          <p className="text-[10px] text-gray-600">
            {camera.lat.toFixed(5)}, {camera.lng.toFixed(5)}
            {camera.district && ` · ${camera.district}`}
          </p>
        </div>
      </div>

      {/* Source URL */}
      {camera.source_url && (
        <div className="flex items-center gap-1.5">
          <Wifi className="h-3 w-3 text-gray-600 flex-shrink-0" />
          <span className="text-[10px] text-gray-600 truncate">{camera.source_url}</span>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[10px] text-gray-500">
        {camera.incident_count !== undefined && (
          <span className="flex items-center gap-1">
            <Activity className="h-3 w-3" />
            {camera.incident_count} incidents
          </span>
        )}
        {camera.last_seen && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {fmtTs(camera.last_seen)}
          </span>
        )}
      </div>

      {/* Health result */}
      {healthResult && (
        <div className={cn(
          'rounded-lg px-3 py-2 text-[11px] border',
          healthResult.status === 'online'
            ? 'bg-green-950/40 border-green-700 text-green-300'
            : healthResult.status === 'demo'
            ? 'bg-blue-950/40 border-blue-700 text-blue-300'
            : 'bg-red-950/40 border-red-700 text-red-300'
        )}>
          {healthResult.status === 'online' && `✓ Online · ${healthResult.latency_ms}ms latency`}
          {healthResult.status === 'demo'   && `🎭 Demo camera`}
          {healthResult.status === 'offline' && `✗ Offline — ${healthResult.error}`}
          {healthResult.message && ` — ${healthResult.message}`}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onHealthCheck(camera.camera_id)}
          disabled={checking}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg
                     bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400
                     hover:text-white transition-colors disabled:opacity-50"
        >
          {checking
            ? <RefreshCw className="h-3 w-3 animate-spin" />
            : <CheckCircle className="h-3 w-3" />
          }
          Health Check
        </button>
        <button
          onClick={() => navigate('/cctv')}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg
                     bg-blue-900/40 hover:bg-blue-900 border border-blue-700 text-blue-300
                     transition-colors"
        >
          <Play className="h-3 w-3" />
          View Live
        </button>
        {camera.lat && camera.lng && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${camera.lat},${camera.lng}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg
                       bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400
                       hover:text-white transition-colors"
          >
            <MapPin className="h-3 w-3" />
            Maps
          </a>
        )}
      </div>
    </div>
  )
}

// ─── Add Camera form ─────────────────────────────────────────────
// ── RPi5 IP persistence ────────────────────────────────────────────
const RPI_IP_LS_KEY = 'vv_rpi_ip'
function loadRpiIp(): string {
  try { return localStorage.getItem(RPI_IP_LS_KEY) ?? '' } catch { return '' }
}

function AddCameraForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false)

  // Default stream URL from saved RPi IP (empty otherwise)
  const savedIp = loadRpiIp()
  const defaultUrl = savedIp ? `http://${savedIp}:5000/video_feed` : ''

  const [form, setForm] = useState({
    camera_id:   '',
    name:        '',
    location:    '',
    source_url:  defaultUrl,
    source_type: 'ipcam',
    lat:         '12.9716',
    lng:         '77.5946',
    district:    'Bengaluru City',
    zone:        'Bengaluru',
  })
  const [gpsLoading, setGpsLoading] = useState(false)

  const mut = useMutation({
    mutationFn: () => registerCamera({
      ...form,
      lat: parseFloat(form.lat) || 12.9716,
      lng: parseFloat(form.lng) || 77.5946,
    } as any),
    onSuccess: () => {
      setOpen(false)
      setForm(f => ({ ...f, camera_id: '', name: '', location: '' }))
      onAdded()
    },
  })

  const grabGPS = useCallback(async () => {
    setGpsLoading(true)
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
      )
      setForm(f => ({
        ...f,
        lat: pos.coords.latitude.toFixed(6),
        lng: pos.coords.longitude.toFixed(6),
        location: f.location || `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
      }))
    } catch { /* denied */ }
    setGpsLoading(false)
  }, [])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300
                   bg-blue-950/30 hover:bg-blue-950/50 border border-blue-700/50 rounded-xl
                   px-4 py-3 transition-colors w-full"
      >
        <Plus className="h-4 w-4" />
        Add New Camera
      </button>
    )
  }

  return (
    <div className="bg-gray-900 border border-blue-700/50 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white">Register New Camera</span>
        <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white text-xl">×</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { key: 'camera_id',   label: 'Camera ID',    placeholder: 'CAM-IPCAM-001' },
          { key: 'name',        label: 'Display Name', placeholder: 'MG Road Camera' },
          { key: 'location',    label: 'Address',      placeholder: 'MG Road, Bengaluru' },
          { key: 'source_url',  label: 'Stream URL',   placeholder: 'http://[RPi5-IP]:5000/video_feed' },
          { key: 'district',    label: 'District',     placeholder: 'Bengaluru City' },
          { key: 'zone',        label: 'Zone',         placeholder: 'Bengaluru' },
        ].map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="text-[10px] text-gray-500 block mb-1 font-medium uppercase tracking-wide">{label}</label>
            <input
              value={(form as any)[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5
                         text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
        ))}
      </div>

      {/* GPS */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-[10px] text-gray-500 block mb-1 font-medium uppercase">Latitude</label>
          <input
            value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-gray-500 block mb-1 font-medium uppercase">Longitude</label>
          <input
            value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <button
          onClick={grabGPS}
          disabled={gpsLoading}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-green-900/40
                     border border-green-700 text-green-300 hover:bg-green-900 disabled:opacity-50"
        >
          {gpsLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
          GPS
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <select
          value={form.source_type}
          onChange={e => setForm(f => ({ ...f, source_type: e.target.value }))}
          className="bg-gray-800 border border-gray-700 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none"
        >
          <option value="ipcam">IP Camera</option>
          <option value="rtsp">RTSP</option>
          <option value="webcam">Webcam</option>
          <option value="demo">Demo</option>
        </select>
        <button
          onClick={() => mut.mutate()}
          disabled={!form.camera_id || !form.name || mut.isPending}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold
                     bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white py-1.5 rounded-lg"
        >
          {mut.isPending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Register Camera
        </button>
      </div>

      {mut.isError && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Failed to register — check camera ID and URL
        </p>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════

export default function CamerasPage() {
  const qc = useQueryClient()

  const { data: cameras = [], isLoading } = useQuery({
    queryKey: ['cctv-cameras'],
    queryFn:  fetchCameras,
    refetchInterval: 30_000,
  })

  const { data: incData } = useQuery({
    queryKey: ['cctv-incidents'],
    queryFn:  () => fetchIncidents({ limit: 200 }),
  })

  // Count incidents per camera
  const incidentsByCamera: Record<string, number> = {}
  incData?.incidents.forEach(inc => {
    incidentsByCamera[inc.camera_id] = (incidentsByCamera[inc.camera_id] ?? 0) + 1
  })

  const [healthResults, setHealthResults] = useState<Record<string, any>>({})
  const [checking,      setChecking]      = useState<Record<string, boolean>>({})

  const doHealthCheck = useCallback(async (cameraId: string) => {
    setChecking(c => ({ ...c, [cameraId]: true }))
    try {
      const result = await checkCameraHealth(cameraId)
      setHealthResults(r => ({ ...r, [cameraId]: result }))
    } catch (e: any) {
      setHealthResults(r => ({ ...r, [cameraId]: { status: 'offline', latency_ms: 0, error: e.message } }))
    }
    setChecking(c => ({ ...c, [cameraId]: false }))
  }, [])

  const liveCameras  = cameras.filter(c => c.source_type !== 'demo')
  const demoCameras  = cameras.filter(c => c.source_type === 'demo')

  return (
    <div className="h-full flex flex-col bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800
                      bg-gray-900 flex-shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-blue-700 p-2 rounded-lg">
            <Camera className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">Camera Management</h1>
            <p className="text-[11px] text-gray-400">
              {cameras.length} cameras registered · {liveCameras.length} live
            </p>
          </div>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['cctv-cameras'] })}
          className="text-gray-500 hover:text-white transition-colors"
          title="Refresh"
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Add camera */}
        <AddCameraForm onAdded={() => qc.invalidateQueries({ queryKey: ['cctv-cameras'] })} />

        {/* Live cameras */}
        {liveCameras.length > 0 && (
          <div>
            <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider mb-2">
              Live / IP Cameras ({liveCameras.length})
            </p>
            <div className="grid grid-cols-2 gap-3">
              {liveCameras.map(cam => (
                <CameraCard
                  key={cam.camera_id}
                  camera={{ ...cam, incident_count: incidentsByCamera[cam.camera_id] ?? 0 }}
                  onHealthCheck={doHealthCheck}
                  healthResult={healthResults[cam.camera_id]}
                  checking={!!checking[cam.camera_id]}
                />
              ))}
            </div>
          </div>
        )}

        {/* Demo cameras */}
        {demoCameras.length > 0 && (
          <div>
            <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider mb-2">
              Demo / Simulation Cameras ({demoCameras.length})
            </p>
            <div className="grid grid-cols-2 gap-3">
              {demoCameras.map(cam => (
                <CameraCard
                  key={cam.camera_id}
                  camera={{ ...cam, incident_count: incidentsByCamera[cam.camera_id] ?? 0 }}
                  onHealthCheck={doHealthCheck}
                  healthResult={healthResults[cam.camera_id]}
                  checking={!!checking[cam.camera_id]}
                />
              ))}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center h-32 text-gray-600">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            Loading cameras…
          </div>
        )}
      </div>
    </div>
  )
}
