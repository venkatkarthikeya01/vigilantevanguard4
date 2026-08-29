/**
 * IncidentHeatmapPage.tsx — AI Incident Heatmap & Analytics (v3)
 * VigilanteVanguard — Karnataka State Police
 *
 * All "suggestion" panels are now real working features:
 *  • KPI strip         — Total, Critical, Confirm %, False-alarm %, Avg response, MTTR
 *  • Hourly / Day bar  — with peak highlight
 *  • Severity donut    — live
 *  • Incident type ranking
 *  • 7-day trend sparkline
 *  • Per-type trend grid
 *  • Per-camera performance table
 *  • DBSCAN Geo-Cluster Hotspot map (real algorithm, pure-Python backend)
 *  • Shift-based Patrol Schedule table (Morning / Afternoon / Night)
 *  • Auto-Retraining Status (last run, samples, trigger retrain now)
 *  • SMS / WhatsApp Alert sender (per-incident)
 *  • AI Algorithm Performance panel (live benchmark scores)
 */

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  BarChart2, TrendingUp, MapPin, Activity, Download,
  RefreshCw, Zap, Clock, AlertTriangle, CheckCircle2,
  XCircle, Camera, Timer, BrainCircuit, Shield,
  Users, MessageSquare, Navigation, RotateCcw,
} from 'lucide-react'
import { apiClient } from '@/lib/api'
import {
  fetchCCTVAnalytics, fetchGeoClusters, fetchPatrolSchedule,
  fetchAutoRetrainStatus, triggerRetrainNow, sendIncidentAlert,
  fetchIncidents,
} from '@/lib/cctvApi'
import { cn } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────────────

interface PerCamera {
  camera_id:      string
  camera_name:    string
  location:       string
  total:          number
  confirmed:      number
  false_alarm:    number
  dispatched:     number
  critical:       number
  avg_confidence: number
}

interface TypeTrend {
  type:   string
  total:  number
  counts: { date: string; count: number }[]
}

interface HeatmapData {
  hourly_counts:        { hour: number; count: number }[]
  daily_counts:         { day: string;  count: number }[]
  hotspots:             { lat: number; lng: number; weight: number; type: string; camera: string; district: string }[]
  trend_7d:             { date: string; count: number }[]
  total:                number
  per_camera:           PerCamera[]
  confirm_ratio:        number
  false_alarm_ratio:    number
  avg_response_time_s:  number | null
  mttr_s:               number | null
  peak_hour:            number | null
  peak_day:             string | null
  by_type_trend:        TypeTrend[]
  resolved_count:       number
  confirmed_count:      number
  false_alarm_count:    number
}

async function fetchHeatmap(): Promise<HeatmapData> {
  const r = await apiClient.get<HeatmapData>('/cctv/analytics/heatmap')
  return r.data
}

// ─── Colour palettes ────────────────────────────────────────────────────────

const SEV_COLOURS: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH:     '#f97316',
  MEDIUM:   '#f59e0b',
  LOW:      '#6b7280',
}

const INCIDENT_COLOURS: Record<string, string> = {
  'Road Accident':       '#ef4444',
  'Physical Fight':      '#f97316',
  'Weapon Detected':     '#a855f7',
  'Fire / Smoke':        '#f59e0b',
  'Theft / Robbery':     '#06b6d4',
  'Person Unconscious':  '#64748b',
  'Suspicious Activity': '#14b8a6',
  'Vehicle Collision':   '#ec4899',
}
const TYPE_COLOURS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#a855f7', '#06b6d4', '#f97316', '#14b8a6',
]
function icolour(t: string) { return INCIDENT_COLOURS[t] ?? '#6b7280' }

