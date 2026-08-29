/**
 * NotificationsPage.tsx — Police Alert & Notification Centre
 * VigilanteVanguard — Karnataka State Police
 *
 * Features:
 *  • Severity-tiered notifications (CRITICAL / HIGH / MEDIUM / LOW)
 *  • Exact GPS location with Google Maps embed + what3words
 *  • Nearest police station + phone number + ETA
 *  • Snapshot preview from triggering incident
 *  • Mark as read / acknowledge
 *  • Filter by severity + unread
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bell, MapPin, Shield, Clock, Eye, CheckCircle,
  RefreshCw, AlertTriangle, Siren, Phone, Filter,
  Activity, ChevronRight, Navigation, Volume2, VolumeX, Download,
} from 'lucide-react'
import {
  fetchNotifications, markNotificationRead, markAllNotificationsRead,
  fetchNotificationSummary,
  type PoliceNotification,
} from '@/lib/cctvApi'
import { useCCTVSocket } from '@/hooks/useCCTVSocket'
import { cn } from '@/lib/utils'

// ─── Alert sound (Web Audio API) ────────────────────────────────
function playAlertSound(severity: string) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    // Different tones per severity
    if (severity === 'CRITICAL') {
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.30)
      gain.gain.setValueAtTime(0.4, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.5)
    } else if (severity === 'HIGH') {
      osc.frequency.setValueAtTime(660, ctx.currentTime)
      gain.gain.setValueAtTime(0.25, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.3)
    } else {
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.2)
    }
  } catch { /* Audio API not available */ }
}

// ─── Severity styles ────────────────────────────────────────────
const SEV_STYLE: Record<string, { bg: string; text: string; border: string; ring: string; icon: string }> = {
  CRITICAL: {
    bg:     'bg-red-950/60',
    text:   'text-red-300',
    border: 'border-red-700',
    ring:   'ring-red-500/30',
    icon:   '🚨',
  },
  HIGH: {
    bg:     'bg-orange-950/60',
    text:   'text-orange-300',
    border: 'border-orange-700',
    ring:   'ring-orange-500/20',
    icon:   '⚠️',
  },
  MEDIUM: {
    bg:     'bg-yellow-950/40',
    text:   'text-yellow-300',
    border: 'border-yellow-700/60',
    ring:   'ring-yellow-500/20',
    icon:   '⚡',
  },
  LOW: {
    bg:     'bg-gray-800/60',
    text:   'text-gray-400',
    border: 'border-gray-700',
    ring:   'ring-transparent',
    icon:   '📡',
  },
}
function sevStyle(level: string) { return SEV_STYLE[level] ?? SEV_STYLE.LOW }

function fmtTs(ts: string) {
  try { return new Date(ts).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'medium' }) }
  catch { return ts }
}

// ═══════════════════════════════════════════════════════════════
//  SUMMARY BAR
// ═══════════════════════════════════════════════════════════════

