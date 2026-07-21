import { useState } from 'react'
import {
  TrendingUp, TrendingDown, AlertTriangle, Flame,
  Shield, ChevronDown, ChevronUp, Activity,
} from 'lucide-react'

// ─── Raw district data (Jan 2026 baseline) ───────────────────────────────────
const DIST_DATA = [
  { name: 'Bengaluru City',   murder: 13, theft: 498, cyber: 213, ndps: 31,  hurt: 446, riots: 48  },
  { name: 'Bengaluru South',  murder: 4,  theft: 130, cyber: 52,  ndps: 11,  hurt: 198, riots: 34  },
  { name: 'Bengaluru Dist',   murder: 6,  theft: 104, cyber: 15,  ndps: 9,   hurt: 172, riots: 24  },
  { name: 'Mysuru City',      murder: 5,  theft: 161, cyber: 48,  ndps: 15,  hurt: 232, riots: 22  },
  { name: 'Belagavi Dist',    murder: 8,  theft: 63,  cyber: 14,  ndps: 23,  hurt: 116, riots: 46  },
  { name: 'Shivamogga',       murder: 4,  theft: 113, cyber: 29,  ndps: 37,  hurt: 173, riots: 18  },
  { name: 'Davanagere',       murder: 2,  theft: 107, cyber: 21,  ndps: 20,  hurt: 152, riots: 34  },
  { name: 'Tumakuru',         murder: 3,  theft: 112, cyber: 17,  ndps: 22,  hurt: 231, riots: 58  },
  { name: 'Ballari',          murder: 6,  theft: 79,  cyber: 13,  ndps: 32,  hurt: 119, riots: 44  },
  { name: 'Raichur',          murder: 2,  theft: 31,  cyber: 0,   ndps: 23,  hurt: 85,  riots: 30  },
  { name: 'Kalaburagi Dist',  murder: 3,  theft: 25,  cyber: 4,   ndps: 20,  hurt: 68,  riots: 13  },
  { name: 'Bidar',            murder: 3,  theft: 39,  cyber: 3,   ndps: 22,  hurt: 72,  riots: 14  },
  { name: 'Vijayapur',        murder: 4,  theft: 44,  cyber: 7,   ndps: 45,  hurt: 86,  riots: 22  },
  { name: 'Bagalkot',         murder: 3,  theft: 42,  cyber: 2,   ndps: 31,  hurt: 121, riots: 48  },
  { name: 'Hubballi-Dharwad', murder: 2,  theft: 87,  cyber: 24,  ndps: 44,  hurt: 147, riots: 38  },
  { name: 'Dharwad',          murder: 1,  theft: 48,  cyber: 6,   ndps: 18,  hurt: 88,  riots: 13  },
  { name: 'Haveri',           murder: 1,  theft: 33,  cyber: 4,   ndps: 32,  hurt: 38,  riots: 11  },
  { name: 'Gadag',            murder: 0,  theft: 28,  cyber: 4,   ndps: 15,  hurt: 48,  riots: 12  },
  { name: 'Hassan',           murder: 2,  theft: 57,  cyber: 10,  ndps: 22,  hurt: 114, riots: 31  },
  { name: 'Chitradurga',      murder: 1,  theft: 50,  cyber: 5,   ndps: 14,  hurt: 110, riots: 29  },
  { name: 'Chikkamagaluru',   murder: 1,  theft: 45,  cyber: 5,   ndps: 19,  hurt: 82,  riots: 17  },
  { name: 'Chickballapura',   murder: 1,  theft: 35,  cyber: 5,   ndps: 10,  hurt: 102, riots: 22  },
  { name: 'Kolar',            murder: 2,  theft: 40,  cyber: 4,   ndps: 8,   hurt: 82,  riots: 18  },
  { name: 'Mandya',           murder: 3,  theft: 53,  cyber: 5,   ndps: 13,  hurt: 124, riots: 24  },
  { name: 'Dakshina Kannada', murder: 2,  theft: 64,  cyber: 13,  ndps: 19,  hurt: 134, riots: 20  },
  { name: 'Mangaluru City',   murder: 0,  theft: 65,  cyber: 19,  ndps: 17,  hurt: 108, riots: 15  },
  { name: 'Udupi',            murder: 0,  theft: 32,  cyber: 10,  ndps: 8,   hurt: 62,  riots: 7   },
  { name: 'Uttara Kannada',   murder: 0,  theft: 30,  cyber: 5,   ndps: 11,  hurt: 55,  riots: 10  },
  { name: 'Koppal',           murder: 1,  theft: 24,  cyber: 2,   ndps: 14,  hurt: 52,  riots: 16  },
  { name: 'Yadgir',           murder: 2,  theft: 21,  cyber: 3,   ndps: 17,  hurt: 41,  riots: 8   },
  { name: 'Vijayanagara',     murder: 3,  theft: 40,  cyber: 5,   ndps: 12,  hurt: 80,  riots: 19  },
  { name: 'K.G.F',            murder: 1,  theft: 28,  cyber: 2,   ndps: 9,   hurt: 52,  riots: 11  },
  { name: 'Mysuru Dist',      murder: 5,  theft: 70,  cyber: 8,   ndps: 20,  hurt: 130, riots: 28  },
  { name: 'Kodagu',           murder: 0,  theft: 24,  cyber: 5,   ndps: 7,   hurt: 44,  riots: 8   },
]

