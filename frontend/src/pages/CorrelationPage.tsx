import { useState } from 'react'

const MONTHLY_DATA = [
  { month: 'Jan', murder: 98,  dacoity: 6,  robbery: 92,  theft: 1742, cyber: 1259, ndps: 1397, pocso: 316, hurt: 1437, riots: 319, rape: 45, mvTheft: 767 },
  { month: 'Feb', murder: 73,  dacoity: 14, robbery: 86,  theft: 1637, cyber: 1028, ndps: 980,  pocso: 341, hurt: 1418, riots: 268, rape: 41, mvTheft: 683 },
  { month: 'Mar', murder: 104, dacoity: 18, robbery: 102, theft: 1713, cyber: 1013, ndps: 1017, pocso: 368, hurt: 1784, riots: 332, rape: 48, mvTheft: 755 },
  { month: 'Apr', murder: 78,  dacoity: 7,  robbery: 82,  theft: 1694, cyber: 928,  ndps: 940,  pocso: 394, hurt: 1756, riots: 342, rape: 56, mvTheft: 804 },
  { month: 'May', murder: 94,  dacoity: 15, robbery: 101, theft: 1740, cyber: 947,  ndps: 813,  pocso: 406, hurt: 1710, riots: 383, rape: 57, mvTheft: 761 },
  { month: 'Jun', murder: 113, dacoity: 16, robbery: 94,  theft: 1589, cyber: 921,  ndps: 1232, pocso: 374, hurt: 1565, riots: 378, rape: 63, mvTheft: 706 },
]

const CRIME_KEYS = ['murder', 'dacoity', 'robbery', 'theft', 'cyber', 'ndps', 'pocso', 'hurt', 'riots', 'rape', 'mvTheft'] as const
type CrimeKey = typeof CRIME_KEYS[number]

const LABELS: Record<CrimeKey, string> = {
  murder:  'Murder',
  dacoity: 'Dacoity',
  robbery: 'Robbery',
  theft:   'Theft',
  cyber:   'Cyber',
  ndps:    'NDPS',
  pocso:   'POCSO',
  hurt:    'Hurt',
  riots:   'Riots',
  rape:    'Rape',
  mvTheft: 'MV Theft',
}

function pearson(a: number[], b: number[]): number {
  const n = a.length
  const meanA = a.reduce((s, v) => s + v, 0) / n
  const meanB = b.reduce((s, v) => s + v, 0) / n
  let num = 0, denomA = 0, denomB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    num    += da * db
    denomA += da * da
    denomB += db * db
  }
  const denom = Math.sqrt(denomA * denomB)
  return denom === 0 ? 0 : num / denom
}

function getSeries(key: CrimeKey): number[] {
  return MONTHLY_DATA.map(d => d[key])
}

// Pre-compute full 11×11 matrix
const MATRIX: Record<CrimeKey, Record<CrimeKey, number>> = {} as never
for (const ka of CRIME_KEYS) {
  MATRIX[ka] = {} as Record<CrimeKey, number>
  for (const kb of CRIME_KEYS) {
    MATRIX[ka][kb] = pearson(getSeries(ka), getSeries(kb))
  }
}

function cellBg(r: number): { bg: string; fg: string } {
  if (r >= 0.8)  return { bg: '#7f1d1d', fg: '#ffffff' }
  if (r >= 0.6)  return { bg: '#dc2626', fg: '#ffffff' }
  if (r >= 0.4)  return { bg: '#f87171', fg: '#111111' }
  if (r >= 0.2)  return { bg: '#fecaca', fg: '#111111' }
  if (r >= -0.2) return { bg: '#1f2937', fg: '#ffffff' }
  if (r >= -0.4) return { bg: '#bfdbfe', fg: '#111111' }
  if (r >= -0.6) return { bg: '#3b82f6', fg: '#ffffff' }
  return                 { bg: '#1e3a8a', fg: '#ffffff' }
}

function strengthLabel(r: number): string {
  const abs = Math.abs(r)
  const dir = r >= 0 ? 'positive' : 'negative'
  if (abs >= 0.7) return `strong ${dir}`
  if (abs >= 0.4) return `moderate ${dir}`
  return 'weak / no correlation'
}

