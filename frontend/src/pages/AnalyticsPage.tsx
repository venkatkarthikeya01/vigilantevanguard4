import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  PieChart, Pie, Cell, Legend
} from 'recharts'

const MONTHS = [
  { month: 'Jan 26', murder: 98,  dacoity: 6,  robbery: 92,  chain_snatching: 29, burglary: 441, theft: 1742, riots: 319, hurt: 1437, cyber: 1259, ndps: 1397, pocso: 316, scst: 223 },
  { month: 'Feb 26', murder: 73,  dacoity: 14, robbery: 86,  chain_snatching: 33, burglary: 380, theft: 1637, riots: 268, hurt: 1418, cyber: 1028, ndps: 980,  pocso: 341, scst: 203 },
  { month: 'Mar 26', murder: 104, dacoity: 18, robbery: null, chain_snatching: null, burglary: null, theft: null, riots: null, hurt: null, cyber: null, ndps: null, pocso: null, scst: null },
  { month: 'Apr 26', murder: 78,  dacoity: 7,  robbery: null, chain_snatching: null, burglary: null, theft: null, riots: null, hurt: null, cyber: null, ndps: null, pocso: null, scst: null },
  { month: 'May 26', murder: 94,  dacoity: 15, robbery: null, chain_snatching: null, burglary: null, theft: null, riots: null, hurt: null, cyber: null, ndps: null, pocso: null, scst: null },
  { month: 'Jun 26', murder: 113, dacoity: 16, robbery: null, chain_snatching: null, burglary: null, theft: null, riots: null, hurt: null, cyber: null, ndps: null, pocso: null, scst: null },
]

const JAN_DIST = [
  { name: 'Bengaluru City', theft: 498, murder: 13, cyber: 213 },
  { name: 'Mysuru City', theft: 161, murder: 5, cyber: 48 },
  { name: 'Tumakuru', theft: 112, murder: 3, cyber: 17 },
  { name: 'Shivamogga', theft: 113, murder: 4, cyber: 29 },
  { name: 'Davanagere', theft: 107, murder: 2, cyber: 21 },
  { name: 'Belagavi Dist', theft: 63, murder: 8, cyber: 14 },
  { name: 'Mangaluru', theft: 65, murder: 0, cyber: 19 },
  { name: 'Hubballi', theft: 87, murder: 2, cyber: 24 },
]

const PIE_JAN = [
  { name: 'Spl & Local Laws', value: 5857, color: '#3b82f6' },
  { name: 'Hurt', value: 1437, color: '#f97316' },
  { name: 'Theft', value: 1742, color: '#22c55e' },
  { name: 'NDPS', value: 1397, color: '#a855f7' },
  { name: 'Cyber Crime', value: 1259, color: '#06b6d4' },
  { name: 'POCSO', value: 316, color: '#f43f5e' },
  { name: 'Riots', value: 319, color: '#eab308' },
  { name: 'Other', value: 856, color: '#6b7280' },
]

const RADAR_DATA = [
  { category: 'Murder', jan: 98, feb: 73 },
  { category: 'Dacoity', jan: 6, feb: 14 },
  { category: 'Robbery', jan: 92, feb: 86 },
  { category: 'POCSO', jan: 316, feb: 341 },
  { category: 'SC/ST POA', jan: 223, feb: 203 },
  { category: 'Cyber', jan: 1259, feb: 1028 },
]

const TOOLTIP_STYLE = {
  contentStyle: { background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#f9fafb' },
  labelStyle: { color: '#f9fafb' },
  itemStyle: { color: '#f9fafb' },
}

export default function AnalyticsPage() {
  const [activeMetric, setActiveMetric] = useState<'theft' | 'murder' | 'cyber'>('theft')

  return (
    <div className="p-6 space-y-6 overflow-auto">
      <div>
        <h1 className="text-xl font-bold text-white">Crime Analytics</h1>
        <p className="text-sm text-gray-400 mt-1">
          Karnataka State Police — CCTNS Monthly Crime Review Data (Jan–Jun 2026)
        </p>
      </div>

      {/* Row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Pie — Jan crime distribution */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Crime Distribution — January 2026</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={PIE_JAN} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                {PIE_JAN.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip {...TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Bar — district comparison */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">District Comparison — Jan 2026</h3>
            <div className="flex gap-1">
              {(['theft', 'murder', 'cyber'] as const).map(m => (
                <button key={m} onClick={() => setActiveMetric(m)}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${activeMetric === m ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={JAN_DIST} layout="vertical" margin={{ left: 10 }}>
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis dataKey="name" type="category" tick={{ fill: '#9ca3af', fontSize: 10 }} width={70} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey={activeMetric} fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Murder monthly trend */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Murder & Dacoity Trend — 2026</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={MONTHS}>
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 11 }} />
              <Bar dataKey="murder"  fill="#ef4444" name="Murder"  radius={[4,4,0,0]} />
              <Bar dataKey="dacoity" fill="#f97316" name="Dacoity" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Radar — Jan vs Feb */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Jan vs Feb 2026 — Radar Comparison</h3>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={RADAR_DATA}>
              <PolarGrid stroke="#374151" />
              <PolarAngleAxis dataKey="category" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <PolarRadiusAxis tick={{ fill: '#6b7280', fontSize: 9 }} />
              <Radar name="Jan 2026" dataKey="jan" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
              <Radar name="Feb 2026" dataKey="feb" stroke="#22c55e" fill="#22c55e" fillOpacity={0.2} />
              <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 11 }} />
              <Tooltip {...TOOLTIP_STYLE} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Theft & NDPS trend */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white mb-1">Theft vs NDPS — Jan & Feb 2026</h3>
        <p className="text-xs text-gray-500 mb-4">NDPS surge: Jan 1,397 → Feb 980 (–29.9%); Theft relatively stable</p>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs text-gray-400 mb-2">Theft Cases</p>
            <div className="space-y-2">
              {[{label:'Jan 2026',val:1742,max:1835},{label:'Feb 2026',val:1637,max:1835},{label:'Jan 2025',val:1835,max:1835}].map(r => (
                <div key={r.label}>
                  <div className="flex justify-between text-xs text-gray-400 mb-1"><span>{r.label}</span><span className="font-mono">{r.val.toLocaleString()}</span></div>
                  <div className="bg-gray-800 rounded-full h-2"><div className="bg-green-500 h-2 rounded-full" style={{width:`${(r.val/r.max)*100}%`}} /></div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-2">NDPS Cases</p>
            <div className="space-y-2">
              {[{label:'Jan 2026',val:1397,max:1397},{label:'Feb 2026',val:980,max:1397},{label:'Jan 2025',val:428,max:1397}].map(r => (
                <div key={r.label}>
                  <div className="flex justify-between text-xs text-gray-400 mb-1"><span>{r.label}</span><span className="font-mono">{r.val.toLocaleString()}</span></div>
                  <div className="bg-gray-800 rounded-full h-2"><div className="bg-purple-500 h-2 rounded-full" style={{width:`${(r.val/r.max)*100}%`}} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-600 text-center">
        Source: Karnataka State Police — Police Computer Wing & SCRB | CCTNS Monthly Crime Review
      </p>
    </div>
  )
}