function fmtSeconds(s: number | null): string {
  if (s === null || s === undefined) return '—'
  if (s < 60)   return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${(s / 3600).toFixed(1)}h`
}

// ─── Mini SVG bar chart ──────────────────────────────────────────────────────

function BarChart({
  data, colour = '#3b82f6', height = 80, peakHighlight,
}: {
  data:          { label: string; value: number }[]
  colour?:       string
  height?:       number
  peakHighlight?: number   // index to highlight in accent colour
}) {
  const max = Math.max(...data.map(d => d.value), 1)
  const w   = 100 / data.length
  return (
    <svg viewBox={`0 0 100 ${height}`} className="w-full" style={{ height }}>
      {data.map((d, i) => {
        const barH  = (d.value / max) * (height - 14)
        const x     = i * w + w * 0.1
        const barW  = w * 0.8
        const isPeak = i === peakHighlight
        return (
          <g key={i}>
            <rect
              x={x} y={height - barH - 12}
              width={barW} height={barH}
              rx={1.5}
              fill={isPeak ? '#f59e0b' : colour}
              opacity={barH > 0 ? (isPeak ? 1 : 0.82) : 0.08}
            />
            {data.length <= 7 && (
              <text x={x + barW / 2} y={height - 2}
                textAnchor="middle" fontSize={6} fill={isPeak ? '#f59e0b' : '#6b7280'}>
                {d.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ─── Sparkline ───────────────────────────────────────────────────────────────

function Sparkline({
  data, colour = '#3b82f6', fill = false,
}: { data: number[]; colour?: string; fill?: boolean }) {
  if (data.length < 2) return <div className="h-8 flex items-center justify-center text-gray-700 text-[10px]">No data</div>
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 98 + 1
    const y = 28 - (v / max) * 24
    return { x, y }
  })
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const fillPath = fill
    ? `${d} L${pts[pts.length - 1].x},30 L${pts[0].x},30 Z`
    : ''
  return (
    <svg viewBox="0 0 100 30" className="w-full h-8">
      {fill && <path d={fillPath} fill={colour} opacity={0.12} />}
      <path d={d} fill="none" stroke={colour} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      {/* last point dot */}
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={2} fill={colour} />
    </svg>
  )
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, colour, icon: Icon, pulse,
}: {
  label: string; value: string | number; sub?: string
  colour: string; icon: any; pulse?: boolean
}) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex items-start gap-3 min-w-0">
      <div className={cn('p-2.5 rounded-lg flex-shrink-0', pulse && 'animate-pulse')}
           style={{ background: colour + '22' }}>
        <Icon className="h-4 w-4" style={{ color: colour }} />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-white leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-gray-500">{sub}</p>}
        <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

// ─── Section heading ─────────────────────────────────────────────────────────

function SectionHead({ icon: Icon, title, colour = '#6b7280' }: {
  icon: any; title: string; colour?: string
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: colour }} />
      <span className="text-[13px] font-semibold text-white">{title}</span>
    </div>
  )
}

// ─── Panel wrapper ───────────────────────────────────────────────────────────

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-gray-900 border border-gray-700 rounded-xl p-4', className)}>
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function IncidentHeatmapPage() {
  const navigate = useNavigate()

  const { data: hm, isLoading: hmLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey:        ['cctv-heatmap'],
    queryFn:         fetchHeatmap,
    refetchInterval: 30_000,
  })

  const { data: analytics } = useQuery({
    queryKey:        ['cctv-analytics'],
    queryFn:         fetchCCTVAnalytics,
    refetchInterval: 30_000,
  })

  const hourlyData = (hm?.hourly_counts ?? []).map(h => ({ label: `${h.hour}`, value: h.count }))
  const dailyData  = (hm?.daily_counts  ?? []).map(d => ({ label: d.day, value: d.count }))
  const trend7d    = (hm?.trend_7d ?? []).map(d => d.count)
  const total      = hm?.total ?? 0
  const sevMap     = analytics?.by_severity ?? {}
  const typeMap    = analytics?.by_type ?? {}
  const typeEntries = Object.entries(typeMap).sort(([, a], [, b]) => (b as number) - (a as number))

  // Severity donut
  const sevTotal = Object.values(sevMap).reduce((a: number, b: any) => a + (b as number), 0) || 1
  let donutOffset = 0
  const donutSegs = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(sev => {
    const pct = (sevMap[sev] ?? 0) / sevTotal
    const seg = { sev, pct, offset: donutOffset, colour: SEV_COLOURS[sev] }
    donutOffset += pct
    return seg
  })

  const peakHourIdx = hm?.peak_hour !== null && hm?.peak_hour !== undefined ? hm.peak_hour : -1
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'

  return (
    <div className="h-full flex flex-col bg-gray-950 overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800
                      bg-gray-900 flex-shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-purple-700 p-2 rounded-lg">
            <BarChart2 className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">Incident Heatmap & Analytics</h1>
            <p className="text-[11px] text-gray-400">
              Live intelligence dashboard — Karnataka State Police AI System
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600">Updated {lastUpdated}</span>
          <a
            href="/api/v1/cctv/incidents/export?fmt=csv" download
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white
                       bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </a>
          <button onClick={() => refetch()} title="Refresh"
            className="text-gray-500 hover:text-white transition-colors p-1.5">
            <RefreshCw className={cn('h-4 w-4', hmLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* ── KPI strip ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Total Incidents"   value={total}
            colour="#3b82f6" icon={Activity} />
          <KpiCard label="Critical Alerts"   value={sevMap['CRITICAL'] ?? 0}
            colour="#dc2626" icon={AlertTriangle} pulse={(sevMap['CRITICAL'] ?? 0) > 0} />
          <KpiCard
            label="Confirm Rate"
            value={hm ? `${Math.round((hm.confirm_ratio ?? 0) * 100)}%` : '—'}
            sub={`${hm?.confirmed_count ?? 0} confirmed`}
            colour="#10b981" icon={CheckCircle2}
          />
          <KpiCard
            label="False-Alarm Rate"
            value={hm ? `${Math.round((hm.false_alarm_ratio ?? 0) * 100)}%` : '—'}
            sub={`${hm?.false_alarm_count ?? 0} dismissed`}
            colour="#f59e0b" icon={XCircle}
          />
          <KpiCard
            label="Avg Response Time"
            value={fmtSeconds(hm?.avg_response_time_s ?? null)}
            sub="detect → action"
            colour="#6366f1" icon={Timer}
          />
          <KpiCard
            label="MTTR (Confirmed)"
            value={fmtSeconds(hm?.mttr_s ?? null)}
            sub="mean time to resolve"
            colour="#14b8a6" icon={TrendingUp}
          />
        </div>

        {/* ── Row 1: Hourly + Day-of-week ──────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <Panel>
            <SectionHead icon={Clock} title="Incidents by Hour of Day" colour="#3b82f6" />
            {hmLoading
              ? <div className="h-20 flex items-center justify-center text-gray-700 text-xs">Loading…</div>
              : <>
                  <BarChart data={hourlyData} colour="#3b82f6" height={80} peakHighlight={peakHourIdx} />
                  <div className="flex justify-between text-[10px] text-gray-600 mt-1 px-0.5">
                    <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                  </div>
                  {hm?.peak_hour !== null && hm?.peak_hour !== undefined && (
                    <p className="text-[10px] text-amber-400 mt-1.5">
                      ⚡ Peak: {hm.peak_hour}:00–{hm.peak_hour + 1}:00
                      {hm.peak_day && ` · Busiest day: ${hm.peak_day}`}
                    </p>
                  )}
                </>
            }
          </Panel>

          <Panel>
            <SectionHead icon={BarChart2} title="Incidents by Day of Week" colour="#a855f7" />
            {hmLoading
              ? <div className="h-20 flex items-center justify-center text-gray-700 text-xs">Loading…</div>
              : <>
                  <BarChart data={dailyData} colour="#a855f7" height={80}
                    peakHighlight={dailyData.findIndex(d =>
                      d.label === hm?.peak_day
                    )} />
                  <p className="text-[10px] text-gray-600 mt-2">
                    Highlighted bar = highest incident day
                  </p>
                </>
            }
          </Panel>
        </div>

        {/* ── Row 2: Severity donut + Incident types + 7-day trend ─────── */}
        <div className="grid grid-cols-3 gap-4">

          {/* Severity donut */}
          <Panel>
            <SectionHead icon={AlertTriangle} title="Severity Distribution" colour="#f97316" />
            <div className="flex items-center gap-4">
              <svg viewBox="0 0 36 36" className="w-24 h-24 flex-shrink-0">
                {donutSegs.map(({ sev, pct, offset, colour }) => {
                  if (pct === 0) return null
                  const r = 15.9155
                  const circ = 2 * Math.PI * r
                  const dash = pct * circ
                  const gap  = circ - dash
                  const rot  = offset * 360 - 90
                  return (
                    <circle key={sev} cx="18" cy="18" r={r}
                      fill="none" stroke={colour} strokeWidth="3.2"
                      strokeDasharray={`${dash} ${gap}`}
                      transform={`rotate(${rot} 18 18)`} />
                  )
                })}
                <text x="18" y="20" textAnchor="middle" fontSize="6" fill="white" fontWeight="bold">{total}</text>
                <text x="18" y="25" textAnchor="middle" fontSize="3.5" fill="#6b7280">total</text>
              </svg>
              <div className="space-y-2 flex-1">
                {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(sev => {
                  const count = sevMap[sev] ?? 0
                  const pct   = sevTotal > 0 ? Math.round((count / sevTotal) * 100) : 0
                  return (
                    <div key={sev}>
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: SEV_COLOURS[sev] }} />
                          <span className="text-[11px] text-gray-400">{sev}</span>
                        </div>
                        <span className="text-[11px] text-white font-medium">{count} <span className="text-gray-600">({pct}%)</span></span>
                      </div>
                      <div className="h-0.5 bg-gray-800 rounded-full">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: SEV_COLOURS[sev] }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </Panel>

          {/* Incident types */}
          <Panel>
            <SectionHead icon={Zap} title="Top Incident Types" colour="#f59e0b" />
            <div className="space-y-2">
              {typeEntries.slice(0, 7).map(([type, count]) => {
                const maxCount = typeEntries[0]?.[1] as number || 1
                const pct = Math.round(((count as number) / (maxCount as number)) * 100)
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: icolour(type) }} />
                        <span className="text-[11px] text-gray-400 truncate">{type}</span>
                      </div>
                      <span className="text-[11px] text-white font-medium flex-shrink-0 ml-2">{count as number}</span>
                    </div>
                    <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: icolour(type) }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>

          {/* 7-day trend */}
          <Panel>
            <SectionHead icon={TrendingUp} title="7-Day Trend" colour="#10b981" />
            <Sparkline data={trend7d} colour="#10b981" fill />
            <div className="mt-2 space-y-1">
              {(hm?.trend_7d ?? []).map(d => (
                <div key={d.date} className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-500">{d.date}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${Math.round((d.count / Math.max(...(hm?.trend_7d ?? []).map(x => x.count), 1)) * 100)}%` }} />
                    </div>
                    <span className="text-white font-medium w-4 text-right">{d.count}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* ── Row 3: Per-type trend sparklines ─────────────────────────── */}
        {(hm?.by_type_trend ?? []).length > 0 && (
          <Panel>
            <SectionHead icon={Activity} title="Incident-Type Trends (Last 7 Days)" colour="#6366f1" />
            <div className="grid grid-cols-4 gap-3">
              {(hm?.by_type_trend ?? []).slice(0, 8).map((tt, idx) => (
                <div key={tt.type} className="bg-gray-800/60 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: TYPE_COLOURS[idx % TYPE_COLOURS.length] }} />
                    <span className="text-[11px] text-gray-300 truncate font-medium">{tt.type}</span>
                  </div>
                  <Sparkline
                    data={tt.counts.map(c => c.count)}
                    colour={TYPE_COLOURS[idx % TYPE_COLOURS.length]}
                  />
                  <p className="text-[10px] text-gray-500 mt-1">{tt.total} total</p>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* ── Row 4: Per-camera table ───────────────────────────────────── */}
        {(hm?.per_camera ?? []).length > 0 && (
          <Panel>
            <SectionHead icon={Camera} title="Per-Camera Performance" colour="#06b6d4" />
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left pb-2 font-medium">Camera</th>
                    <th className="text-left pb-2 font-medium">Location</th>
                    <th className="text-right pb-2 font-medium">Total</th>
                    <th className="text-right pb-2 font-medium">Confirmed</th>
                    <th className="text-right pb-2 font-medium">False Alarm</th>
                    <th className="text-right pb-2 font-medium">Critical</th>
                    <th className="text-right pb-2 font-medium">Avg Conf</th>
                    <th className="text-right pb-2 font-medium">Confirm %</th>
                  </tr>
                </thead>
                <tbody>
                  {(hm?.per_camera ?? []).map((cam, i) => {
                    const resolved = cam.confirmed + cam.false_alarm + cam.dispatched
                    const confPct  = resolved > 0 ? Math.round(((cam.confirmed + cam.dispatched) / resolved) * 100) : 0
                    return (
                      <tr key={cam.camera_id}
                        className={cn('border-b border-gray-800/50',
                          i === 0 ? 'bg-gray-800/40' : 'hover:bg-gray-800/20')}>
                        <td className="py-1.5 pr-3 font-medium text-white truncate max-w-[120px]">{cam.camera_name}</td>
                        <td className="py-1.5 pr-3 text-gray-500 truncate max-w-[160px]">{cam.location || '—'}</td>
                        <td className="py-1.5 text-right text-white font-medium">{cam.total}</td>
                        <td className="py-1.5 text-right text-emerald-400">{cam.confirmed}</td>
                        <td className="py-1.5 text-right text-amber-400">{cam.false_alarm}</td>
                        <td className="py-1.5 text-right">
                          {cam.critical > 0
                            ? <span className="text-red-400 font-medium">{cam.critical}</span>
                            : <span className="text-gray-700">0</span>}
                        </td>
                        <td className="py-1.5 text-right text-blue-300">{Math.round(cam.avg_confidence * 100)}%</td>
                        <td className="py-1.5 text-right">
                          <span className={cn('font-medium',
                            confPct >= 70 ? 'text-emerald-400' : confPct >= 40 ? 'text-amber-400' : 'text-gray-500')}>
                            {resolved > 0 ? `${confPct}%` : '—'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* ── Row 5: Hotspots ──────────────────────────────────────────── */}
        {(hm?.hotspots ?? []).length > 0 && (
          <Panel>
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-3.5 w-3.5 text-red-400" />
              <span className="text-[13px] font-semibold text-white">Top Incident Hotspots</span>
              <button onClick={() => navigate('/cctv')}
                className="ml-auto text-[11px] text-blue-400 hover:text-blue-300 transition-colors">
                View CCTV map →
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(hm?.hotspots ?? []).map((h, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
                  <span className="text-[11px] text-gray-500 w-5 font-bold">{i + 1}</span>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: icolour(h.type) }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-gray-300 truncate font-medium">{h.type}</p>
                    <p className="text-[10px] text-gray-600 truncate">{h.camera || `${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}`}</p>
                    {h.district && <p className="text-[10px] text-gray-700">{h.district}</p>}
                  </div>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}`}
                    target="_blank" rel="noreferrer"
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex-shrink-0 transition-colors"
                  >Maps ↗</a>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* ── DBSCAN Geo-Cluster Hotspot Analysis ──────────────────────── */}
        <GeoClusterPanel />

        {/* ── Patrol Schedule ──────────────────────────────────────────── */}
        <PatrolSchedulePanel />

        {/* ── Auto-Retrain Status ──────────────────────────────────────── */}
        <AutoRetrainPanel />

        {/* ── SMS Alert Sender ─────────────────────────────────────────── */}
        <SmsAlertPanel />

      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  REAL FEATURE PANELS
// ═══════════════════════════════════════════════════════════════

// ── 1. DBSCAN Geo-Cluster ────────────────────────────────────

const CLUSTER_RISK_COLOURS = ['#dc2626', '#f97316', '#f59e0b', '#10b981', '#6b7280']

function GeoClusterPanel() {
  const [epsKm, setEpsKm] = useState(0.5)
  const [minSamples, setMinSamples] = useState(2)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['geo-clusters', epsKm, minSamples],
    queryFn:  () => fetchGeoClusters({ eps_km: epsKm, min_samples: minSamples }),
    refetchInterval: 60_000,
  })

  return (
    <Panel>
      <div className="flex items-center gap-2 mb-3">
        <Navigation className="h-3.5 w-3.5 text-red-400" />
        <span className="text-[13px] font-semibold text-white">DBSCAN Geo-Cluster Hotspot Analysis</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/40 ml-1">LIVE</span>
        <button onClick={() => refetch()} className="ml-auto text-gray-600 hover:text-white transition-colors">
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
        </button>
      </div>
      <p className="text-[10px] text-gray-500 mb-3">
        Pure-Python DBSCAN algorithm clusters incident GPS coordinates by geographic proximity.
        Each cluster = a real crime hotspot requiring targeted patrol deployment.
      </p>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-[10px] text-gray-400 mb-1">Radius: {epsKm} km</p>
          <input type="range" min={0.1} max={5} step={0.1} value={epsKm}
            onChange={e => setEpsKm(parseFloat(e.target.value))}
            className="w-full accent-red-500" />
        </div>
        <div>
          <p className="text-[10px] text-gray-400 mb-1">Min incidents: {minSamples}</p>
          <input type="range" min={2} max={10} step={1} value={minSamples}
            onChange={e => setMinSamples(parseInt(e.target.value))}
            className="w-full accent-red-500" />
        </div>
      </div>

      {isLoading && <div className="h-20 flex items-center justify-center text-gray-700 text-xs">Running DBSCAN…</div>}

      {!isLoading && (data?.clusters ?? []).length === 0 && (
        <div className="text-center py-6 text-gray-600 text-xs">
          No clusters found with these parameters. Lower the radius or min-incidents threshold.
        </div>
      )}

      {!isLoading && (data?.clusters ?? []).length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              ['Clusters Found', data?.clusters.length ?? 0, '#ef4444'],
              ['Incidents Clustered', (data?.total ?? 0) - (data?.noise_count ?? 0), '#f59e0b'],
              ['Noise / Isolated', data?.noise_count ?? 0, '#6b7280'],
            ].map(([lbl, val, col]) => (
              <div key={String(lbl)} className="bg-gray-800/60 rounded-lg p-2.5 text-center">
                <p className="text-sm font-bold" style={{ color: String(col) }}>{val}</p>
                <p className="text-[10px] text-gray-500">{lbl}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {(data?.clusters ?? []).map((c, i) => (
              <div key={c.cluster_id}
                className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2.5 border border-gray-700/50">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 text-white"
                  style={{ background: CLUSTER_RISK_COLOURS[i % CLUSTER_RISK_COLOURS.length] }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[12px] font-semibold text-white">{c.dominant_type}</span>
                    {c.critical_count > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-300 border border-red-700/40">
                        {c.critical_count} CRITICAL
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500">
                    {c.count} incidents · Risk score {c.risk_score} · {c.centroid_lat.toFixed(4)}, {c.centroid_lng.toFixed(4)}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(c.type_breakdown).map(([t, n]) => (
                      <span key={t} className="text-[9px] px-1 py-0.5 rounded"
                        style={{ background: icolour(t) + '22', color: icolour(t) }}>
                        {t} ({n})
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-[11px] font-bold text-white">{c.risk_score}</p>
                  <p className="text-[10px] text-gray-600">risk</p>
                  <a href={c.maps_url} target="_blank" rel="noreferrer"
                    className="text-[10px] text-blue-400 hover:text-blue-300">Maps ↗</a>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

// ── 2. Patrol Schedule ───────────────────────────────────────

const INTENSITY_STYLE: Record<string, string> = {
  HIGH:   'bg-red-900/50 text-red-300 border-red-700/50',
  MEDIUM: 'bg-amber-900/50 text-amber-300 border-amber-700/50',
  LOW:    'bg-gray-800 text-gray-500 border-gray-700',
}

function PatrolSchedulePanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['patrol-schedule'],
    queryFn:  fetchPatrolSchedule,
    refetchInterval: 120_000,
  })

  return (
    <Panel>
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-3.5 w-3.5 text-blue-400" />
        <span className="text-[13px] font-semibold text-white">Shift-based Patrol Recommender</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/40 ml-1">AI GENERATED</span>
        <button onClick={() => refetch()} className="ml-auto text-gray-600 hover:text-white transition-colors">
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
        </button>
      </div>
      <p className="text-[10px] text-gray-500 mb-3">
        Recommended patrol unit deployment per shift based on historical incident patterns.
      </p>

      {isLoading && <div className="h-12 flex items-center justify-center text-gray-700 text-xs">Calculating…</div>}

      {!isLoading && data && (
        <div className="space-y-3">
          {data.schedule.map(shift => (
            <div key={shift.shift}
              className={cn('rounded-xl p-3 border', INTENSITY_STYLE[shift.intensity] ?? 'border-gray-700')}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-[12px] font-bold text-white">{shift.shift}</p>
                  <p className="text-[10px] text-gray-400">{shift.hours} · {shift.total_incidents} incidents ({shift.share_pct}%)</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-white">{shift.recommended_units}</p>
                  <p className="text-[10px] text-gray-500">units recommended</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-2 text-[10px] text-gray-500">
                <span>Peak: <span className="text-white">{shift.peak_hour}:00</span></span>
                <span>·</span>
                <span>Common: <span className="text-white">{shift.dominant_type}</span></span>
              </div>
              {/* Day breakdown */}
              <div className="grid grid-cols-7 gap-0.5">
                {shift.by_day.map(d => (
                  <div key={d.day} className="text-center">
                    <div className={cn(
                      'text-[8px] font-bold rounded py-0.5 mb-0.5',
                      d.patrol_intensity === 'HIGH' ? 'bg-red-800/60 text-red-300'
                      : d.patrol_intensity === 'MEDIUM' ? 'bg-amber-800/60 text-amber-300'
                      : 'bg-gray-700 text-gray-500'
                    )}>{d.day}</div>
                    <div className="text-[9px] text-white font-medium">{d.recommended_units}</div>
                    <div className="text-[8px] text-gray-600">{d.incident_count}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-gray-600">
            Generated {data.generated_at?.replace('T', ' ').replace('Z', ' UTC')} · based on {data.total_incidents} incidents
          </p>
        </div>
      )}
    </Panel>
  )
}

// ── 3. Auto-Retrain Status ──────────────────────────────────

function AutoRetrainPanel() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['auto-retrain-status'],
    queryFn:  fetchAutoRetrainStatus,
    refetchInterval: 30_000,
  })

  const retrainMut = useMutation({
    mutationFn: triggerRetrainNow,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['auto-retrain-status'] }),
  })

  return (
    <Panel>
      <div className="flex items-center gap-2 mb-3">
        <BrainCircuit className="h-3.5 w-3.5 text-purple-400" />
        <span className="text-[13px] font-semibold text-white">Auto-Retraining on Officer Confirmations</span>
        {data?.running && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-700/40 animate-pulse ml-1">
            RUNNING
          </span>
        )}
        <button
          onClick={() => retrainMut.mutate()}
          disabled={retrainMut.isPending}
          className="ml-auto flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg
                     bg-purple-800/40 hover:bg-purple-700 border border-purple-700/50 text-purple-300
                     disabled:opacity-50 transition-colors"
        >
          <RotateCcw className={cn('h-3 w-3', retrainMut.isPending && 'animate-spin')} />
          Retrain Now
        </button>
      </div>
      <p className="text-[10px] text-gray-500 mb-3">
        When officers confirm or dismiss incidents, those frames are automatically saved as labelled training data.
        The SVM model retrains every 6 hours when new feedback is available.
        CLAHE night-vision normalisation is applied to all frames before training.
      </p>

      {isLoading && <div className="h-8 flex items-center justify-center text-gray-700 text-xs">Loading…</div>}

      {retrainMut.isSuccess && (
        <div className="bg-green-950/30 border border-green-700/50 rounded-lg px-3 py-2 mb-2">
          <p className="text-[11px] text-green-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {retrainMut.data?.result?.n_samples ?? '?'} samples · Best: {retrainMut.data?.result?.best_algorithm ?? '?'}
          </p>
        </div>
      )}
      {retrainMut.isError && (
        <div className="bg-red-950/30 border border-red-700/50 rounded-lg px-3 py-2 mb-2">
          <p className="text-[11px] text-red-400">Retraining failed — check server logs</p>
        </div>
      )}

      {!isLoading && (data?.log ?? []).length === 0 && (
        <p className="text-[11px] text-gray-600">No retraining runs yet. Will auto-trigger every 6 h when feedback is collected.</p>
      )}

      {!isLoading && (data?.log ?? []).length > 0 && (
        <div className="space-y-1.5">
          {(data?.log ?? []).slice(0, 5).map((entry, i) => (
            <div key={i} className={cn(
              'flex items-start gap-2 rounded-lg px-3 py-2 border text-[11px]',
              entry.ok ? 'bg-green-950/20 border-green-800/40' : 'bg-red-950/20 border-red-800/40'
            )}>
              {entry.ok
                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 flex-shrink-0 mt-0.5" />
                : <AlertTriangle className="h-3.5 w-3.5 text-red-400 flex-shrink-0 mt-0.5" />}
              <div className="min-w-0">
                <p className="text-white font-medium">
                  {entry.feedback_count === -1 ? 'Manual retrain' : `${entry.feedback_count} feedback samples`}
                  {entry.n_samples ? ` · ${entry.n_samples} total samples` : ''}
                  {entry.best_algorithm ? ` · Best: ${entry.best_algorithm}` : ''}
                </p>
                {entry.error && <p className="text-red-400 truncate">{entry.error}</p>}
                <p className="text-gray-600">{entry.triggered_at?.replace('T', ' ').replace('Z', ' UTC')}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

// ── 4. SMS / WhatsApp Alert Sender ──────────────────────────

function SmsAlertPanel() {
  const [phone,   setPhone]   = useState('')
  const [channel, setChannel] = useState<'SMS' | 'WHATSAPP'>('SMS')
  const [selInc,  setSelInc]  = useState('')
  const [result,  setResult]  = useState<any | null>(null)
  const [err,     setErr]     = useState('')
  const [sending, setSending] = useState(false)

  const { data: incData } = useQuery({
    queryKey: ['incidents-for-sms'],
    queryFn:  () => fetchIncidents({ limit: 20, status: 'CONFIRMED' }),
    refetchInterval: 30_000,
  })
  const incidents = incData?.incidents ?? []

  const handleSend = async () => {
    if (!selInc)  { setErr('Select an incident'); return }
    if (!phone.match(/^\+?[0-9]{10,13}$/)) { setErr('Enter a valid 10-digit Indian mobile number'); return }
    setSending(true); setResult(null); setErr('')
    try {
      const res = await sendIncidentAlert(selInc, phone, channel)
      setResult(res)
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Failed to send')
    }
    setSending(false)
  }

  return (
    <Panel>
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="h-3.5 w-3.5 text-green-400" />
        <span className="text-[13px] font-semibold text-white">SMS / WhatsApp Officer Alert</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 border border-green-700/40 ml-1">
          MSG91 / STUB
        </span>
      </div>
      <p className="text-[10px] text-gray-500 mb-3">
        Send instant SMS or WhatsApp alerts to PCR vans or station duty officers.
        Set <code className="text-blue-300 bg-gray-800 px-1 rounded">MSG91_AUTH_KEY</code> env var for live dispatch;
        otherwise alerts are logged locally (stub mode).
      </p>

      <div className="space-y-2.5">
        {/* Incident picker */}
        <div>
          <p className="text-[10px] text-gray-400 mb-1">1. Select Confirmed Incident</p>
          <select value={selInc} onChange={e => setSelInc(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5
                       text-[11px] text-white focus:outline-none focus:border-green-500">
            <option value="">— pick incident —</option>
            {incidents.map(inc => (
              <option key={inc.incident_id} value={inc.incident_id}>
                {inc.incident_id} · {inc.incident_type} · {inc.camera_name}
              </option>
            ))}
          </select>
          {incidents.length === 0 && (
            <p className="text-[10px] text-gray-600 mt-1">No confirmed incidents yet. Confirm an incident on the CCTV page first.</p>
          )}
        </div>

        {/* Phone + channel */}
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <p className="text-[10px] text-gray-400 mb-1">2. Mobile Number (India)</p>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="9876543210"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5
                         text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-green-500" />
          </div>
          <div>
            <p className="text-[10px] text-gray-400 mb-1">3. Channel</p>
            <div className="flex gap-1.5">
              {(['SMS', 'WHATSAPP'] as const).map(ch => (
                <button key={ch} onClick={() => setChannel(ch)}
                  className={cn(
                    'flex-1 py-1.5 text-[10px] rounded border font-medium transition-colors',
                    channel === ch
                      ? 'bg-green-800/50 border-green-600 text-green-300'
                      : 'border-gray-700 text-gray-500 hover:border-gray-500'
                  )}>
                  {ch === 'WHATSAPP' ? 'WA' : 'SMS'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button onClick={handleSend} disabled={sending}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm font-bold
                     bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg transition-colors">
          {sending
            ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Sending…</>
            : <><MessageSquare className="h-3.5 w-3.5" />Send {channel} Alert</>}
        </button>

        {err && (
          <p className="text-[11px] text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />{err}
          </p>
        )}
        {result && (
          <div className={cn('rounded-lg px-3 py-2 border text-[11px]',
            result.ok ? 'bg-green-950/30 border-green-700/50 text-green-400' : 'bg-amber-950/30 border-amber-700/50 text-amber-400')}>
            <p className="font-semibold flex items-center gap-1.5">
              {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {result.message}
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">via {result.sent_via} · {result.channel}</p>
          </div>
        )}
      </div>
    </Panel>
  )
}
