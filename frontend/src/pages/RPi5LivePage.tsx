/**
 * RPi5LivePage.tsx — VigilanteVanguard
 * Raspberry Pi 5 Live View
 *
 * HOW STREAMS WORK:
 *   Pi runs Flask at http://<piIp>:5000
 *   /video_feed  → MJPEG stream of whichever camera the Pi has active (USB or IP)
 *   /switch?camera=usb  → tells Pi to switch to USB camera
 *   /switch?camera=ip   → tells Pi to switch to IP cam feed
 *   /status      → JSON status (fps, detections, accident engine, GPS, LTE)
 *
 *   Pi Camera panel  → always http://<piIp>:5000/video_feed
 *                       (refreshes with a new key after switching so MJPEG reconnects)
 *   IP Cam panel     → direct stream from phone IP Webcam app (no Pi relay)
 *
 * BUTTONS:
 *   "Switch Hailo to Pi Cam"  → POST /switch?camera=usb, reload Pi stream
 *   "Switch Hailo to IP Cam"  → POST /switch?camera=ip,  Pi stream now shows IP cam via Pi
 *
 * NOTE: When Pi is offline, IP Cam panel is the primary live view.
 *       Default active cam is 'ip' so IP cam shows as primary until Pi responds.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Cpu, Camera, Wifi, WifiOff, RefreshCw, Activity,
  Zap, AlertTriangle, ExternalLink, Settings,
  Maximize2, Minimize2, Eye, Radio, Crosshair, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────
interface PiStatus {
  fps:        { camera: number; hailo: number; encode: number }
  timing:     { pre?: number; inf?: number; post?: number }
  accident:   { status: string; score: number; confirm_count: number; event_id: string | null; classes: string[] }
  gps:        { fix: boolean; lat: number | null; lng: number | null; method: string }
  lte:        { online: boolean; rssi: number | null }
  detections: Array<{ class_id: number; class_name: string; score: number }>
}

const ACC_COLOUR: Record<string, string> = {
  NORMAL:    'text-green-400',
  POSSIBLE:  'text-yellow-400',
  CONFIRMED: 'text-orange-400',
  ALERT:     'text-red-400',
}
const ACC_BORDER: Record<string, string> = {
  NORMAL:    'border-gray-800 bg-gray-900',
  POSSIBLE:  'border-yellow-700/40 bg-yellow-950/20',
  CONFIRMED: 'border-orange-700/40 bg-orange-950/20',
  ALERT:     'border-red-500/60 bg-red-950/40 animate-pulse',
}

// ── MJPEGPanel — renders a single MJPEG stream ─────────────────────
function MJPEGPanel({
  title, badge, badgeColour, streamUrl, streamKey, isActive,
  onSwitchClick, switchLabel, note, icon,
}: {
  title:        string
  badge:        string
  badgeColour:  string
  streamUrl:    string
  streamKey:    number
  isActive:     boolean
  onSwitchClick?: () => void
  switchLabel?: string
  note?:        string
  icon:         React.ReactNode
}) {
  const [error,    setError]    = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [localKey, setLocalKey] = useState(0)
  // Combine local and external keys so either triggers a reload
  const imgKey = `${streamUrl}-${streamKey}-${localKey}`

  // Reset error whenever URL or key changes
  useEffect(() => { setError(false) }, [streamUrl, streamKey])

  const reload = useCallback(() => { setError(false); setLocalKey(k => k + 1) }, [])

  return (
    <div className={cn(
      'flex flex-col rounded-xl border overflow-hidden bg-gray-900',
      expanded ? 'fixed inset-4 z-50' : 'border-gray-800',
      isActive && 'border-blue-600/60',
    )}>
      {/* Title bar */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 border-b flex-shrink-0',
        isActive ? 'bg-blue-950/40 border-blue-800/60' : 'bg-gray-800/50 border-gray-700/50',
      )}>
        <span className={isActive ? 'text-blue-400' : 'text-gray-400'}>{icon}</span>
        <span className="text-xs font-semibold text-white">{title}</span>
        <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-bold', badgeColour)}>
          {badge}
        </span>
        {isActive && (
          <span className="flex items-center gap-1 text-[10px] text-green-400 ml-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Hailo active
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={reload} title="Reload stream"
            className="p-1 text-gray-500 hover:text-white transition-colors">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setExpanded(e => !e)} title="Fullscreen"
            className="p-1 text-gray-500 hover:text-white transition-colors">
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          {!isActive && onSwitchClick && (
            <button onClick={onSwitchClick}
              className="flex items-center gap-1 px-2 py-0.5 bg-blue-700 hover:bg-blue-600 text-white text-[10px] rounded-md transition-colors ml-1">
              <Radio className="h-3 w-3" />
              {switchLabel ?? 'Switch Pi to this cam'}
            </button>
          )}
        </div>
      </div>

      {/* Stream */}
      <div className="relative flex-1 bg-black min-h-0">
        {!error ? (
          <img
            key={imgKey}
            src={streamUrl}
            alt={title}
            className="w-full h-full object-contain"
            onError={() => setError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600">
            <WifiOff className="h-10 w-10 opacity-20" />
            <p className="text-xs text-gray-500">Stream unavailable</p>
            <p className="text-[10px] text-gray-700 text-center max-w-[200px] break-all">{streamUrl}</p>
            <button onClick={reload}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-xs rounded-lg transition-colors">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        )}

        {/* Note banner */}
        {note && !error && (
          <div className="absolute top-2 left-2 right-2 bg-black/70 text-[10px] text-yellow-300 px-2 py-1 rounded text-center">
            {note}
          </div>
        )}

        {/* URL strip at bottom */}
        {!error && (
          <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 px-2 py-1 bg-black/50">
            <span className="text-[9px] text-gray-600 truncate flex-1">{streamUrl}</span>
            <a href={streamUrl} target="_blank" rel="noopener noreferrer"
              className="text-gray-600 hover:text-white flex-shrink-0">
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────
export default function RPi5LivePage() {
  // Persisted settings
  const [piIp,       setPiIp]       = useState(() => localStorage.getItem('vv_rpi_ip')      || '192.168.1.8')
  const [ipCamUrl,   setIpCamUrl]   = useState(() => localStorage.getItem('vv_ipcam_url')   || 'http://192.168.1.9:8081/video')
  const [piCamLabel, setPiCamLabel] = useState(() => localStorage.getItem('vv_picam_label') || 'Pi Camera Feed')
  const [ipCamLabel, setIpCamLabel] = useState(() => localStorage.getItem('vv_ipcam_label') || 'IP Camera (Phone)')

  // Default to 'ip' so the IP cam shows as active when Pi is offline
  // (gets overridden by Pi /status response once Pi is online)
  const [activeCam,    setActiveCam]    = useState<'usb' | 'ip'>('ip')
  const [switching,    setSwitching]    = useState(false)
  const [switchErr,    setSwitchErr]    = useState('')

  // Pi status
  const [status,    setStatus]    = useState<PiStatus | null>(null)
  const [piOnline,  setPiOnline]  = useState<boolean | null>(null)

  // Config panel
  const [showConfig, setShowConfig] = useState(false)

  // Stream keys — incrementing forces the <img> to reconnect
  // usbKey bumps whenever Pi switches camera
  const [usbKey, setUsbKey] = useState(0)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Derived URLs
  const piBase    = `http://${piIp}:5000`
  // Pi panel: always the Pi's annotated MJPEG stream (whatever camera Pi has active)
  const usbStream = `${piBase}/video_feed`
  // IP panel: always the phone directly — never goes through Pi
  const ipStream  = ipCamUrl.trim()

  // ── Poll Pi /status ──────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${piBase}/status`, { signal: AbortSignal.timeout(2000) })
      if (r.ok) {
        const data: any = await r.json()
        setStatus(data)
        setPiOnline(true)
        // Read back which camera the Pi says is active from status
        if (data?.camera_mode) {
          setActiveCam(data.camera_mode === 'usb' ? 'usb' : 'ip')
        }
      } else {
        setPiOnline(false)
      }
    } catch {
      setPiOnline(false)
    }
  }, [piBase])

  useEffect(() => {
    fetchStatus()
    pollRef.current = setInterval(fetchStatus, 1500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchStatus])

  // ── Switch Pi camera ─────────────────────────────────────────────
  async function switchTo(mode: 'usb' | 'ip') {
    if (switching) return
    setSwitching(true)
    setSwitchErr('')
    try {
      const r = await fetch(`${piBase}/switch?camera=${mode}`, { signal: AbortSignal.timeout(4000) })
      if (r.ok) {
        setActiveCam(mode)
        // Bump usbKey so the Pi /video_feed panel reconnects and shows new source
        setTimeout(() => setUsbKey(k => k + 1), 600)
      } else {
        setSwitchErr(`HTTP ${r.status}`)
      }
    } catch (e: any) {
      setSwitchErr(e?.message ?? 'No response from Pi')
    } finally {
      setSwitching(false)
    }
  }

  const acc       = status?.accident
  const accStatus = acc?.status ?? 'NORMAL'

  return (
    <div className="h-full flex flex-col bg-gray-950 overflow-hidden">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <div className="bg-blue-700 p-2 rounded-lg flex-shrink-0">
          <Cpu className="h-4 w-4 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-white">Raspberry Pi 5 — Live View</h1>
          <p className="text-[11px] text-gray-400">
            USB C270 · IP Camera · Hailo-8L NPU · Real-time accident detection
          </p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Pi online/offline */}
          <span className={cn(
            'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium',
            piOnline === true  ? 'bg-green-950/40 text-green-400 border-green-700/40' :
            piOnline === false ? 'bg-red-950/40  text-red-400   border-red-700/40'   :
                                 'bg-gray-800    text-gray-500  border-gray-700',
          )}>
            {piOnline === true  ? <><Wifi    className="h-3 w-3" /> Pi Online</> :
             piOnline === false ? <><WifiOff className="h-3 w-3" /> Pi Offline</> :
                                  <><Activity className="h-3 w-3 animate-pulse" /> Connecting…</>}
          </span>

          {/* Active cam badge */}
          <span className={cn(
            'text-[10px] px-2.5 py-1 rounded-full border font-semibold',
            activeCam === 'usb'
              ? 'bg-blue-950/40 text-blue-400 border-blue-700/40'
              : 'bg-green-950/40 text-green-400 border-green-700/40',
          )}>
            Hailo on: {activeCam === 'usb' ? '📷 USB C270' : '📱 IP Cam'}
          </span>

          {/* Accident status */}
          {acc && (
            <span className={cn('text-xs px-2.5 py-1 rounded-full border font-bold', ACC_BORDER[accStatus])}>
              <span className={ACC_COLOUR[accStatus]}>{accStatus}</span>
            </span>
          )}

          <a href={piBase} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 px-2 py-1 bg-blue-950/30 border border-blue-700/30 rounded-lg transition-colors">
            <ExternalLink className="h-3 w-3" /> Pi Dashboard
          </a>

          <button onClick={() => setShowConfig(c => !c)}
            className={cn('p-2 rounded-lg transition-colors',
              showConfig ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white hover:bg-gray-800')}>
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Config strip ───────────────────────────────────────────── */}
      {showConfig && (
        <div className="flex flex-wrap items-center gap-3 px-5 py-2.5 bg-gray-800/60 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-gray-400 whitespace-nowrap">Pi IP</label>
            <input
              value={piIp}
              onChange={e => { setPiIp(e.target.value); localStorage.setItem('vv_rpi_ip', e.target.value) }}
              placeholder="192.168.1.8"
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white w-36 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-gray-400 whitespace-nowrap">IP Cam URL</label>
            <input
              value={ipCamUrl}
              onChange={e => { setIpCamUrl(e.target.value); localStorage.setItem('vv_ipcam_url', e.target.value) }}
              placeholder="http://192.168.1.9:8081/video"
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white w-60 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-gray-400 whitespace-nowrap">Pi Cam Label</label>
            <input
              value={piCamLabel}
              onChange={e => { setPiCamLabel(e.target.value); localStorage.setItem('vv_picam_label', e.target.value) }}
              placeholder="Pi Camera Feed"
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white w-36 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-gray-400 whitespace-nowrap">IP Cam Label</label>
            <input
              value={ipCamLabel}
              onChange={e => { setIpCamLabel(e.target.value); localStorage.setItem('vv_ipcam_label', e.target.value) }}
              placeholder="IP Camera (Phone)"
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white w-36 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button onClick={fetchStatus}
            className="flex items-center gap-1.5 px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded transition-colors">
            <RefreshCw className="h-3 w-3" /> Reconnect
          </button>
          <p className="text-[10px] text-gray-600">
            Pi: <span className="text-gray-400">{usbStream}</span> &nbsp;|&nbsp;
            IP: <span className="text-gray-400">{ipStream}</span>
          </p>
        </div>
      )}

      {/* ── Switch error ────────────────────────────────────────────── */}
      {switchErr && (
        <div className="px-5 py-1.5 bg-red-950/40 border-b border-red-800/40 text-[11px] text-red-400 flex-shrink-0">
          ⚠ Switch failed: {switchErr} — is the Pi online at {piBase}?
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex min-h-0">

        {/* ── Two camera panels stacked ──────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 p-3 overflow-hidden">

          {/* ── Panel 1: IP Cam — direct stream (always live, shown first) ── */}
          <div className="flex-1 min-h-0">
            <MJPEGPanel
              title={`${ipCamLabel} — direct stream`}
              icon={<Wifi className="h-4 w-4" />}
              badge={activeCam === 'ip' ? '⚡ Hailo Active' : 'IP CAM'}
              badgeColour={activeCam === 'ip' ? 'bg-green-600 text-white' : 'bg-green-900/50 text-green-300'}
              streamUrl={ipStream}
              streamKey={0}
              isActive={activeCam === 'ip'}
              onSwitchClick={piOnline ? () => switchTo('ip') : undefined}
              switchLabel={switching ? 'Switching…' : 'Switch Hailo to IP Cam'}
              note={activeCam === 'usb' && piOnline
                ? 'Direct stream from phone (always live). Click "Switch Hailo to IP Cam" to run Hailo NPU on this feed.'
                : !piOnline
                ? '📡 Pi is offline — this IP cam stream is your live feed. Pi inference will activate when it comes online.'
                : undefined}
            />
          </div>

          {/* ── Panel 2: Pi Camera Feed — Pi annotated MJPEG stream ── */}
          <div className="flex-1 min-h-0">
            <MJPEGPanel
              title={`${piCamLabel} (via Pi · ${piIp})`}
              icon={<Camera className="h-4 w-4" />}
              badge={
                !piOnline      ? 'Pi Offline' :
                activeCam === 'usb' ? '⚡ Hailo Active' : 'Pi Stream'
              }
              badgeColour={
                !piOnline           ? 'bg-red-900/60 text-red-400' :
                activeCam === 'usb' ? 'bg-blue-700 text-white' : 'bg-blue-900/50 text-blue-300'
              }
              streamUrl={usbStream}
              streamKey={usbKey}
              isActive={activeCam === 'usb' && piOnline === true}
              onSwitchClick={piOnline ? () => switchTo('usb') : undefined}
              switchLabel={switching ? 'Switching…' : 'Switch Hailo to Pi Cam'}
              note={
                !piOnline
                  ? `⚠ Pi is offline (${piBase}). Check that the Pi is powered on and connected to the same network. The IP cam above is your live feed.`
                  : activeCam === 'ip'
                  ? '⚡ Hailo NPU is currently processing IP Cam — click "Switch Hailo to Pi Cam" to run inference on this camera instead.'
                  : undefined
              }
            />
          </div>
        </div>

        {/* ── Stats sidebar ─────────────────────────────────────── */}
        <div className="w-68 flex-shrink-0 border-l border-gray-800 flex flex-col overflow-y-auto bg-gray-900/30 p-3 gap-3"
          style={{ width: '268px' }}>

          {/* Switch buttons — prominent at top */}
          <div className="rounded-xl border border-gray-700 bg-gray-900 p-3 space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Crosshair className="h-3 w-3" /> Hailo Camera Switch
            </p>
            <p className="text-[10px] text-gray-600 leading-relaxed">
             Hailo NPU processes <strong className="text-gray-400">one</strong> camera at a time.
             Switching changes which feed gets inference + accident detection.
           </p>
           {!piOnline && (
             <p className="text-[10px] text-red-400 bg-red-950/30 rounded px-2 py-1">
               ⚠ Pi offline — switch buttons disabled until Pi connects
             </p>
           )}
           <div className="grid grid-cols-2 gap-2 pt-1">
             <button
               onClick={() => switchTo('ip')}
               disabled={switching || activeCam === 'ip' || !piOnline}
               className={cn(
                 'flex flex-col items-center gap-1 py-3 rounded-xl text-xs font-bold transition-all border',
                 activeCam === 'ip'
                   ? 'bg-green-700 border-green-500 text-white cursor-default'
                   : !piOnline
                   ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed opacity-50'
                   : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-green-900/40 hover:border-green-700 hover:text-green-300',
                 switching && 'opacity-50',
               )}>
               <Wifi className="h-5 w-5" />
               <span>IP Cam</span>
               {activeCam === 'ip' && <span className="text-[9px] text-green-300 font-normal">● Active</span>}
             </button>
             <button
               onClick={() => switchTo('usb')}
               disabled={switching || activeCam === 'usb' || !piOnline}
                className={cn(
                  'flex flex-col items-center gap-1 py-3 rounded-xl text-xs font-bold transition-all border',
                  activeCam === 'ip'
                    ? 'bg-green-700 border-green-500 text-white cursor-default'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-green-900/40 hover:border-green-700 hover:text-green-300',
                  switching && 'opacity-50',
                )}>
                <Wifi className="h-5 w-5" />
                <span>IP Cam</span>
                {activeCam === 'ip' && <span className="text-[9px] text-green-300 font-normal">● Active</span>}
              </button>
            </div>
            {switching && (
              <p className="text-[10px] text-blue-400 text-center animate-pulse">Switching camera…</p>
            )}
          </div>

          {/* System FPS */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="h-3 w-3" /> System
            </p>
            {([
              { label: 'Camera',    val: status ? `${status.fps.camera} fps`                                                    : '—', ok: (status?.fps.camera ?? 0) > 0 },
              { label: 'Hailo NPU', val: status ? `${status.fps.hailo} fps`                                                     : '—', ok: (status?.fps.hailo ?? 0) > 0 },
              { label: 'Encode',    val: status ? `${status.fps.encode} fps`                                                    : '—', ok: (status?.fps.encode ?? 0) > 0 },
              { label: 'Inference', val: status?.timing?.inf != null ? `${status.timing.inf.toFixed(1)} ms`                     : '—', ok: false },
              { label: 'Pre+Post',  val: (status?.timing?.pre != null && status?.timing?.post != null) ? `${(status.timing.pre + status.timing.post).toFixed(1)} ms` : '—', ok: false },
            ] as const).map(row => (
              <div key={row.label} className="flex justify-between text-xs">
                <span className="text-gray-500">{row.label}</span>
                <span className={cn('font-semibold tabular-nums', row.ok ? 'text-green-400' : 'text-blue-400')}>{row.val}</span>
              </div>
            ))}
          </div>

          {/* Connectivity */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Radio className="h-3 w-3" /> Connectivity
            </p>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">LTE</span>
              <span className={cn('font-semibold', status?.lte?.online ? 'text-green-400' : 'text-red-400')}>
                {status ? (status.lte.online ? 'ONLINE' : 'OFFLINE') : '—'}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">RSSI</span>
              <span className="text-blue-400 font-semibold tabular-nums">
                {status?.lte?.rssi != null ? `${status.lte.rssi} / 31` : '—'}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">GPS</span>
              <span className={cn('font-semibold', status?.gps?.fix ? 'text-green-400' : 'text-red-400')}>
                {status ? (status.gps.fix ? 'FIX ✓' : 'NO FIX') : '—'}
              </span>
            </div>
            {status?.gps?.fix && (
              <a
                href={`https://maps.google.com/?q=${status.gps.lat},${status.gps.lng}`}
                target="_blank" rel="noopener noreferrer"
                className="flex justify-between text-xs text-blue-400 hover:text-blue-300">
                <span className="text-gray-500">Coords</span>
                <span className="font-mono text-[10px]">{status.gps.lat?.toFixed(4)}, {status.gps.lng?.toFixed(4)}</span>
              </a>
            )}
          </div>

          {/* Accident engine */}
          <div className={cn('rounded-xl border p-3 space-y-1.5 transition-colors', ACC_BORDER[accStatus])}>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" /> Accident Engine
            </p>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Status</span>
              <span className={cn('font-bold', ACC_COLOUR[accStatus])}>{accStatus}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Score</span>
              <span className="text-white font-semibold tabular-nums">{acc?.score ?? 0} / 20</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-1">
              <div className={cn('h-1 rounded-full transition-all',
                accStatus === 'ALERT' ? 'bg-red-500' :
                accStatus === 'CONFIRMED' ? 'bg-orange-500' :
                accStatus === 'POSSIBLE' ? 'bg-yellow-500' : 'bg-green-700'
              )} style={{ width: `${Math.min(100, ((acc?.score ?? 0) / 20) * 100)}%` }} />
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Confirm frames</span>
              <span className="text-white font-semibold tabular-nums">{acc?.confirm_count ?? 0}</span>
            </div>
            {acc?.event_id && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Last event</span>
                <span className="text-orange-400 font-mono text-[10px]">{acc.event_id}</span>
              </div>
            )}
            {(acc?.classes?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {acc!.classes.map(c => (
                  <span key={c} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">{c}</span>
                ))}
              </div>
            )}
          </div>

          {/* Live detections */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Eye className="h-3 w-3" /> Live Detections
              {(status?.detections?.length ?? 0) > 0 && (
                <span className="ml-auto text-[10px] text-blue-400">{status!.detections.length}</span>
              )}
            </p>
            {(status?.detections?.length ?? 0) === 0 ? (
              <p className="text-[10px] text-gray-700">none detected</p>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {status!.detections.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    <span className="text-gray-400 flex-1 truncate">{d.class_name}</span>
                    <div className="w-14 h-1 bg-gray-800 rounded-full overflow-hidden flex-shrink-0">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${d.score * 100}%` }} />
                    </div>
                    <span className="text-blue-400 font-mono w-7 text-right flex-shrink-0">{Math.round(d.score * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="h-3 w-3" /> Quick Links
            </p>
            {[
              { label: 'Pi Dashboard (port 5000)',  href: piBase },
              { label: 'Pi /video_feed (live)',      href: usbStream },
              { label: 'Phone IP Cam (direct)',      href: ipStream },
              { label: 'Pi /status (JSON)',          href: `${piBase}/status` },
            ].map(l => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-800/60 hover:bg-gray-700/60 text-xs text-gray-400 hover:text-white transition-colors">
                <ExternalLink className="h-3 w-3 flex-shrink-0 text-gray-600" />
                <span className="truncate">{l.label}</span>
                <ChevronRight className="h-3 w-3 ml-auto text-gray-700 flex-shrink-0" />
              </a>
            ))}
          </div>

        </div>
      </div>
    </div>
  )
}