// Collect all unique pairs (i < j) sorted by r descending
interface Pair {
  ka: CrimeKey
  kb: CrimeKey
  r: number
}

const ALL_PAIRS: Pair[] = []
for (let i = 0; i < CRIME_KEYS.length; i++) {
  for (let j = i + 1; j < CRIME_KEYS.length; j++) {
    const ka = CRIME_KEYS[i]
    const kb = CRIME_KEYS[j]
    ALL_PAIRS.push({ ka, kb, r: MATRIX[ka][kb] })
  }
}
ALL_PAIRS.sort((a, b) => b.r - a.r)

const TOP_POSITIVE = ALL_PAIRS.slice(0, 5)
const TOP_NEGATIVE = [...ALL_PAIRS].sort((a, b) => a.r - b.r).slice(0, 3)

function pairInterpretation(ka: CrimeKey, kb: CrimeKey, r: number): string {
  const pair = `${LABELS[ka]} & ${LABELS[kb]}`
  if (r >= 0.7) {
    // Specific interpretations for the strongest correlations found in data
    if ((ka === 'pocso' && kb === 'rape') || (ka === 'rape' && kb === 'pocso'))
      return 'Both crimes against women/children share seasonal and social drivers — investigations should be coordinated.'
    if ((ka === 'pocso' && kb === 'riots') || (ka === 'riots' && kb === 'pocso'))
      return 'Periods of civil unrest correlate with elevated crimes against children, warranting joint prevention strategies.'
    if ((ka === 'hurt' && kb === 'robbery') || (ka === 'robbery' && kb === 'hurt'))
      return 'Physical assaults and robberies track together, suggesting opportunistic violent crime clusters in the same months.'
    if ((ka === 'murder' && kb === 'rape') || (ka === 'rape' && kb === 'murder'))
      return 'Serious violent crimes peak together — surges in one category signal broader law-and-order deterioration.'
    if ((ka === 'riots' && kb === 'rape') || (ka === 'rape' && kb === 'riots'))
      return 'Communal or social unrest months see elevated sexual violence, pointing to a shared environment of disorder.'
    return `${pair} tend to spike in the same months, suggesting shared social or seasonal triggers.`
  }
  if (r <= -0.7) {
    return `${pair} move in opposite directions — when one rises the other tends to fall, possibly reflecting resource-allocation shifts in enforcement.`
  }
  if (r >= 0.4) return `${pair} show a moderate co-movement pattern worth monitoring for joint hotspot analysis.`
  if (r <= -0.4) return `${pair} show a moderate inverse relationship; enforcement focus on one may coincide with reduction in the other.`
  return `${pair} show little consistent relationship across the six-month window.`
}