// ─── Jun-vs-Jan trend multipliers (Jun 2026 / Jan 2026 statewide totals) ─────
//   murder: 113/98, theft: 1589/1742, cyber: 921/1259,
//   ndps: 1232/1397, hurt: 1565/1437, riots: 378/319
const TREND = {
  murder: 113 / 98,   // 1.153
  theft:  1589 / 1742, // 0.912
  cyber:  921 / 1259,  // 0.731
  ndps:   1232 / 1397, // 0.882
  hurt:   1565 / 1437, // 1.089
  riots:  378 / 319,   // 1.185
}

// ─── Score formula ─────────────────────────────────────────────────────────────
// score = murder*8 + theft/20 + cyber/15 + ndps*2 + hurt/10 + riots*1.5
function rawScore(d: typeof DIST_DATA[number]): number {
  return (
    d.murder * 8 +
    d.theft  / 20 +
    d.cyber  / 15 +
    d.ndps   * 2 +
    d.hurt   / 10 +
    d.riots  * 1.5
  )
}

function predictedRaw(d: typeof DIST_DATA[number]): number {
  return (
    d.murder * 8   * TREND.murder +
    (d.theft  / 20) * TREND.theft +
    (d.cyber  / 15) * TREND.cyber +
    d.ndps   * 2   * TREND.ndps +
    (d.hurt   / 10) * TREND.hurt +
    d.riots  * 1.5 * TREND.riots
  )
}

// ─── Build enriched rows ───────────────────────────────────────────────────────
const allRaw     = DIST_DATA.map(rawScore)
const allPredRaw = DIST_DATA.map(predictedRaw)
const maxRaw     = Math.max(...allRaw)
const maxPredRaw = Math.max(...allPredRaw)

type RiskLevel = 'High' | 'Medium-High' | 'Medium' | 'Low'

function toNorm(raw: number, max: number): number {
  return Math.round((raw / max) * 100)
}

function riskLevel(score: number): RiskLevel {
  if (score >= 75) return 'High'
  if (score >= 50) return 'Medium-High'
  if (score >= 30) return 'Medium'
  return 'Low'
}

