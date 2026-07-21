import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts'
import { GitCompare } from 'lucide-react'

const TOOLTIP_STYLE = {
  contentStyle: { background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12, color: '#f9fafb' },
  itemStyle: { color: '#f9fafb' },
  labelStyle: { color: '#f9fafb' },
}

// Jan 2026 district stats (from MapPage data)
const DIST_DATA: Record<string, { murder: number; robbery: number; theft: number; cyber: number; ndps: number; pocso: number; scst: number; hurt: number; riots: number }> = {
  'Bengaluru City':    { murder:13, robbery:7,  theft:498, cyber:213, ndps:31,  pocso:85, scst:46, hurt:446, riots:48  },
  'Mysuru City':       { murder:5,  robbery:4,  theft:161, cyber:48,  ndps:15,  pocso:45, scst:14, hurt:232, riots:22  },
  'Belagavi District': { murder:8,  robbery:2,  theft:63,  cyber:14,  ndps:23,  pocso:32, scst:14, hurt:116, riots:46  },
  'Davanagere':        { murder:2,  robbery:0,  theft:107, cyber:21,  ndps:20,  pocso:26, scst:7,  hurt:152, riots:34  },
  'Shivamogga':        { murder:4,  robbery:1,  theft:113, cyber:29,  ndps:37,  pocso:35, scst:5,  hurt:173, riots:18  },
  'Tumakuru':          { murder:3,  robbery:1,  theft:112, cyber:17,  ndps:22,  pocso:34, scst:14, hurt:231, riots:58  },
  'Mangaluru City':    { murder:0,  robbery:1,  theft:65,  cyber:19,  ndps:17,  pocso:24, scst:2,  hurt:108, riots:15  },
  'Hubballi-Dharwad':  { murder:2,  robbery:2,  theft:87,  cyber:24,  ndps:44,  pocso:13, scst:9,  hurt:147, riots:38  },
  'Bagalkot':          { murder:3,  robbery:1,  theft:42,  cyber:2,   ndps:31,  pocso:8,  scst:4,  hurt:121, riots:48  },
  'Raichur':           { murder:2,  robbery:0,  theft:31,  cyber:0,   ndps:23,  pocso:8,  scst:26, hurt:85,  riots:30  },
  'Ballari':           { murder:6,  robbery:3,  theft:79,  cyber:13,  ndps:32,  pocso:31, scst:32, hurt:119, riots:44  },
  'Dharwad':           { murder:1,  robbery:0,  theft:48,  cyber:6,   ndps:18,  pocso:7,  scst:2,  hurt:88,  riots:13  },
  'Haveri':            { murder:1,  robbery:0,  theft:33,  cyber:4,   ndps:32,  pocso:9,  scst:3,  hurt:38,  riots:11  },
  'Hassan':            { murder:2,  robbery:0,  theft:57,  cyber:10,  ndps:22,  pocso:15, scst:10, hurt:114, riots:31  },
  'Bidar':             { murder:3,  robbery:1,  theft:39,  cyber:3,   ndps:22,  pocso:16, scst:22, hurt:72,  riots:14  },
  'Vijayapur':         { murder:4,  robbery:2,  theft:44,  cyber:7,   ndps:45,  pocso:9,  scst:15, hurt:86,  riots:22  },
  'Chitradurga':       { murder:1,  robbery:0,  theft:50,  cyber:5,   ndps:14,  pocso:16, scst:11, hurt:110, riots:29  },
  'Chikkamagaluru':    { murder:1,  robbery:0,  theft:45,  cyber:5,   ndps:19,  pocso:8,  scst:1,  hurt:82,  riots:17  },
  'Chickballapura':    { murder:1,  robbery:0,  theft:35,  cyber:5,   ndps:10,  pocso:12, scst:11, hurt:102, riots:22  },
  'Dakshina Kannada':  { murder:2,  robbery:1,  theft:64,  cyber:13,  ndps:19,  pocso:21, scst:5,  hurt:134, riots:20  },
  'Gadag':             { murder:0,  robbery:0,  theft:28,  cyber:4,   ndps:15,  pocso:6,  scst:3,  hurt:48,  riots:12  },
  'Kolar':             { murder:2,  robbery:0,  theft:40,  cyber:4,   ndps:8,   pocso:12, scst:11, hurt:82,  riots:18  },
  'Koppal':            { murder:1,  robbery:0,  theft:24,  cyber:2,   ndps:14,  pocso:6,  scst:11, hurt:52,  riots:16  },
  'Mandya':            { murder:3,  robbery:1,  theft:53,  cyber:5,   ndps:13,  pocso:14, scst:6,  hurt:124, riots:24  },
  'Udupi':             { murder:0,  robbery:0,  theft:32,  cyber:10,  ndps:8,   pocso:7,  scst:1,  hurt:62,  riots:7   },
  'Yadgir':            { murder:2,  robbery:1,  theft:21,  cyber:3,   ndps:17,  pocso:7,  scst:11, hurt:41,  riots:8   },
  'Kodagu':            { murder:0,  robbery:0,  theft:24,  cyber:5,   ndps:7,   pocso:4,  scst:1,  hurt:44,  riots:8   },
  'Bengaluru South':   { murder:4,  robbery:1,  theft:130, cyber:52,  ndps:11,  pocso:32, scst:7,  hurt:198, riots:34  },
  'Bengaluru District':{ murder:6,  robbery:0,  theft:104, cyber:15,  ndps:9,   pocso:30, scst:11, hurt:172, riots:24  },
  'Kalaburagi Dist':   { murder:3,  robbery:1,  theft:25,  cyber:4,   ndps:20,  pocso:8,  scst:22, hurt:68,  riots:13  },
}