export default function CorrelationPage() {
  const [hoveredCell, setHoveredCell] = useState<{ ka: CrimeKey; kb: CrimeKey } | null>(null)

  return (
    <div className="min-h-screen bg-gray-950 text-white px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-10">

        {/* ── Header ── */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Crime Pattern Correlation Engine
          </h1>
          <p className="mt-1 text-gray-400 text-sm">
            Pearson correlation matrix — Jan to Jun 2026 (6 months)
          </p>
        </div>

        {/* ── Interpretation Guide ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Colour Legend
          </h2>
          <div className="flex flex-wrap gap-3 text-xs">
            {[
              { bg: '#7f1d1d', fg: '#fff', label: 'Strong positive  (r ≥ 0.7)' },
              { bg: '#f87171', fg: '#111', label: 'Moderate positive (0.4 – 0.7)' },
              { bg: '#1f2937', fg: '#fff', label: 'Weak / none  (−0.4 to 0.4)' },
              { bg: '#bfdbfe', fg: '#111', label: 'Moderate negative (−0.7 to −0.4)' },
              { bg: '#1e3a8a', fg: '#fff', label: 'Strong negative  (r ≤ −0.7)' },
            ].map(({ bg, fg, label }) => (
              <span
                key={label}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md font-medium"
                style={{ backgroundColor: bg, color: fg }}
              >
                {label}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            <span className="text-red-400 font-semibold">Positive correlation</span> means crimes tend to spike together.{' '}
            <span className="text-blue-400 font-semibold">Negative</span> means one rises while the other falls.
          </p>
        </div>

        {/* ── Correlation Matrix ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-base font-semibold text-white mb-4">Correlation Matrix</h2>
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs select-none">
              <thead>
                <tr>
                  {/* top-left blank corner */}
                  <th className="w-20 min-w-[5rem]" />
                  {CRIME_KEYS.map(kb => (
                    <th
                      key={kb}
                      className="px-1 py-2 text-center font-semibold text-gray-300 whitespace-nowrap w-16 min-w-[4rem]"
                    >
                      {LABELS[kb]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CRIME_KEYS.map(ka => (
                  <tr key={ka}>
                    {/* Row header */}
                    <td className="pr-3 py-1 font-semibold text-gray-300 whitespace-nowrap text-right">
                      {LABELS[ka]}
                    </td>
                    {CRIME_KEYS.map(kb => {
                      const r = MATRIX[ka][kb]
                      const isDiag = ka === kb
                      const { bg, fg } = isDiag
                        ? { bg: '#374151', fg: '#9ca3af' }
                        : cellBg(r)
                      const isHovered =
                        hoveredCell?.ka === ka && hoveredCell?.kb === kb
                      const titleText = `${LABELS[ka]} vs ${LABELS[kb]}: r = ${r.toFixed(2)} (${strengthLabel(r)})`
                      return (
                        <td
                          key={kb}
                          title={titleText}
                          onMouseEnter={() => setHoveredCell({ ka, kb })}
                          onMouseLeave={() => setHoveredCell(null)}
                          className="text-center font-mono font-semibold transition-all duration-100 cursor-default"
                          style={{
                            backgroundColor: bg,
                            color: fg,
                            padding: '6px 4px',
                            border: isHovered
                              ? '2px solid #facc15'
                              : '2px solid transparent',
                            borderRadius: '4px',
                            minWidth: '4rem',
                          }}
                        >
                          {r.toFixed(2)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Hover tooltip row */}
          <div className="mt-3 h-6 text-xs text-yellow-300 font-medium">
            {hoveredCell && hoveredCell.ka !== hoveredCell.kb && (
              <span>
                {LABELS[hoveredCell.ka]} vs {LABELS[hoveredCell.kb]}:{' '}
                r = {MATRIX[hoveredCell.ka][hoveredCell.kb].toFixed(2)}{' '}
                ({strengthLabel(MATRIX[hoveredCell.ka][hoveredCell.kb])})
              </span>
            )}
          </div>
        </div>

        {/* ── Top Correlations ── */}
        <div className="grid md:grid-cols-2 gap-6">

          {/* Top 5 Positive */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-red-600" />
              Top 5 Positive Correlations
            </h2>
            <ul className="space-y-3">
              {TOP_POSITIVE.map(({ ka, kb, r }) => (
                <li key={`${ka}-${kb}`} className="border-l-2 border-red-700 pl-3">
                  <p className="text-sm font-semibold text-red-300">
                    {LABELS[ka]} ↔ {LABELS[kb]}:{' '}
                    <span className="font-mono">r = {r.toFixed(2)}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {pairInterpretation(ka, kb, r)}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {/* Top 3 Negative */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-blue-600" />
              Top 3 Negative Correlations
            </h2>
            <ul className="space-y-3">
              {TOP_NEGATIVE.map(({ ka, kb, r }) => (
                <li key={`${ka}-${kb}`} className="border-l-2 border-blue-700 pl-3">
                  <p className="text-sm font-semibold text-blue-300">
                    {LABELS[ka]} ↔ {LABELS[kb]}:{' '}
                    <span className="font-mono">r = {r.toFixed(2)}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {pairInterpretation(ka, kb, r)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── District-level callout ── */}
        <div className="bg-gray-900 border border-indigo-800 rounded-xl p-5 flex items-start gap-3">
          <span className="mt-0.5 text-indigo-400 text-lg">📍</span>
          <p className="text-sm text-gray-300">
            <span className="font-semibold text-indigo-300">District-level correlations</span> available in the{' '}
            <span className="font-semibold text-white">Crime Map</span> — click any district marker to see its
            breakdown and compare local patterns against the state-wide matrix above.
          </p>
        </div>

      </div>
    </div>
  )
}