const ROWS = DIST_DATA.map((d, i) => {
  const current   = toNorm(allRaw[i],     maxRaw)
  const predicted = toNorm(allPredRaw[i], maxPredRaw)
  const trendPct  = Math.round(((allPredRaw[i] - allRaw[i]) / allRaw[i]) * 100)
  // mini breakdown: murder weight, ndps weight, hurt weight (as % of total raw)
  const raw   = allRaw[i]
  const mMurder = Math.round((d.murder * 8         / raw) * 100)
  const mNdps   = Math.round((d.ndps   * 2         / raw) * 100)
  const mHurt   = Math.round(((d.hurt  / 10)       / raw) * 100)
  const mOther  = 100 - mMurder - mNdps - mHurt
  return {
    ...d,
    current,
    predicted,
    trendPct,
    level: riskLevel(predicted),
    breakdown: { murder: mMurder, ndps: mNdps, hurt: mHurt, other: Math.max(0, mOther) },
  }
}).sort((a, b) => b.predicted - a.predicted)
  .map((r, i) => ({ ...r, rank: i + 1 }))

// ─── Styling helpers ───────────────────────────────────────────────────────────
const LEVEL_BADGE: Record<RiskLevel, string> = {
  'High':        'bg-red-900/60 text-red-300 border border-red-700',
  'Medium-High': 'bg-orange-900/60 text-orange-300 border border-orange-700',
  'Medium':      'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  'Low':         'bg-green-900/50 text-green-300 border border-green-700',
}

const LEVEL_DOT: Record<RiskLevel, string> = {
  'High':        'bg-red-400',
  'Medium-High': 'bg-orange-400',
  'Medium':      'bg-yellow-400',
  'Low':         'bg-green-400',
}

const LEVEL_FILTER: (RiskLevel | 'All')[] = ['All', 'High', 'Medium-High', 'Medium', 'Low']

type SortKey = 'predicted' | 'name'

