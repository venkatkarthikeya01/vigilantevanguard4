import { useState, useRef } from 'react'
import { useLiveFeed } from '@/hooks/useLiveFeed'
import { useDemoStore } from '@/store/demo'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend, PieChart, Pie, Cell
} from 'recharts'
import { TrendingUp, TrendingDown, AlertTriangle, Shield, Users, FileText, Zap, Car, Radio } from 'lucide-react'

// ─── Event type → display config ──────────────────────────────
const TYPE_CONFIG: Record<string, { label: string; badge: string; dot: string }> = {
  FIR_REGISTERED: { label: 'FIR',      badge: 'bg-blue-900/60 border-blue-700',    dot: 'bg-blue-500' },
  BROADCAST:      { label: 'BROADCAST',badge: 'bg-indigo-900/60 border-indigo-700', dot: 'bg-indigo-400' },
  ALERT:          { label: 'ALERT',    badge: 'bg-red-900/60 border-red-700',       dot: 'bg-red-500' },
  DEPLOY:         { label: 'DEPLOY',   badge: 'bg-green-900/60 border-green-700',   dot: 'bg-green-500' },
  MISSING:        { label: 'MISSING',  badge: 'bg-yellow-900/60 border-yellow-700', dot: 'bg-yellow-500' },
  WANTED:         { label: 'WANTED',   badge: 'bg-orange-900/60 border-orange-700', dot: 'bg-orange-500' },
}
const FALLBACK_CFG = { label: 'INFO', badge: 'bg-gray-800 border-gray-600', dot: 'bg-gray-500' }

function getTypeCfg(type: string) {
  return TYPE_CONFIG[type] ?? FALLBACK_CFG
}

function eventText(evt: { type: string; payload: Record<string,unknown>; stationName?: string }) {
  const p = evt.payload as any
  const station = evt.stationName ? ` · ${evt.stationName}` : (p.station ? ` · ${p.station}` : '')
  if (evt.type === 'FIR_REGISTERED') {
    const crimeNo = p.crime_no ? `#${p.crime_no}` : ''
    const facts   = p.brief_facts ? ` — ${String(p.brief_facts).slice(0, 55)}` : ''
    return `FIR ${crimeNo} registered${facts}${station}`
  }
  if (evt.type === 'BROADCAST' || evt.type === 'ALERT') {
    return `${p.message ?? ''}${station}`
  }
  if (evt.type === 'MISSING' || evt.type === 'WANTED' || evt.type === 'DEPLOY') {
    return `${p.message ?? ''}${station}`
  }
  return `${p.message ?? p.text ?? evt.type}${station}`
}