const CRIME_KEYS = ['murder','theft','cyber','ndps','pocso','hurt','riots','robbery','scst'] as const
type CrimeKey = typeof CRIME_KEYS[number]

const COLORS = { A: '#3b82f6', B: '#f97316' }

const DISTRICTS = Object.keys(DIST_DATA).sort()

export default function ComparisonPage() {
  const [distA, setDistA] = useState('Bengaluru City')
  const [distB, setDistB] = useState('Mysuru City')

  const dA = DIST_DATA[distA] ?? {}
  const dB = DIST_DATA[distB] ?? {}

  // Bar chart data — each crime category side by side
  const barData = CRIME_KEYS.map(k => ({
    crime: k.toUpperCase(),
    [distA]: dA[k as CrimeKey] ?? 0,
    [distB]: dB[k as CrimeKey] ?? 0,
  }))

  // Radar chart data
  const radarData = CRIME_KEYS.map(k => ({
    category: k.charAt(0).toUpperCase() + k.slice(1),
    [distA]: dA[k as CrimeKey] ?? 0,
    [distB]: dB[k as CrimeKey] ?? 0,
  }))

  const totalA = CRIME_KEYS.reduce((s, k) => s + (dA[k as CrimeKey] ?? 0), 0)
  const totalB = CRIME_KEYS.reduce((s, k) => s + (dB[k as CrimeKey] ?? 0), 0)

  // Which district wins (lower = safer) each category
  const wins = CRIME_KEYS.reduce((acc, k) => {
    acc[k] = (dA[k as CrimeKey] ?? 0) < (dB[k as CrimeKey] ?? 0) ? 'A' : (dA[k as CrimeKey] ?? 0) > (dB[k as CrimeKey] ?? 0) ? 'B' : 'tie'
    return acc
  }, {} as Record<string, 'A' | 'B' | 'tie'>)

  const select = (cls: string) =>
    `w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 appearance-none ${cls}`

  return (
    <div className="p-6 space-y-6 overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <GitCompare className="h-6 w-6 text-blue-400" />
        <div>
          <h1 className="text-xl font-bold text-white">District Comparison</h1>
          <p className="text-sm text-gray-400 mt-0.5">Compare crime statistics between any two districts — January 2026</p>
        </div>
      </div>

      {/* District pickers */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-900 border-2 border-blue-600 rounded-2xl p-4">
          <p className="text-xs font-bold text-blue-400 mb-2 uppercase tracking-wide">District A</p>
          <select value={distA} onChange={e => setDistA(e.target.value)} className={select('')}>
            {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <p className="text-2xl font-bold text-white mt-3">{totalA.toLocaleString()}</p>
          <p className="text-xs text-gray-400">Total cases (Jan 2026)</p>
        </div>
        <div className="bg-gray-900 border-2 border-orange-500 rounded-2xl p-4">
          <p className="text-xs font-bold text-orange-400 mb-2 uppercase tracking-wide">District B</p>
          <select value={distB} onChange={e => setDistB(e.target.value)} className={select('')}>
            {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <p className="text-2xl font-bold text-white mt-3">{totalB.toLocaleString()}</p>
          <p className="text-xs text-gray-400">Total cases (Jan 2026)</p>
        </div>
      </div>

      {/* Head-to-head breakdown */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Head-to-Head Breakdown</h3>
        <div className="space-y-2">
          {CRIME_KEYS.map(k => {
            const vA = dA[k as CrimeKey] ?? 0
            const vB = dB[k as CrimeKey] ?? 0
            const max = Math.max(vA, vB, 1)
            const w = wins[k]
            return (
              <div key={k}>
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span className={w === 'A' ? 'text-green-400 font-bold' : ''}>{vA} {w === 'A' && '✓'}</span>
                  <span className="text-gray-500 uppercase font-medium">{k}</span>
                  <span className={w === 'B' ? 'text-green-400 font-bold' : ''}>{w === 'B' && '✓'} {vB}</span>
                </div>
                <div className="flex gap-0.5 h-2">
                  <div className="flex-1 bg-gray-800 rounded-l-full overflow-hidden flex justify-end">
                    <div className="h-full bg-blue-500 rounded-l-full" style={{ width: `${(vA / max) * 100}%` }} />
                  </div>
                  <div className="w-px bg-gray-700" />
                  <div className="flex-1 bg-gray-800 rounded-r-full overflow-hidden">
                    <div className="h-full bg-orange-500 rounded-r-full" style={{ width: `${(vB / max) * 100}%` }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex gap-4 mt-4 text-xs">
          <span className="flex items-center gap-1.5 text-blue-400"><span className="w-3 h-2 rounded-sm bg-blue-500 inline-block" />{distA}</span>
          <span className="flex items-center gap-1.5 text-orange-400"><span className="w-3 h-2 rounded-sm bg-orange-500 inline-block" />{distB}</span>
          <span className="text-gray-500 ml-auto">✓ = lower (safer)</span>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Bar Comparison</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} margin={{ left: -10 }}>
              <XAxis dataKey="crime" tick={{ fill: '#9ca3af', fontSize: 9 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 11 }} />
              <Bar dataKey={distA} fill={COLORS.A} radius={[4,4,0,0]} name={distA} />
              <Bar dataKey={distB} fill={COLORS.B} radius={[4,4,0,0]} name={distB} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Radar Comparison</h3>
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#374151" />
              <PolarAngleAxis dataKey="category" tick={{ fill: '#9ca3af', fontSize: 9 }} />
              <PolarRadiusAxis tick={false} />
              <Radar name={distA} dataKey={distA} stroke={COLORS.A} fill={COLORS.A} fillOpacity={0.3} />
              <Radar name={distB} dataKey={distB} stroke={COLORS.B} fill={COLORS.B} fillOpacity={0.25} />
              <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 11 }} />
              <Tooltip {...TOOLTIP_STYLE} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="text-xs text-gray-600 text-center">Source: KSP CCTNS Monthly Crime Review — January 2026</p>
    </div>
  )
}