export default function HotspotPage() {
  const [filter, setFilter]   = useState<RiskLevel | 'All'>('All')
  const [sortKey, setSortKey] = useState<SortKey>('predicted')

  const displayed = ROWS
    .filter(r => filter === 'All' || r.level === filter)
    .sort((a, b) =>
      sortKey === 'name'
        ? a.name.localeCompare(b.name)
        : b.predicted - a.predicted
    )

  const top3 = ROWS.slice(0, 3)

  return (
    <div className="p-6 space-y-6 overflow-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="bg-red-600/20 border border-red-700/40 rounded-xl p-2.5">
          <Flame className="h-6 w-6 text-red-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Crime Hotspot Predictor</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            AI-powered risk scoring based on Jan–Jun 2026 trend data
          </p>
        </div>
      </div>

      {/* ── Top 3 Alert Banner ─────────────────────────────────────────────── */}
      <div className="bg-red-950/40 border border-red-800/60 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-red-300 uppercase tracking-wide">
            Top 3 Predicted Hotspots — July 2026
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {top3.map((r, i) => (
            <div
              key={r.name}
              className="bg-gray-900 border border-red-800/50 rounded-xl p-3 flex items-center gap-3"
            >
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-700/30 border border-red-600/50 flex items-center justify-center">
                <span className="text-sm font-bold text-red-300">#{i + 1}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">{r.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full bg-red-500"
                      style={{ width: `${r.predicted}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-red-300 flex-shrink-0">
                    {r.predicted}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Controls row ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Filter buttons */}
        <div className="flex flex-wrap gap-1.5">
          {LEVEL_FILTER.map(lf => (
            <button
              key={lf}
              onClick={() => setFilter(lf)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors font-medium ${
                filter === lf
                  ? lf === 'All'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : lf === 'High'
                    ? 'bg-red-700 border-red-600 text-white'
                    : lf === 'Medium-High'
                    ? 'bg-orange-700 border-orange-600 text-white'
                    : lf === 'Medium'
                    ? 'bg-yellow-700 border-yellow-600 text-white'
                    : 'bg-green-700 border-green-600 text-white'
                  : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
              }`}
            >
              {lf === 'All'
                ? `All (${ROWS.length})`
                : `${lf} (${ROWS.filter(r => r.level === lf).length})`}
            </button>
          ))}
        </div>

        {/* Sort toggle */}
        <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          <Activity className="h-3.5 w-3.5 text-gray-500 ml-1" />
          <button
            onClick={() => setSortKey('predicted')}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
              sortKey === 'predicted'
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Risk Score
          </button>
          <button
            onClick={() => setSortKey('name')}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
              sortKey === 'name'
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            District Name
          </button>
        </div>
      </div>

      {/* ── Main table ─────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[3rem_1fr_7rem_11rem_11rem_5rem_7rem] gap-3 px-4 py-2.5 border-b border-gray-800 bg-gray-950/60">
          <span className="text-xs text-gray-500 font-medium">#</span>
          <span className="text-xs text-gray-500 font-medium">District</span>
          <span className="text-xs text-gray-500 font-medium">Risk Level</span>
          <span className="text-xs text-gray-500 font-medium">Current Score</span>
          <span className="text-xs text-gray-500 font-medium">Predicted (Jul)</span>
          <span className="text-xs text-gray-500 font-medium">Trend</span>
          <span className="text-xs text-gray-500 font-medium">Breakdown</span>
        </div>

        {/* Table rows */}
        <div className="divide-y divide-gray-800/60">
          {displayed.map(r => {
            const isUp = r.trendPct > 0
            const predBarColor = isUp ? 'bg-red-500' : 'bg-green-500'

            return (
              <div
                key={r.name}
                className="grid grid-cols-[3rem_1fr_7rem_11rem_11rem_5rem_7rem] gap-3 px-4 py-3 items-center hover:bg-gray-800/30 transition-colors"
              >
                {/* Rank */}
                <div className="flex items-center justify-center">
                  <span
                    className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
                      r.rank === 1
                        ? 'bg-red-700/40 text-red-300'
                        : r.rank === 2
                        ? 'bg-orange-700/40 text-orange-300'
                        : r.rank === 3
                        ? 'bg-yellow-700/40 text-yellow-300'
                        : 'bg-gray-800 text-gray-400'
                    }`}
                  >
                    {r.rank}
                  </span>
                </div>

                {/* District name */}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{r.name}</p>
                </div>

                {/* Risk level badge */}
                <div>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${LEVEL_BADGE[r.level]}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${LEVEL_DOT[r.level]}`} />
                    {r.level}
                  </span>
                </div>

                {/* Current score bar (blue) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500">Current</span>
                    <span className="text-[10px] font-mono text-blue-300">{r.current}</span>
                  </div>
                  <div className="bg-gray-800 rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-blue-500 transition-all"
                      style={{ width: `${r.current}%` }}
                    />
                  </div>
                </div>

                {/* Predicted score bar (red/green) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500">Predicted</span>
                    <span
                      className={`text-[10px] font-mono ${
                        isUp ? 'text-red-300' : 'text-green-300'
                      }`}
                    >
                      {r.predicted}
                    </span>
                  </div>
                  <div className="bg-gray-800 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${predBarColor}`}
                      style={{ width: `${r.predicted}%` }}
                    />
                  </div>
                </div>

                {/* Trend arrow */}
                <div className="flex items-center gap-1">
                  {isUp ? (
                    <>
                      <TrendingUp className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
                      <span className="text-xs font-mono text-red-400">+{r.trendPct}%</span>
                    </>
                  ) : r.trendPct < 0 ? (
                    <>
                      <TrendingDown className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
                      <span className="text-xs font-mono text-green-400">{r.trendPct}%</span>
                    </>
                  ) : (
                    <>
                      <ChevronUp className="h-3.5 w-3.5 text-gray-500 flex-shrink-0 opacity-0" />
                      <span className="text-xs font-mono text-gray-500">0%</span>
                    </>
                  )}
                </div>

                {/* Mini breakdown bar: murder(red) | ndps(purple) | hurt(orange) | other(gray) */}
                <div className="space-y-1">
                  <div className="flex h-3 rounded-sm overflow-hidden gap-px">
                    {r.breakdown.murder > 0 && (
                      <div
                        className="bg-red-600 h-full"
                        style={{ width: `${r.breakdown.murder}%` }}
                        title={`Murder: ${r.breakdown.murder}%`}
                      />
                    )}
                    {r.breakdown.ndps > 0 && (
                      <div
                        className="bg-purple-600 h-full"
                        style={{ width: `${r.breakdown.ndps}%` }}
                        title={`NDPS: ${r.breakdown.ndps}%`}
                      />
                    )}
                    {r.breakdown.hurt > 0 && (
                      <div
                        className="bg-orange-500 h-full"
                        style={{ width: `${r.breakdown.hurt}%` }}
                        title={`Hurt: ${r.breakdown.hurt}%`}
                      />
                    )}
                    {r.breakdown.other > 0 && (
                      <div
                        className="bg-gray-600 h-full"
                        style={{ width: `${r.breakdown.other}%` }}
                        title={`Other: ${r.breakdown.other}%`}
                      />
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <span className="text-[9px] text-red-400">■ M</span>
                    <span className="text-[9px] text-purple-400">■ N</span>
                    <span className="text-[9px] text-orange-400">■ H</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Legend for breakdown ───────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-400 px-1">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-sm bg-red-600 inline-block" />
          Murder (weight ×8)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-sm bg-purple-600 inline-block" />
          NDPS (weight ×2)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-sm bg-orange-500 inline-block" />
          Hurt (weight ÷10)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-sm bg-gray-600 inline-block" />
          Theft + Cyber + Riots
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-blue-400">
          <ChevronDown className="h-3.5 w-3.5" />
          Current score bar
        </span>
        <span className="flex items-center gap-1.5 text-red-400">
          <ChevronUp className="h-3.5 w-3.5" />
          Predicted score bar (red = rising, green = falling)
        </span>
      </div>

      {/* ── Methodology note ───────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-blue-400 flex-shrink-0" />
          <h3 className="text-sm font-semibold text-white">Scoring Methodology</h3>
        </div>
        <div className="text-xs text-gray-400 leading-relaxed space-y-2">
          <p>
            <span className="text-gray-200 font-medium">Risk Score Formula: </span>
            <code className="bg-gray-800 px-1.5 py-0.5 rounded text-blue-300 font-mono text-[11px]">
              score = murder×8 + theft÷20 + cyber÷15 + ndps×2 + hurt÷10 + riots×1.5
            </code>
          </p>
          <p>
            Raw scores are normalised to a 0–100 scale relative to the highest-scoring
            district. Weights reflect the severity and social impact of each crime category —
            violent crimes (murder) are weighted highest.
          </p>
          <p>
            <span className="text-gray-200 font-medium">Prediction Model: </span>
            Each component is multiplied by its Jun 2026 / Jan 2026 state-level trend
            ratio to project July 2026 risk. Multipliers:{' '}
            <span className="text-red-300">murder ×1.15</span>,{' '}
            <span className="text-green-300">theft ×0.91</span>,{' '}
            <span className="text-green-300">cyber ×0.73</span>,{' '}
            <span className="text-green-300">ndps ×0.88</span>,{' '}
            <span className="text-red-300">hurt ×1.09</span>,{' '}
            <span className="text-red-300">riots ×1.19</span>.
          </p>
          <p>
            <span className="text-gray-200 font-medium">Risk Tiers: </span>
            <span className="text-red-400 font-medium">High</span> ≥ 75 &nbsp;|&nbsp;
            <span className="text-orange-400 font-medium">Medium-High</span> 50–74 &nbsp;|&nbsp;
            <span className="text-yellow-400 font-medium">Medium</span> 30–49 &nbsp;|&nbsp;
            <span className="text-green-400 font-medium">Low</span> &lt; 30
          </p>
        </div>
        <p className="text-[11px] text-gray-600 border-t border-gray-800 pt-3">
          Source: Karnataka State Police — CCTNS Monthly Crime Review (Jan–Jun 2026) &nbsp;|&nbsp; KSP Police Computer Wing &amp; SCRB
        </p>
      </div>
    </div>
  )
}