function LiveTicker() {
  const { events } = useLiveFeed({ maxEvents: 20 })
  const pulseRef   = useRef(0)
  // Use event count as a proxy for pulse animation trigger
  const pulse = events.length !== pulseRef.current
  if (pulse) pulseRef.current = events.length

  const fmtTime = (ts: string) => {
    const d = new Date(ts)
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }

  const displayed = events.slice(0, 10)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
        <Radio className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-semibold text-white">Live Crime Feed</span>
        <span className="flex items-center gap-1 ml-1">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-bold text-amber-400 tracking-wide">DEMO</span>
        </span>
        <span className="text-xs text-gray-600 mx-1">·</span>
        <span className="text-xs text-gray-500">All zones in sync · Karnataka State</span>
        <span className="ml-auto text-xs text-gray-600 font-mono">
          {displayed.length} event{displayed.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Event rows */}
      <div className="divide-y divide-gray-800/60 max-h-[240px] overflow-y-auto">
        {displayed.length === 0 && (
          <div className="px-5 py-4 text-xs text-gray-600 italic">Initialising event stream…</div>
        )}
        {displayed.map((evt, idx) => {
          const cfg  = getTypeCfg(evt.type)
          const text = eventText(evt)
          const zone = (evt as any).zone ?? (evt.payload as any).zone
          return (
            <div
              key={evt.id}
              className={`flex items-start gap-3 px-5 py-2.5 transition-colors ${idx === 0 ? 'bg-gray-800/50' : 'hover:bg-gray-800/20'}`}
            >
              {/* Type badge */}
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5 ${cfg.badge}`}>
                {cfg.label}
              </span>
              {/* Text */}
              <span className={`text-xs flex-1 leading-snug ${idx === 0 ? 'text-white' : 'text-gray-400'}`}>
                {text}
              </span>
              {/* Zone pill */}
              {zone && (
                <span className="text-[9px] text-gray-600 border border-gray-700 rounded px-1.5 py-0.5 flex-shrink-0 hidden sm:inline">
                  {zone}
                </span>
              )}
              {/* Timestamp */}
              <span className="text-[10px] text-gray-600 font-mono flex-shrink-0 mt-0.5">
                {fmtTime(evt.ts)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Real KSP data from all 6 PDFs ────────────────────────────
const MONTHLY = [
  { month: 'Jan', murder: 98,  dacoity: 6,  robbery: 92,  theft: 1742, cyber: 1259, ndps: 1397, pocso: 316, scst: 223, hurt: 1437, riots: 319, rape: 45,  mvTheft: 767,  ecoOff: 470, sll: 5857, burglary: 441 },
  { month: 'Feb', murder: 73,  dacoity: 14, robbery: 86,  theft: 1637, cyber: 1028, ndps: 980,  pocso: 341, scst: 203, hurt: 1418, riots: 268, rape: 41,  mvTheft: 683,  ecoOff: 633, sll: 5304, burglary: 380 },
  { month: 'Mar', murder: 104, dacoity: 18, robbery: 102, theft: 1713, cyber: 1013, ndps: 1017, pocso: 368, scst: 225, hurt: 1784, riots: 332, rape: 48,  mvTheft: 755,  ecoOff: 494, sll: 6726, burglary: 345 },
  { month: 'Apr', murder: 78,  dacoity: 7,  robbery: 82,  theft: 1694, cyber: 928,  ndps: 940,  pocso: 394, scst: 237, hurt: 1756, riots: 342, rape: 56,  mvTheft: 804,  ecoOff: 546, sll: 5395, burglary: 397 },
  { month: 'May', murder: 94,  dacoity: 15, robbery: 101, theft: 1740, cyber: 947,  ndps: 813,  pocso: 406, scst: 232, hurt: 1710, riots: 383, rape: 57,  mvTheft: 761,  ecoOff: 542, sll: 5563, burglary: 381 },
  { month: 'Jun', murder: 113, dacoity: 16, robbery: 94,  theft: 1589, cyber: 921,  ndps: 1232, pocso: 374, scst: 240, hurt: 1565, riots: 378, rape: 63,  mvTheft: 706,  ecoOff: 543, sll: 5996, burglary: 335 },
]

// Murder motives per month from PDF pages 18-19
const MURDER_MOTIVES: Record<string, { motive: string; cases: number; color: string }[]> = {
  jan: [
    { motive: 'Other Causes',     cases: 76, color: '#f97316' },
    { motive: 'Sudden Quarrel',   cases: 48, color: '#ef4444' },
    { motive: 'Revenge/Enemity',  cases: 15, color: '#eab308' },
    { motive: 'For Gain',         cases: 5,  color: '#3b82f6' },
    { motive: 'Civil Disputes',   cases: 4,  color: '#22c55e' },
    { motive: 'Rape w/Murder',    cases: 2,  color: '#ec4899' },
    { motive: 'Love Intrigue',    cases: 2,  color: '#06b6d4' },
    { motive: 'Adultery',         cases: 2,  color: '#a855f7' },
  ],
  feb: [
    { motive: 'Other Causes',     cases: 13, color: '#f97316' },
    { motive: 'Civil Disputes',   cases: 7,  color: '#22c55e' },
    { motive: 'For Gain',         cases: 8,  color: '#3b82f6' },
    { motive: 'Sudden Quarrel',   cases: 10, color: '#ef4444' },
    { motive: 'Rape w/Murder',    cases: 4,  color: '#ec4899' },
    { motive: 'Property Dispute', cases: 5,  color: '#a855f7' },
    { motive: 'Revenge/Enemity',  cases: 1,  color: '#eab308' },
  ],
  mar: [
    { motive: 'Other Causes',     cases: 21, color: '#f97316' },
    { motive: 'Sudden Quarrel',   cases: 17, color: '#ef4444' },
    { motive: 'Civil Disputes',   cases: 11, color: '#22c55e' },
    { motive: 'Adultery',         cases: 5,  color: '#a855f7' },
    { motive: 'Rape w/Murder',    cases: 5,  color: '#ec4899' },
    { motive: 'Revenge/Enemity',  cases: 5,  color: '#eab308' },
    { motive: 'Love Intrigue',    cases: 4,  color: '#06b6d4' },
    { motive: 'For Gain',         cases: 1,  color: '#3b82f6' },
  ],
  apr: [
    { motive: 'Other Causes',     cases: 50, color: '#f97316' },
    { motive: 'Sudden Quarrel',   cases: 25, color: '#ef4444' },
    { motive: 'Civil Disputes',   cases: 16, color: '#22c55e' },
    { motive: 'Revenge/Enemity',  cases: 10, color: '#eab308' },
    { motive: 'Love Intrigue',    cases: 5,  color: '#06b6d4' },
    { motive: 'For Gain',         cases: 1,  color: '#3b82f6' },
    { motive: 'Property Dispute', cases: 6,  color: '#a855f7' },
  ],
  may: [
    { motive: 'Other Causes',     cases: 63, color: '#f97316' },
    { motive: 'Sudden Quarrel',   cases: 33, color: '#ef4444' },
    { motive: 'Civil Disputes',   cases: 22, color: '#22c55e' },
    { motive: 'Revenge/Enemity',  cases: 18, color: '#eab308' },
    { motive: 'Rape w/Murder',    cases: 5,  color: '#ec4899' },
    { motive: 'Love Intrigue',    cases: 5,  color: '#06b6d4' },
    { motive: 'Property Dispute', cases: 6,  color: '#a855f7' },
    { motive: 'For Gain',         cases: 3,  color: '#3b82f6' },
  ],
  jun: [
    { motive: 'Other Causes',     cases: 76, color: '#f97316' },
    { motive: 'Sudden Quarrel',   cases: 46, color: '#ef4444' },
    { motive: 'Civil Disputes',   cases: 29, color: '#22c55e' },
    { motive: 'Revenge/Enemity',  cases: 25, color: '#eab308' },
    { motive: 'Adultery',         cases: 10, color: '#a855f7' },
    { motive: 'For Gain',         cases: 6,  color: '#3b82f6' },
    { motive: 'Love Intrigue',    cases: 8,  color: '#06b6d4' },
    { motive: 'Rape w/Murder',    cases: 5,  color: '#ec4899' },
  ],
}

// Dacoity locations per month
const DACOITY_LOCATIONS: Record<string, { location: string; cases: number }[]> = {
  jan: [{ location: 'On Highways', cases: 3 }, { location: 'Residential', cases: 1 }, { location: 'Other Roads', cases: 1 }, { location: 'Other Places', cases: 1 }],
  feb: [{ location: 'Other Places', cases: 8 }, { location: 'On Highways', cases: 2 }, { location: 'Residential', cases: 2 }, { location: 'Other Roads', cases: 1 }],
  mar: [{ location: 'In Other Places', cases: 7 }, { location: 'On Highways', cases: 3 }, { location: 'Residential', cases: 3 }, { location: 'Other Roads', cases: 5 }],
  apr: [{ location: 'Residential', cases: 4 }, { location: 'Other Places', cases: 2 }, { location: 'Commercial', cases: 1 }],
  may: [{ location: 'Residential', cases: 6 }, { location: 'Other Places', cases: 4 }, { location: 'On Highways', cases: 2 }, { location: 'Other Roads', cases: 2 }],
  jun: [{ location: 'Other Places', cases: 7 }, { location: 'Residential', cases: 3 }, { location: 'Other Roads', cases: 3 }, { location: 'On Highways', cases: 2 }],
}

// Theft breakdown per month (top 8 categories)
const THEFT_BREAKDOWN: Record<string, { item: string; cases: number; color: string }[]> = {
  jan: [
    { item: 'Two Wheelers', cases: 728, color: '#3b82f6' }, { item: 'Sand',         cases: 173, color: '#f97316' },
    { item: 'House Theft',  cases: 170, color: '#22c55e' }, { item: 'Jewellery',    cases: 103, color: '#ec4899' },
    { item: 'Servant Theft',cases: 56,  color: '#a855f7' }, { item: 'Cattle',       cases: 56,  color: '#eab308' },
    { item: 'Electronics',  cases: 81,  color: '#84cc16' }, { item: 'Cash',         cases: 29,  color: '#06b6d4' },
  ],
  feb: [
    { item: 'Two Wheelers', cases: 648, color: '#3b82f6' }, { item: 'Sand',         cases: 172, color: '#f97316' },
    { item: 'House Theft',  cases: 166, color: '#22c55e' }, { item: 'Jewellery',    cases: 116, color: '#ec4899' },
    { item: 'Electronics',  cases: 70,  color: '#84cc16' }, { item: 'Servant Theft',cases: 54,  color: '#a855f7' },
    { item: 'Cattle',       cases: 40,  color: '#eab308' }, { item: 'Cash',         cases: 37,  color: '#06b6d4' },
  ],
  mar: [
    { item: 'Two Wheelers', cases: 704, color: '#3b82f6' }, { item: 'Sand',         cases: 167, color: '#f97316' },
    { item: 'House Theft',  cases: 176, color: '#22c55e' }, { item: 'Jewellery',    cases: 123, color: '#ec4899' },
    { item: 'Electronics',  cases: 66,  color: '#84cc16' }, { item: 'Cattle',       cases: 60,  color: '#eab308' },
    { item: 'Servant Theft',cases: 46,  color: '#a855f7' }, { item: 'Cash',         cases: 37,  color: '#06b6d4' },
  ],
  apr: [
    { item: 'Two Wheelers', cases: 751, color: '#3b82f6' }, { item: 'Sand',         cases: 139, color: '#f97316' },
    { item: 'House Theft',  cases: 139, color: '#22c55e' }, { item: 'Jewellery',    cases: 139, color: '#ec4899' },
    { item: 'Electronics',  cases: 67,  color: '#84cc16' }, { item: 'Servant Theft',cases: 56,  color: '#a855f7' },
    { item: 'Cash',         cases: 30,  color: '#06b6d4' }, { item: 'Cattle',       cases: 36,  color: '#eab308' },
  ],
  may: [
    { item: 'Two Wheelers', cases: 716, color: '#3b82f6' }, { item: 'Sand',         cases: 186, color: '#f97316' },
    { item: 'House Theft',  cases: 170, color: '#22c55e' }, { item: 'Jewellery',    cases: 133, color: '#ec4899' },
    { item: 'Electronics',  cases: 70,  color: '#84cc16' }, { item: 'Cattle',       cases: 52,  color: '#eab308' },
    { item: 'Servant Theft',cases: 37,  color: '#a855f7' }, { item: 'Cash',         cases: 37,  color: '#06b6d4' },
  ],
  jun: [
    { item: 'Two Wheelers', cases: 671, color: '#3b82f6' }, { item: 'House Theft',  cases: 156, color: '#22c55e' },
    { item: 'Sand',         cases: 137, color: '#f97316' }, { item: 'Jewellery',    cases: 99,  color: '#ec4899' },
    { item: 'Electronics',  cases: 74,  color: '#84cc16' }, { item: 'Cattle',       cases: 34,  color: '#eab308' },
    { item: 'Servant Theft',cases: 41,  color: '#a855f7' }, { item: 'Cash',         cases: 31,  color: '#06b6d4' },
  ],
}

// Robbery breakdown per month
const ROBBERY_DATA: Record<string, { type: string; cases: number }[]> = {
  jan: [{ type: 'Chain Snatching', cases: 29 }, { type: 'Other Places', cases: 33 }, { type: 'Residential', cases: 9  }, { type: 'Commercial', cases: 10 }, { type: 'Highways', cases: 6  }, { type: 'Attempt', cases: 5  }],
  feb: [{ type: 'Chain Snatching', cases: 33 }, { type: 'Other Places', cases: 39 }, { type: 'Residential', cases: 7  }, { type: 'Commercial', cases: 3  }, { type: 'Highways', cases: 1  }, { type: 'Attempt', cases: 3  }],
  mar: [{ type: 'Chain Snatching', cases: 38 }, { type: 'Other Places', cases: 39 }, { type: 'Residential', cases: 11 }, { type: 'Commercial', cases: 2  }, { type: 'Highways', cases: 7  }, { type: 'Attempt', cases: 6  }],
  apr: [{ type: 'Chain Snatching', cases: 30 }, { type: 'Other Places', cases: 26 }, { type: 'Residential', cases: 7  }, { type: 'Commercial', cases: 4  }, { type: 'Highways', cases: 8  }, { type: 'Attempt', cases: 7  }],
  may: [{ type: 'Chain Snatching', cases: 36 }, { type: 'Other Places', cases: 38 }, { type: 'Residential', cases: 8  }, { type: 'Commercial', cases: 4  }, { type: 'Highways', cases: 9  }, { type: 'Attempt', cases: 5  }],
  jun: [{ type: 'Chain Snatching', cases: 39 }, { type: 'Other Places', cases: 39 }, { type: 'Residential', cases: 6  }, { type: 'Commercial', cases: 2  }, { type: 'Highways', cases: 5  }, { type: 'Attempt', cases: 2  }],
}

// District murder comparison Jan–Jun 2026
const DIST_MURDER = [
  { name: 'Bengaluru City', jan: 13, feb: 15, mar: 17, apr: 5,  may: 13, jun: 9  },
  { name: 'Belagavi Dist',  jan: 8,  feb: 4,  mar: 6,  apr: 15, may: 4,  jun: 4  },
  { name: 'Bengaluru Dist', jan: 6,  feb: 1,  mar: 4,  apr: 3,  may: 2,  jun: 9  },
  { name: 'Ballari',        jan: 6,  feb: 4,  mar: 4,  apr: 3,  may: 2,  jun: 2  },
  { name: 'Mysuru City',    jan: 5,  feb: 1,  mar: 2,  apr: 3,  may: 1,  jun: 5  },
  { name: 'Bengaluru South',jan: 4,  feb: 2,  mar: 3,  apr: 1,  may: 3,  jun: 2  },
  { name: 'Vijayapur',      jan: 4,  feb: 3,  mar: 1,  apr: 1,  may: 2,  jun: 2  },
  { name: 'Shivamogga',     jan: 4,  feb: 2,  mar: 1,  apr: 2,  may: 2,  jun: 1  },
]

// Road accidents Jan 2026 (Fatal & Non-Fatal)
const ROAD_ACC_JAN = [
  { road: 'Other Roads',      fatal: 375, nonFatal: 1243 },
  { road: 'National Hwy',     fatal: 341, nonFatal: 900  },
  { road: 'State Hwy',        fatal: 274, nonFatal: 682  },
  { road: 'Other Places',     fatal: 19,  nonFatal: 41   },
]
// Road accidents Feb 2026
const ROAD_ACC_FEB = [
  { road: 'Other Roads',      fatal: 337, nonFatal: 1229 },
  { road: 'National Hwy',     fatal: 272, nonFatal: 831  },
  { road: 'State Hwy',        fatal: 260, nonFatal: 622  },
  { road: 'Other Places',     fatal: 18,  nonFatal: 24   },
]

const TOOLTIP = {
  contentStyle: { background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12, color: '#f9fafb' },
  labelStyle: { color: '#f9fafb' },
  itemStyle: { color: '#f9fafb' },
}

function KPI({ label, value, sub, trend, color }: { label: string; value: string | number; sub?: string; trend?: 'up' | 'down'; color: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-start justify-between">
        <p className="text-2xl font-bold text-white">{value}</p>
        {trend && (
          <span className={`text-xs flex items-center gap-0.5 mt-1 ${trend === 'up' ? 'text-red-400' : 'text-green-400'}`}>
            {trend === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          </span>
        )}
      </div>
      <p className={`text-xs font-semibold mt-1 ${color}`}>{label}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

const MONTHS = ['jan','feb','mar','apr','may','jun'] as const
type Month = typeof MONTHS[number]
const MONTH_LABELS: Record<Month,string> = { jan:'Jan',feb:'Feb',mar:'Mar',apr:'Apr',may:'May',jun:'Jun' }
const MONTH_COUNTS: Record<Month,number>  = { jan:98,feb:73,mar:104,apr:78,may:94,jun:113 }

export default function DashboardPage() {
  const [activeMonth, setActiveMonth] = useState<Month>('jun')
  const [roadMonth,   setRoadMonth]   = useState<'jan'|'feb'>('jan')

  const motives   = MURDER_MOTIVES[activeMonth]   || MURDER_MOTIVES.jun
  const theftData = THEFT_BREAKDOWN[activeMonth]  || THEFT_BREAKDOWN.jun
  const robbery   = ROBBERY_DATA[activeMonth]     || ROBBERY_DATA.jun
  const dacoity   = DACOITY_LOCATIONS[activeMonth] || DACOITY_LOCATIONS.jun
  const monthTotal= MONTH_COUNTS[activeMonth]
  const roadAcc   = roadMonth === 'jan' ? ROAD_ACC_JAN : ROAD_ACC_FEB
  const maxRobbery= Math.max(...robbery.map(r => r.cases))

  // Hurt 6-month comparison
  const hurtCompare = [
    {label:'Jan',v:1437},{label:'Feb',v:1418},{label:'Mar',v:1784},
    {label:'Apr',v:1756},{label:'May',v:1710},{label:'Jun',v:1565},
  ]

  return (
    <div className="p-6 space-y-6 overflow-auto">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Crime Intelligence Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">Karnataka State Police — CCTNS Data | Jan–Jun 2026 | Source: Police Computer Wing & SCRB</p>
        </div>
        {/* Global Month Selector */}
        <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
          {MONTHS.map(m => (
            <button key={m} onClick={() => setActiveMonth(m)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${activeMonth === m ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              {MONTH_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Row — live from active month */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        <KPI label={`Murder (${MONTH_LABELS[activeMonth]})`}    value={MONTHLY.find(r=>r.month===MONTH_LABELS[activeMonth])?.murder ?? 113}   trend="up"   color="text-red-400" />
        <KPI label={`NDPS (${MONTH_LABELS[activeMonth]})`}      value={(MONTHLY.find(r=>r.month===MONTH_LABELS[activeMonth])?.ndps??1232).toLocaleString()}  trend="up"   color="text-purple-400" />
        <KPI label={`Theft (${MONTH_LABELS[activeMonth]})`}     value={(MONTHLY.find(r=>r.month===MONTH_LABELS[activeMonth])?.theft??1589).toLocaleString()} color="text-yellow-400" />
        <KPI label={`Cyber (${MONTH_LABELS[activeMonth]})`}     value={(MONTHLY.find(r=>r.month===MONTH_LABELS[activeMonth])?.cyber??921).toLocaleString()}  trend="down" color="text-blue-400" />
        <KPI label={`POCSO (${MONTH_LABELS[activeMonth]})`}     value={MONTHLY.find(r=>r.month===MONTH_LABELS[activeMonth])?.pocso??374}  trend="up"   color="text-pink-400" />
        <KPI label={`Hurt (${MONTH_LABELS[activeMonth]})`}      value={(MONTHLY.find(r=>r.month===MONTH_LABELS[activeMonth])?.hurt??1565).toLocaleString()} color="text-orange-400" />
        <KPI label={`SC/ST (${MONTH_LABELS[activeMonth]})`}     value={MONTHLY.find(r=>r.month===MONTH_LABELS[activeMonth])?.scst??240}  trend="up"   color="text-indigo-400" />
        <KPI label="H1 2026 Murder Total" value={560} sub="Jan–Jun 2026" trend="up" color="text-red-400" />
      </div>

      {/* Live ticker */}
      <LiveTicker />

      {/* Row 1: Murder motives + Murder 6-month trend */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Murder — Motive Breakdown</h3>
              <p className="text-xs text-gray-500">{MONTH_LABELS[activeMonth]} 2026 ({monthTotal} total)</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={motives} layout="vertical" margin={{ left: 10 }}>
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis dataKey="motive" type="category" tick={{ fill: '#9ca3af', fontSize: 10 }} width={110} />
              <Tooltip {...TOOLTIP} />
              <Bar dataKey="cases" radius={[0, 4, 4, 0]}>
                {motives.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-1">Murder Cases — Jan to Jun 2026</h3>
          <p className="text-xs text-gray-500 mb-3">Jun highest at 113 · Apr lowest at 78 · Half-year total: 560</p>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={MONTHLY}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} domain={[60, 125]} />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              <Line type="monotone" dataKey="murder"  stroke="#ef4444" strokeWidth={2.5} dot={{ fill: '#ef4444', r: 4 }} name="Murder" />
              <Line type="monotone" dataKey="dacoity" stroke="#f97316" strokeWidth={2}   dot={{ fill: '#f97316', r: 3 }} name="Dacoity" />
              <Line type="monotone" dataKey="rape"    stroke="#ec4899" strokeWidth={2}   dot={{ fill: '#ec4899', r: 3 }} name="Rape" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 2: Theft + Robbery/Dacoity */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-1">Theft — Item Category</h3>
          <p className="text-xs text-gray-500 mb-3">{MONTH_LABELS[activeMonth]} 2026 — Two-wheelers dominant</p>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={theftData} layout="vertical" margin={{ left: 10 }}>
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis dataKey="item" type="category" tick={{ fill: '#9ca3af', fontSize: 10 }} width={90} />
              <Tooltip {...TOOLTIP} />
              <Bar dataKey="cases" radius={[0, 4, 4, 0]}>
                {theftData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-1">Dacoity Locations &amp; Robbery Types</h3>
          <p className="text-xs text-gray-500 mb-3">{MONTH_LABELS[activeMonth]} 2026</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400 mb-2 font-medium">Dacoity by Location</p>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={dacoity} dataKey="cases" nameKey="location" cx="50%" cy="50%" outerRadius={60}>
                    {dacoity.map((_, i) => <Cell key={i} fill={['#ef4444','#f97316','#3b82f6','#22c55e','#a855f7'][i % 5]} />)}
                  </Pie>
                  <Tooltip {...TOOLTIP} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-2 font-medium">Robbery by Type</p>
              {robbery.map(r => (
                <div key={r.type} className="mb-1.5">
                  <div className="flex justify-between text-xs text-gray-400 mb-0.5"><span>{r.type}</span><span className="font-mono text-white">{r.cases}</span></div>
                  <div className="bg-gray-800 rounded-full h-1.5"><div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${(r.cases / maxRobbery) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: District murders + Road accidents */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-1">Murder — Top Districts (Jan–Jun 2026)</h3>
          <p className="text-xs text-gray-500 mb-3">Bengaluru City highest across all months</p>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={DIST_MURDER} layout="vertical" margin={{ left: 10 }}>
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis dataKey="name" type="category" tick={{ fill: '#9ca3af', fontSize: 10 }} width={95} />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
              <Bar dataKey="jan" fill="#ef4444" name="Jan" radius={[0,2,2,0]} stackId="a" />
              <Bar dataKey="mar" fill="#f97316" name="Mar" radius={[0,0,0,0]} stackId="a" />
              <Bar dataKey="jun" fill="#eab308" name="Jun" radius={[0,2,2,0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-semibold text-white">Road Accidents — Fatal &amp; Non-Fatal</h3>
              <p className="text-xs text-gray-500">{roadMonth === 'jan' ? 'Jan: Fatal=1,009 | Non-Fatal=2,866' : 'Feb: Fatal=887 | Non-Fatal=2,706'}</p>
            </div>
            <div className="flex gap-1">
              {(['jan','feb'] as const).map(m=>(
                <button key={m} onClick={()=>setRoadMonth(m)}
                  className={`text-xs px-2.5 py-1 rounded-full ${roadMonth===m?'bg-blue-600 text-white':'bg-gray-800 text-gray-400'}`}>
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={roadAcc}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="road" tick={{ fill: '#9ca3af', fontSize: 9 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              <Bar dataKey="fatal"    fill="#ef4444" name="Fatal"     radius={[3,3,0,0]} />
              <Bar dataKey="nonFatal" fill="#3b82f6" name="Non-Fatal" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 4: Full 6-crime trend + Hurt 6-month */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-1">Multi-Crime Trend — Jan–Jun 2026</h3>
          <p className="text-xs text-gray-500 mb-3">NDPS/Jun spike · POCSO rising · Cyber declining · Rape rising</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={MONTHLY}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
              <Line type="monotone" dataKey="murder"  stroke="#ef4444" strokeWidth={2} dot={{r:3}} name="Murder" />
              <Line type="monotone" dataKey="pocso"   stroke="#a855f7" strokeWidth={2} dot={{r:3}} name="POCSO" />
              <Line type="monotone" dataKey="cyber"   stroke="#06b6d4" strokeWidth={2} dot={{r:3}} name="Cyber" />
              <Line type="monotone" dataKey="rape"    stroke="#ec4899" strokeWidth={2} dot={{r:3}} name="Rape" />
              <Line type="monotone" dataKey="scst"    stroke="#6366f1" strokeWidth={2} dot={{r:3}} name="SC/ST" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Hurt Cases — Jan–Jun 2026</h3>
          <div className="space-y-2">
            {hurtCompare.map(r => (
              <div key={r.label}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-gray-400">{r.label} 2026</span>
                  <span className="text-white font-mono">{r.v.toLocaleString()}</span>
                </div>
                <div className="bg-gray-800 h-2 rounded-full">
                  <div className="bg-yellow-500 h-2 rounded-full" style={{ width: `${(r.v / 1784) * 100}%` }} />
                </div>
              </div>
            ))}
            <div className="pt-3 border-t border-gray-800">
              <p className="text-xs text-gray-400 font-medium mb-2">Breakdown ({MONTH_LABELS[activeMonth]})</p>
              {[
                {l:'Simple Hurt', v:MONTHLY.find(r=>r.month===MONTH_LABELS[activeMonth])?.hurt??1565, c:'bg-blue-500'},
                {l:'Grievous Hurt',v:89,c:'bg-red-500'},
              ].map(r=>(
                <div key={r.l} className="flex justify-between text-xs text-gray-500 py-0.5 border-b border-gray-800/50">
                  <span>{r.l}</span><span className="text-gray-300">{r.v.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-gray-800">
              <p className="text-xs text-gray-400 font-medium mb-1">Molestation (Jan 2026)</p>
              {[{l:'Other Places',v:203},{l:'Public Place',v:184},{l:'Private',v:86}].map(r=>(
                <div key={r.l} className="flex justify-between text-xs text-gray-500 py-0.5 border-b border-gray-800/50">
                  <span>{r.l}</span><span className="text-gray-300">{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Row 5: NDPS + SLL + MV Theft trend */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-1">NDPS · SLL · MV Theft — 6-Month Trend</h3>
          <p className="text-xs text-gray-500 mb-3">NDPS volatile (Jan=1,397→Jun=1,232) · SLL peaks Mar=6,726</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={MONTHLY}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
              <Line type="monotone" dataKey="ndps"    stroke="#a855f7" strokeWidth={2.5} dot={{r:4}} name="NDPS" />
              <Line type="monotone" dataKey="mvTheft" stroke="#f97316" strokeWidth={2}   dot={{r:3}} name="MV Theft" />
              <Line type="monotone" dataKey="riots"   stroke="#22c55e" strokeWidth={2}   dot={{r:3}} name="Riots" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Half-Year Totals (H1 2026)</h3>
          <div className="space-y-2">
            {[
              {l:'Theft',      v:10115, c:'#3b82f6'},
              {l:'Hurt',       v:9670,  c:'#eab308'},
              {l:'NDPS',       v:6349,  c:'#a855f7'},
              {l:'Cyber',      v:6096,  c:'#06b6d4'},
              {l:'MV Theft',   v:4476,  c:'#f97316'},
              {l:'POCSO',      v:2199,  c:'#ec4899'},
              {l:'Murder',     v:560,   c:'#ef4444'},
              {l:'Rape',       v:310,   c:'#f43f5e'},
              {l:'SC/ST',      v:1360,  c:'#6366f1'},
              {l:'Dacoity',    v:76,    c:'#dc2626'},
            ].map(r => (
              <div key={r.l}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-gray-400">{r.l}</span>
                  <span className="text-white font-mono">{r.v.toLocaleString()}</span>
                </div>
                <div className="bg-gray-800 h-1.5 rounded-full">
                  <div className="h-1.5 rounded-full" style={{ width:`${Math.min((r.v/10115)*100,100)}%`, backgroundColor: r.c }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Crime Trend Alerts */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="h-4 w-4 text-yellow-400" />
          <h3 className="text-sm font-semibold text-white">Crime Trend Alerts — Jan to Jun 2026</h3>
          <span className="ml-auto text-xs text-gray-500">Auto-calculated from CCTNS data</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { crime:'Murder',   jan:98,  jun:113, unit:'cases', icon:'🔴', ipc:'Sec 302 IPC / 103 BNS' },
            { crime:'POCSO',    jan:316, jun:374, unit:'cases', icon:'🟣', ipc:'POCSO Act 2012' },
            { crime:'Rape',     jan:45,  jun:63,  unit:'cases', icon:'🔴', ipc:'Sec 64 BNS' },
            { crime:'Riots',    jan:319, jun:378, unit:'cases', icon:'🟠', ipc:'Sec 189 BNS' },
            { crime:'SC/ST',    jan:223, jun:240, unit:'cases', icon:'🔵', ipc:'SC/ST POA Act' },
            { crime:'MV Theft', jan:767, jun:706, unit:'cases', icon:'🟢', ipc:'Sec 303 BNS' },
            { crime:'Cyber',    jan:1259,jun:921, unit:'cases', icon:'🟢', ipc:'IT Act 2000' },
            { crime:'NDPS',     jan:1397,jun:1232,unit:'cases', icon:'🟢', ipc:'NDPS Act 1985' },
          ].map(r => {
            const pct   = Math.round(((r.jun - r.jan) / r.jan) * 100)
            const rising = pct > 0
            return (
              <div key={r.crime} className={`rounded-xl border p-3 ${rising ? 'bg-red-950/20 border-red-800/40' : 'bg-green-950/20 border-green-800/40'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-white flex items-center gap-1">{r.icon} {r.crime}</span>
                  <span className={`text-xs font-bold flex items-center gap-0.5 ${rising ? 'text-red-400' : 'text-green-400'}`}>
                    {rising ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {rising ? '+' : ''}{pct}%
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Jan: <span className="text-white font-mono">{r.jan}</span></span>
                  <span>Jun: <span className="text-white font-mono">{r.jun}</span></span>
                </div>
                <p className="text-xs text-gray-600">{r.ipc}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Intelligence observation cards — updated for Jun 2026 */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Intelligence Observations — H1 2026 Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[
            { icon: '🔴', title: 'Murder at 6-Month Peak', text: 'Jun 2026: 113 murders — highest in H1 2026 and +13% vs Jun 2025 (100). H1 total is 560. Sudden Quarrel and "Other Causes" dominate across all months.', color: 'border-red-800' },
            { icon: '💊', title: 'NDPS +226% YoY', text: 'Jan 2026: 1,397 NDPS cases vs 428 in Jan 2025 — a 226% surge. Jun spiked back to 1,232 after dipping to 813 in May. Synthetic drug network expansion likely.', color: 'border-purple-800' },
            { icon: '🏍️', title: 'Two-Wheeler Theft #1', text: 'Two-wheelers are the #1 stolen item every single month (671–751 cases/month). H1 total: ~4,172 two-wheelers stolen. Commercial areas and night-time are peak risk.', color: 'border-yellow-800' },
            { icon: '📈', title: 'Rape Rising +40% H1', text: 'Rape cases rose from 45 (Jan) to 63 (Jun) — a 40% increase over H1 2026. "Known person" perpetrators consistently highest category. False promise cases (BNS Sec 69) also rising.', color: 'border-pink-800' },
            { icon: '💻', title: 'Cyber Crime Declining', text: 'Cyber crimes fell from 1,259 (Jan) to 921 (Jun) — a 27% reduction. Positive trend, though absolute numbers remain high. Bengaluru City accounts for ~21% of all cyber crimes.', color: 'border-blue-800' },
            { icon: '🚗', title: 'Road Fatalities Critical', text: '1,009 fatal road accidents in Jan 2026. Other Roads (375) exceed National Highways (341). Feb improved to 887 fatal. Sustained enforcement needed on district roads.', color: 'border-orange-800' },
          ].map(s => (
            <div key={s.title} className={`bg-gray-800/50 border rounded-xl p-4 ${s.color}`}>
              <p className="text-base mb-1.5">{s.icon}</p>
              <p className="text-xs font-semibold text-white mb-1.5">{s.title}</p>
              <p className="text-xs text-gray-400 leading-relaxed">{s.text}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-600 text-center pb-2">
        Source: KSP Police Computer Wing &amp; SCRB | CCTNS Monthly Crime Review Jan–Jun 2026 | Deployed on Catalyst Project 54786000000021001
      </p>
    </div>
  )
}