function SummaryBar() {
  const { data } = useQuery({
    queryKey: ['notif-summary'],
    queryFn:  fetchNotificationSummary,
    refetchInterval: 10_000,
  })
  if (!data) return null

  return (
    <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-800 bg-gray-900 flex-shrink-0">
      {/* Unread badge */}
      <div className="flex items-center gap-1.5">
        <Bell className="h-4 w-4 text-gray-400" />
        <span className="text-xs text-white font-bold">{data.unread}</span>
        <span className="text-xs text-gray-500">unread</span>
      </div>
      <span className="text-gray-700">|</span>

      {/* By severity */}
      {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(lvl => {
        const count = data.by_severity[lvl] ?? 0
        if (!count) return null
        const s = sevStyle(lvl)
        return (
          <span key={lvl} className={cn(
            'flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border',
            s.bg, s.text, s.border
          )}>
            {s.icon} {lvl} · {count}
          </span>
        )
      })}

      {data.critical_unread > 0 && (
        <span className="ml-auto flex items-center gap-1.5 text-xs text-red-300
                         bg-red-950/50 border border-red-700 px-3 py-1 rounded-full animate-pulse">
          <Siren className="h-3 w-3" />
          {data.critical_unread} CRITICAL unread — immediate action required
        </span>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  NOTIFICATION DETAIL PANEL
// ═══════════════════════════════════════════════════════════════

function NotificationDetail({
  notif,
  onRead,
}: {
  notif:  PoliceNotification
  onRead: (id: string) => void
}) {
  const s = sevStyle(notif.severity_level)
  const loc = notif.location

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden flex flex-col h-full">
      {/* Severity header */}
      <div className={cn(
        'flex items-center justify-between px-4 py-3 border-b',
        s.bg, s.border
      )} style={{ borderLeftWidth: 4, borderLeftColor: notif.severity_colour }}>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">{s.icon}</span>
            <span className={cn('text-sm font-bold', s.text)}>{notif.severity_level}</span>
            <span className={cn('text-[11px] px-1.5 py-0.5 rounded border font-medium', s.text, s.border)}>
              Score: {notif.severity_score}
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">{notif.severity_desc}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-gray-400">ETA</p>
          <p className={cn('text-lg font-bold', s.text)}>~{notif.response_eta} min</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Title + time */}
        <div>
          <h3 className="text-sm font-bold text-white">{notif.title}</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {notif.notification_id} · {fmtTs(notif.timestamp)}
          </p>
        </div>

        {/* Snapshot */}
        {notif.snapshot && (
          <div className="rounded-lg overflow-hidden border border-gray-700 bg-gray-950">
            <img src={notif.snapshot} alt="incident" className="w-full object-cover"
              style={{ maxHeight: 150 }} />
            <div className="px-3 py-1.5 flex items-center justify-between">
              <span className="text-[10px] text-gray-500">AI Snapshot · Conf {Math.round(notif.confidence * 100)}%</span>
              <a href={`/cctv`} className="text-[10px] text-blue-400 hover:text-blue-300">
                View in CCTV →
              </a>
            </div>
          </div>
        )}

        {/* AI message */}
        <div className="bg-gray-800/60 rounded-lg p-3">
          <p className="text-xs text-gray-300 leading-relaxed">{notif.message}</p>
        </div>

        {/* Location block */}
        <div className="bg-gray-800/60 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-3.5 w-3.5 text-red-400" />
            <span className="text-xs font-semibold text-white">Exact Location</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-gray-500">GPS Coordinates</p>
              <p className="text-[11px] text-white font-mono">
                {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500">District / Zone</p>
              <p className="text-[11px] text-white">{loc.district || '—'} / {loc.zone || '—'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] text-gray-500">Address</p>
              <p className="text-[11px] text-white">{loc.address || 'Unknown'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] text-gray-500">what3words</p>
              <p className="text-[11px] text-blue-300 font-medium">{loc.what3words}</p>
            </div>
          </div>

          {/* Maps link */}
          <a
            href={loc.maps_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-[11px] text-blue-400 hover:text-blue-300 mt-1"
          >
            <Navigation className="h-3 w-3" />
            Open in Google Maps ↗
          </a>
        </div>

        {/* Google Maps iframe embed */}
        <div className="rounded-lg overflow-hidden border border-gray-700">
          <iframe
            title="incident-location"
            src={loc.maps_embed}
            width="100%"
            height="160"
            style={{ border: 0, display: 'block' }}
            loading="lazy"
            allowFullScreen
          />
        </div>

        {/* Assigned station */}
        <div className="bg-gray-800/60 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-xs font-medium text-white">Assigned Station</span>
          </div>
          <p className="text-sm font-bold text-blue-300">{notif.assigned_station}</p>
          {notif.camera_name && (
            <p className="text-[11px] text-gray-400">
              Camera: {notif.camera_name} ({notif.camera_id})
            </p>
          )}
        </div>

        {/* Status */}
        {notif.read && (
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <CheckCircle className="h-3 w-3 text-green-500" />
            Acknowledged by {notif.acknowledged_by} at {notif.acknowledged_at ? fmtTs(notif.acknowledged_at) : '—'}
          </div>
        )}
      </div>

      {/* Actions */}
      {!notif.read && (
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={() => onRead(notif.notification_id)}
            className="w-full flex items-center justify-center gap-2 bg-green-800 hover:bg-green-700
                       text-white text-xs font-semibold py-2.5 rounded-lg transition-colors"
          >
            <CheckCircle className="h-4 w-4" />
            Acknowledge & Mark Read
          </button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  NOTIFICATION ROW
// ═══════════════════════════════════════════════════════════════

function NotificationRow({
  notif,
  selected,
  onClick,
}: {
  notif:    PoliceNotification
  selected: boolean
  onClick:  () => void
}) {
  const s = sevStyle(notif.severity_level)

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 rounded-lg border transition-all',
        !notif.read && 'ring-1',
        selected
          ? 'bg-gray-700 border-blue-500 ring-blue-500/50'
          : cn(
              !notif.read ? cn(s.bg, s.border, s.ring) : 'bg-gray-800/60 border-gray-700',
              'hover:bg-gray-700/80 hover:border-gray-600'
            )
      )}
    >
      {/* Top row */}
      <div className="flex items-start gap-2 mb-1">
        <span className="text-base leading-none mt-0.5">{s.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', s.text, s.border, s.bg)}>
              {notif.severity_level}
            </span>
            {!notif.read && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
            )}
          </div>
          <p className="text-xs font-semibold text-white truncate">{notif.incident_type}</p>
          <p className="text-[11px] text-gray-400 truncate">{notif.location.address || notif.camera_name}</p>
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-gray-600 flex-shrink-0 mt-1" />
      </div>

      {/* Location + ETA */}
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="text-gray-500 flex items-center gap-1">
          <MapPin className="h-2.5 w-2.5" />
          {notif.location.lat.toFixed(4)}, {notif.location.lng.toFixed(4)}
        </span>
        <span className="text-gray-500 flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          ETA ~{notif.response_eta}m
        </span>
      </div>

      {/* Station + time */}
      <div className="flex items-center justify-between gap-2 mt-1 text-[10px]">
        <span className="text-blue-400 flex items-center gap-1 truncate">
          <Shield className="h-2.5 w-2.5 flex-shrink-0" />
          {notif.assigned_station}
        </span>
        <span className="text-gray-600 flex-shrink-0">{fmtTs(notif.timestamp)}</span>
      </div>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════

export default function NotificationsPage() {
  useCCTVSocket()   // keep WS alive so real-time incidents trigger notifications

  const qc = useQueryClient()

  const [filterSeverity,  setFilterSeverity]  = useState('')
  const [filterUnread,    setFilterUnread]     = useState(false)
  const [selected,        setSelected]         = useState<PoliceNotification | null>(null)
  const [soundEnabled,    setSoundEnabled]     = useState(true)
  const prevCountRef      = useRef(0)
  const prevCriticalRef   = useRef(0)

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', filterSeverity, filterUnread],
    queryFn:  () => fetchNotifications({
      severity:    filterSeverity || undefined,
      unread_only: filterUnread || undefined,
      limit:       100,
    }),
    refetchInterval: 5_000,   // poll every 5s for new alerts
  })
  const notifications = data?.notifications ?? []
  const unread        = data?.unread ?? 0

  // Auto-select first critical unread on mount
  useEffect(() => {
    if (!selected && notifications.length > 0) {
      const critical = notifications.find(n => !n.read && n.severity_level === 'CRITICAL')
      if (critical) setSelected(critical)
    }
  }, [notifications.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Play sound on new notifications
  useEffect(() => {
    const total   = notifications.length
    const critical = notifications.filter(n => !n.read && n.severity_level === 'CRITICAL').length
    if (total > prevCountRef.current && soundEnabled) {
      const newest = notifications[0]
      if (newest && !newest.read) {
        playAlertSound(newest.severity_level)
      }
    }
    prevCountRef.current   = total
    prevCriticalRef.current = critical
  }, [notifications.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const readMut = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notif-summary'] })
      if (selected?.notification_id === id) {
        setSelected(s => s ? { ...s, read: true } : null)
      }
    },
  })

  const readAllMut = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notif-summary'] })
    },
  })

  return (
    <div className="h-full flex flex-col bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800
                      bg-gray-900 flex-shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-red-700 p-2 rounded-lg">
            <Bell className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">Police Alert Centre</h1>
            <p className="text-[11px] text-gray-400">
              Real-time incident notifications with severity levels, exact GPS location &amp; nearest station
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Sound toggle */}
          <button
            onClick={() => setSoundEnabled(v => !v)}
            className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors',
              soundEnabled
                ? 'bg-blue-900/40 border-blue-700 text-blue-300 hover:bg-blue-900'
                : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-white'
            )}
            title={soundEnabled ? 'Mute alerts' : 'Unmute alerts'}
          >
            {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>

          {/* Export */}
          <a
            href="/api/v1/cctv/notifications"
            download="notifications.json"
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg
                       bg-gray-800 border border-gray-700 text-gray-400 hover:text-white
                       hover:bg-gray-700 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
          </a>

          {unread > 0 && (
            <button
              onClick={() => readAllMut.mutate()}
              disabled={readAllMut.isPending}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg
                         bg-green-800/40 hover:bg-green-800 border border-green-700
                         text-green-300 transition-colors disabled:opacity-50"
            >
              <CheckCircle className="h-3 w-3" />
              Mark all read ({unread})
            </button>
          )}
          <button
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['notifications'] })
              qc.invalidateQueries({ queryKey: ['notif-summary'] })
            }}
            className="text-gray-500 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <SummaryBar />

      {/* Body */}
      <div className="flex-1 overflow-hidden flex">

        {/* Left: list */}
        <div className="w-96 flex-shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
          {/* Filter bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-900/50 flex-shrink-0">
            <Filter className="h-3 w-3 text-gray-500" />
            <span className="text-[11px] text-gray-500">{notifications.length} notifications</span>
            <select
              value={filterSeverity}
              onChange={e => setFilterSeverity(e.target.value)}
              className="ml-auto bg-gray-800 border border-gray-700 text-xs text-white
                         rounded px-2 py-1 focus:outline-none"
            >
              <option value="">All Severity</option>
              <option value="CRITICAL">🚨 Critical</option>
              <option value="HIGH">⚠️ High</option>
              <option value="MEDIUM">⚡ Medium</option>
              <option value="LOW">📡 Low</option>
            </select>
            <label className="flex items-center gap-1 cursor-pointer text-[11px] text-gray-400">
              <input
                type="checkbox"
                checked={filterUnread}
                onChange={e => setFilterUnread(e.target.checked)}
                className="accent-blue-500 w-3 h-3"
              />
              Unread
            </label>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {isLoading && (
              <div className="flex items-center justify-center h-full text-gray-600">
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />Loading…
              </div>
            )}
            {!isLoading && notifications.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                <Bell className="h-8 w-8 opacity-20" />
                <p className="text-sm">No notifications yet</p>
                <p className="text-xs text-gray-700 text-center">
                  Notifications appear when the AI detects incidents from cameras
                </p>
              </div>
            )}
            {notifications.map(n => (
              <NotificationRow
                key={n.notification_id}
                notif={n}
                selected={selected?.notification_id === n.notification_id}
                onClick={() => setSelected(n)}
              />
            ))}
          </div>
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-hidden flex flex-col p-4">
          {selected ? (
            <NotificationDetail
              notif={selected}
              onRead={(id) => readMut.mutate(id)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-4">
              <div className="rounded-full bg-gray-900 p-6">
                <Bell className="h-12 w-12 opacity-20" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Select a notification</p>
                <p className="text-xs text-gray-700 max-w-sm">
                  Click any notification to see severity details, exact GPS location, Google Maps embed,
                  and dispatch instructions.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[11px] text-left w-full max-w-xs">
                {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(lvl => {
                  const s = sevStyle(lvl)
                  return (
                    <div key={lvl} className={cn('rounded-lg p-2.5 border', s.bg, s.border)}>
                      <span className="text-base">{s.icon}</span>
                      <p className={cn('font-bold mt-1', s.text)}>{lvl}</p>
                      <p className="text-gray-500 text-[10px]">
                        {lvl === 'CRITICAL' ? 'Immediate · 4–8 min ETA'
                          : lvl === 'HIGH'  ? 'Urgent · 8–15 min ETA'
                          : lvl === 'MEDIUM'? 'Assess · 15–30 min'
                          :                   'Monitor · 30–60 min'}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
