import { useState } from 'react'
import {
  FileText,
  Download,
  Printer,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const MONTHLY = [
  { month: 'Jan', murder: 98,  dacoity: 6,  robbery: 92,  theft: 1742, cyber: 1259, ndps: 1397, pocso: 316, hurt: 1437, riots: 319 },
  { month: 'Feb', murder: 73,  dacoity: 14, robbery: 86,  theft: 1637, cyber: 1028, ndps: 980,  pocso: 341, hurt: 1418, riots: 268 },
  { month: 'Mar', murder: 104, dacoity: 18, robbery: 102, theft: 1713, cyber: 1013, ndps: 1017, pocso: 368, hurt: 1784, riots: 332 },
  { month: 'Apr', murder: 78,  dacoity: 7,  robbery: 82,  theft: 1694, cyber: 928,  ndps: 940,  pocso: 394, hurt: 1756, riots: 342 },
  { month: 'May', murder: 94,  dacoity: 15, robbery: 101, theft: 1740, cyber: 947,  ndps: 813,  pocso: 406, hurt: 1710, riots: 383 },
  { month: 'Jun', murder: 113, dacoity: 16, robbery: 94,  theft: 1589, cyber: 921,  ndps: 1232, pocso: 374, hurt: 1565, riots: 378 },
]

type CrimeRow = typeof MONTHLY[number]

const CRIME_LABELS: { key: keyof Omit<CrimeRow, 'month'>; label: string }[] = [
  { key: 'murder',  label: 'Murder (BNS Sec 103)'        },
  { key: 'dacoity', label: 'Dacoity (BNS Sec 310)'       },
  { key: 'robbery', label: 'Robbery (BNS Sec 309)'       },
  { key: 'theft',   label: 'Theft (BNS Sec 303)'         },
  { key: 'cyber',   label: 'Cyber Crime (IT Act 2000)'   },
  { key: 'ndps',    label: 'NDPS Act 1985'               },
  { key: 'pocso',   label: 'POCSO Act 2012'              },
  { key: 'hurt',    label: 'Hurt (BNS Sec 115/116)'      },
  { key: 'riots',   label: 'Riots (BNS Sec 189/190)'     },
]

const totalCrimes = (row: CrimeRow) =>
  row.murder + row.dacoity + row.robbery + row.theft +
  row.cyber + row.ndps + row.pocso + row.hurt + row.riots

// ---------------------------------------------------------------------------
// Per-month static intelligence (districts & recommendations)
// ---------------------------------------------------------------------------

type MonthMeta = {
  districts: { name: string; concern: string; cases: number }[]
  recommendations: string[]
  highlights: string[]
}

const MONTH_META: Record<string, MonthMeta> = {
  Jan: {
    highlights: [
      'Cyber crime recorded the highest single-month count (1,259) in H1 2026.',
      'NDPS cases remain critically elevated at 1,397 — highest of the half-year.',
      'Murder and Hurt offences are tracking above the six-month median.',
    ],
    districts: [
      { name: 'Bengaluru City',  concern: 'Cyber Crime',  cases: 412 },
      { name: 'Belagavi',        concern: 'NDPS',         cases: 187 },
      { name: 'Mysuru',          concern: 'Theft',        cases: 231 },
    ],
    recommendations: [
      'Deploy Cyber Crime Task Force surge operations in Bengaluru City commissionerate targeting online fraud syndicates.',
      'Intensify NDPS inter-district co-ordination between Belagavi and Dharwad ranges under Operation Narco Shield.',
      'Increase beat patrolling in Mysuru residential zones to curb residential theft during winter festival season.',
    ],
  },
  Feb: {
    highlights: [
      'Overall IPC crime declined 9.4 % against January — the sharpest month-on-month drop in H1.',
      'POCSO registrations rose for the second consecutive month, indicating improved survivor reporting.',
      'Dacoity cases more than doubled (6 → 14), warranting immediate divisional-level review.',
    ],
    districts: [
      { name: 'Bengaluru City',  concern: 'Cyber Crime',  cases: 334 },
      { name: 'Belagavi',        concern: 'Dacoity',      cases: 5   },
      { name: 'Kalaburagi',      concern: 'NDPS',         cases: 143 },
    ],
    recommendations: [
      'Constitute a Special Investigation Team (SIT) for the spike in dacoity cases across Belagavi Range.',
      'Strengthen child protection desks at all district hospitals to facilitate POCSO case follow-through.',
      'Sustain momentum of joint narcotics drives in Kalaburagi and Yadgir districts.',
    ],
  },
  Mar: {
    highlights: [
      'March registered the highest murder count (104) of H1 2026 — a 42 % surge over February.',
      'Dacoity peaked at 18 cases, highest in the reporting period.',
      'Hurt cases breached 1,784 — the H1 maximum — coinciding with Holi and election-related gatherings.',
    ],
    districts: [
      { name: 'Bengaluru City',  concern: 'Hurt / Riots', cases: 298 },
      { name: 'Belagavi',        concern: 'Murder',       cases: 19  },
      { name: 'Tumakuru',        concern: 'Theft',        cases: 201 },
    ],
    recommendations: [
      'Issue state-wide preventive detention advisories under IPC 151 ahead of festival gatherings to pre-empt riot-related hurt.',
      'Activate dedicated anti-dacoity squads in Belagavi and Vijayapura commissionerates with 24 × 7 patrol grids.',
      'Commission CCTVsurveillance expansion under CCTNS Phase-II in Tumakuru Urban to reduce property crime.',
    ],
  },
  Apr: {
    highlights: [
      'April posted the lowest overall crime total of H1 — a 10 % fall from March.',
      'POCSO registrations continued to climb (394), reflecting sustained awareness campaign impact.',
      'Cyber crime fell below 1,000 for the first time in 2026 (928 cases).',
    ],
    districts: [
      { name: 'Bengaluru City',  concern: 'Cyber Crime',  cases: 301 },
      { name: 'Hassan',          concern: 'POCSO',        cases: 52  },
      { name: 'Dharwad',         concern: 'NDPS',         cases: 127 },
    ],
    recommendations: [
      'Leverage the cyber crime dip to consolidate digital evidence labs and train 200 additional officers in digital forensics.',
      'Expand POCSO fast-track courts in Hassan and Shivamogga districts to address rising case pendency.',
      'Intensify NDPS checks on NH-48 and NH-67 corridors passing through Dharwad Range.',
    ],
  },
  May: {
    highlights: [
      'POCSO registrations peaked at 406 — the highest single-month figure of H1 2026.',
      'Riots saw a marked increase (342 → 383), attributed to pre-monsoon labour disputes.',
      'NDPS registrations declined for the third consecutive month, suggesting enforcement efficacy.',
    ],
    districts: [
      { name: 'Bengaluru City',  concern: 'POCSO',        cases: 89  },
      { name: 'Dakshina Kannada', concern: 'Riots',       cases: 64  },
      { name: 'Shivamogga',      concern: 'Murder',       cases: 14  },
    ],
    recommendations: [
      'Launch a state-wide "Suraksha Mitra" awareness drive in schools and colleges to address the POCSO surge.',
      'Deploy Rapid Action Force (RAF) units in Dakshina Kannada ahead of Eid and coastal festival calendar.',
      'Order CID review of unsolved murder cases in Shivamogga Range to identify inter-gang linkages.',
    ],
  },
  Jun: {
    highlights: [
      'Murder registered the H1 peak of 113 cases in June — highest since Q4 2025.',
      'Theft fell to its H1 low (1,589), likely reflecting seasonal migration patterns.',
      'NDPS rebounded sharply (+51 % over May), signalling renewed smuggling activity.',
    ],
    districts: [
      { name: 'Bengaluru City',  concern: 'Murder',       cases: 22  },
      { name: 'Belagavi',        concern: 'NDPS',         cases: 196 },
      { name: 'Kalaburagi',      concern: 'Riots',        cases: 71  },
    ],
    recommendations: [
      'Invoke NSA provisions against identified repeat offenders behind the June murder spike in Bengaluru City.',
      'Co-ordinate with NCB Bengaluru Zonal Unit for joint inter-state NDPS operations targeting Belagavi border routes.',
      'Deploy peace committees and additional bandobast in Kalaburagi ahead of upcoming communal-sensitive anniversaries.',
    ],
  },
}

// ---------------------------------------------------------------------------
// HTML report generator
// ---------------------------------------------------------------------------

function buildReportHTML(monthIdx: number): string {
  const current = MONTHLY[monthIdx]
  const previous = monthIdx > 0 ? MONTHLY[monthIdx - 1] : null
  const meta     = MONTH_META[current.month]
  const total    = totalCrimes(current)
  const prevTotal = previous ? totalCrimes(previous) : null
  const pctChange = prevTotal != null
    ? (((total - prevTotal) / prevTotal) * 100).toFixed(1)
    : null

  const tableRows = CRIME_LABELS.map(({ key, label }) => {
    const cur  = current[key] as number
    const prev = previous ? (previous[key] as number) : null
    const diff = prev != null ? cur - prev : null
    const arrow = diff == null ? '—' : diff > 0 ? '▲' : diff < 0 ? '▼' : '→'
    const diffStr  = diff == null ? '—' : diff > 0 ? `+${diff}` : `${diff}`
    const trendCls = diff == null ? '' : diff > 0 ? 'color:#c0392b;font-weight:bold' : diff < 0 ? 'color:#27ae60;font-weight:bold' : ''
    return `
      <tr>
        <td>${label}</td>
        <td style="text-align:center;font-weight:bold">${cur}</td>
        <td style="text-align:center">${prev ?? '—'}</td>
        <td style="text-align:center;${trendCls}">${diffStr}</td>
        <td style="text-align:center;font-size:1.1rem;${trendCls}">${arrow}</td>
      </tr>`
  }).join('')

  const districtRows = meta.districts.map(d => `
    <tr>
      <td style="font-weight:bold">${d.name}</td>
      <td>${d.concern}</td>
      <td style="text-align:center;font-weight:bold;color:#c0392b">${d.cases}</td>
    </tr>`).join('')

  const highlights   = meta.highlights.map(h => `<li>${h}</li>`).join('')
  const recs         = meta.recommendations.map(r => `<li>${r}</li>`).join('')
  const changeBlurb  = pctChange == null
    ? 'No prior month available for comparison.'
    : `Total IPC &amp; special law crimes ${Number(pctChange) >= 0 ? 'increased' : 'decreased'} by
       <strong>${Math.abs(Number(pctChange))}%</strong> compared to ${previous!.month} 2026
       (${prevTotal!.toLocaleString()} → ${total.toLocaleString()}).`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>KSP Monthly Report — ${current.month} 2026</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    color: #1a1a1a;
    background: #fff;
    padding: 0;
  }
  @page { size: A4; margin: 20mm 18mm 20mm 18mm; }

  /* ── Letterhead ── */
  .letterhead {
    display: flex;
    align-items: center;
    gap: 18px;
    border-bottom: 3px double #1a3a6b;
    padding-bottom: 12px;
    margin-bottom: 8px;
  }
  .logo { font-size: 3rem; line-height: 1; }
  .org-name { font-size: 1.35rem; font-weight: bold; color: #1a3a6b; letter-spacing: 0.03em; }
  .org-sub  { font-size: 0.9rem;  color: #444; margin-top: 2px; }

  /* ── Confidentiality ribbon ── */
  .ribbon {
    background: #8B0000;
    color: #fff;
    text-align: center;
    font-size: 0.78rem;
    font-weight: bold;
    letter-spacing: 0.15em;
    padding: 4px 0;
    margin: 8px 0 14px;
  }

  /* ── Report title ── */
  .report-title {
    text-align: center;
    font-size: 1.15rem;
    font-weight: bold;
    color: #1a3a6b;
    text-decoration: underline;
    margin-bottom: 4px;
  }
  .report-meta {
    text-align: center;
    font-size: 0.82rem;
    color: #555;
    margin-bottom: 18px;
  }

  /* ── Sections ── */
  .section { margin-bottom: 20px; }
  .section-title {
    font-size: 1rem;
    font-weight: bold;
    color: #1a3a6b;
    background: #e8edf5;
    border-left: 4px solid #1a3a6b;
    padding: 4px 10px;
    margin-bottom: 10px;
  }
  p { line-height: 1.6; margin-bottom: 8px; }
  ul { padding-left: 22px; }
  ul li { margin-bottom: 5px; line-height: 1.55; }

  /* ── Table ── */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    margin-bottom: 6px;
  }
  th {
    background: #1a3a6b;
    color: #fff;
    padding: 6px 8px;
    text-align: left;
    font-weight: bold;
  }
  td { padding: 5px 8px; border: 1px solid #bbb; }
  tr:nth-child(even) td { background: #f4f6fa; }
  .total-row td { font-weight: bold; background: #dce3f0 !important; border-top: 2px solid #1a3a6b; }

  /* ── Signature block ── */
  .sig-block {
    margin-top: 36px;
    display: flex;
    justify-content: space-between;
  }
  .sig-item { text-align: center; }
  .sig-line  {
    border-top: 1px solid #333;
    margin-top: 40px;
    padding-top: 4px;
    font-size: 0.82rem;
    min-width: 200px;
  }
  .sig-title { font-size: 0.78rem; color: #555; margin-top: 2px; }

  /* ── Footer ── */
  .footer {
    margin-top: 30px;
    border-top: 2px solid #1a3a6b;
    padding-top: 6px;
    text-align: center;
    font-size: 0.72rem;
    color: #666;
    letter-spacing: 0.04em;
  }

  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<!-- Letterhead -->
<div class="letterhead">
  <div class="logo">⚖️</div>
  <div>
    <div class="org-name">Karnataka State Police</div>
    <div class="org-sub">Office of the Director General of Police</div>
    <div class="org-sub">Karnataka, India — CCTNS Crime Intelligence Platform</div>
  </div>
</div>

<!-- Confidentiality Ribbon -->
<div class="ribbon">⬛ FOR OFFICIAL USE ONLY — NOT FOR PUBLIC DISTRIBUTION ⬛</div>

<!-- Report Title -->
<div class="report-title">Monthly Crime Statistics Report — ${current.month} 2026</div>
<div class="report-meta">
  Generated: ${new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })}
  &nbsp;|&nbsp; Classification: Restricted &nbsp;|&nbsp; Ref: KSP/ADGP(Intel)/${current.month.toUpperCase()}/2026
</div>

<!-- Section 1: Executive Summary -->
<div class="section">
  <div class="section-title">Section 1 — Executive Summary</div>
  <p>
    During the month of <strong>${current.month} 2026</strong>, Karnataka State Police recorded
    <strong>${total.toLocaleString()}</strong> cognisable offences across IPC and special law categories.
    ${changeBlurb}
  </p>
  <p><strong>Key Highlights:</strong></p>
  <ul>${highlights}</ul>
</div>

<!-- Section 2: Crime-wise Summary Table -->
<div class="section">
  <div class="section-title">Section 2 — Crime-wise Summary Table</div>
  <table>
    <thead>
      <tr>
        <th>Crime Type</th>
        <th style="text-align:center">This Month</th>
        <th style="text-align:center">Last Month</th>
        <th style="text-align:center">Change</th>
        <th style="text-align:center">Trend</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
      <tr class="total-row">
        <td>TOTAL</td>
        <td style="text-align:center">${total.toLocaleString()}</td>
        <td style="text-align:center">${prevTotal != null ? prevTotal.toLocaleString() : '—'}</td>
        <td style="text-align:center">${pctChange != null ? (Number(pctChange) >= 0 ? `+${pctChange}%` : `${pctChange}%`) : '—'}</td>
        <td style="text-align:center">${pctChange != null ? (Number(pctChange) >= 0 ? '▲' : '▼') : '—'}</td>
      </tr>
    </tbody>
  </table>
  <p style="font-size:0.78rem;color:#666">
    * Last Month column reflects ${previous ? previous.month + ' 2026' : 'N/A (base month)'}. Trend ▲ = increase, ▼ = decrease, → = no change.
  </p>
</div>

<!-- Section 3: Top 3 Districts of Concern -->
<div class="section">
  <div class="section-title">Section 3 — Top 3 Districts of Concern</div>
  <table>
    <thead>
      <tr>
        <th>District / Commissionerate</th>
        <th>Primary Crime Concern</th>
        <th style="text-align:center">Reported Cases</th>
      </tr>
    </thead>
    <tbody>${districtRows}</tbody>
  </table>
</div>

<!-- Section 4: Recommendations -->
<div class="section">
  <div class="section-title">Section 4 — Recommendations</div>
  <ul>${recs}</ul>
</div>

<!-- Signature Block -->
<div class="sig-block">
  <div class="sig-item">
    <div class="sig-line">Sd/-</div>
    <div class="sig-title">Additional Director General of Police (Intelligence)</div>
    <div class="sig-title">Karnataka State Police</div>
  </div>
  <div class="sig-item">
    <div class="sig-line">Sd/-</div>
    <div class="sig-title">Director General &amp; Inspector General of Police</div>
    <div class="sig-title">Karnataka State Police, Bengaluru</div>
  </div>
</div>

<!-- Footer -->
<div class="footer">
  Karnataka State Police — CCTNS Crime Intelligence Platform &nbsp;|&nbsp; Confidential
  &nbsp;|&nbsp; Page 1 of 1 &nbsp;|&nbsp; ${current.month} 2026 Monthly Report
</div>

</body>
</html>`
}

// ---------------------------------------------------------------------------
// Preview card component
// ---------------------------------------------------------------------------

function PreviewCard({ monthIdx }: { monthIdx: number }) {
  const current  = MONTHLY[monthIdx]
  const previous = monthIdx > 0 ? MONTHLY[monthIdx - 1] : null
  const total    = totalCrimes(current)
  const prevTotal = previous ? totalCrimes(previous) : null
  const pct = prevTotal != null
    ? (((total - prevTotal) / prevTotal) * 100).toFixed(1)
    : null
  const up = pct != null && Number(pct) >= 0
  const meta = MONTH_META[current.month]

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
      {/* Card header */}
      <div className="bg-slate-900 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚖️</span>
          <div>
            <p className="text-sm font-bold text-white tracking-wide">Karnataka State Police</p>
            <p className="text-xs text-slate-400">Office of the Director General of Police</p>
          </div>
        </div>
        <span className="rounded px-2 py-1 text-[10px] font-bold tracking-widest bg-red-900/80 text-red-200 border border-red-700">
          FOR OFFICIAL USE ONLY
        </span>
      </div>

      {/* Title */}
      <div className="px-6 pt-4 pb-2 text-center border-b border-slate-700/50">
        <h3 className="text-base font-bold text-blue-300 underline">
          Monthly Crime Statistics Report — {current.month} 2026
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Ref: KSP/ADGP(Intel)/{current.month.toUpperCase()}/2026
        </p>
      </div>

      {/* Body */}
      <div className="px-6 py-4 space-y-5">

        {/* Executive summary stat strip */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-slate-900/70 border border-slate-700 p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Total Crimes</p>
            <p className="text-xl font-bold text-white">{total.toLocaleString()}</p>
          </div>
          <div className={`rounded-lg border p-3 text-center ${up ? 'bg-red-900/20 border-red-800' : 'bg-green-900/20 border-green-800'}`}>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">vs Prev Month</p>
            <p className={`text-xl font-bold flex items-center justify-center gap-1 ${up ? 'text-red-400' : 'text-green-400'}`}>
              {up ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {pct != null ? `${up ? '+' : ''}${pct}%` : 'N/A'}
            </p>
          </div>
          <div className="rounded-lg bg-slate-900/70 border border-slate-700 p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Murder</p>
            <p className="text-xl font-bold text-orange-400">{current.murder}</p>
          </div>
        </div>

        {/* Sections preview */}
        <div className="space-y-3">

          {/* Section 1 highlights */}
          <div>
            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Section 1 — Executive Summary
            </p>
            <ul className="space-y-1">
              {meta.highlights.map((h, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-300">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Section 2 table (abbreviated) */}
          <div>
            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Section 2 — Crime-wise Summary (preview)
            </p>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-700 text-slate-200">
                  <th className="text-left px-2 py-1 font-semibold">Crime Type</th>
                  <th className="text-center px-2 py-1 font-semibold">This Month</th>
                  <th className="text-center px-2 py-1 font-semibold">Change</th>
                </tr>
              </thead>
              <tbody>
                {CRIME_LABELS.map(({ key, label }) => {
                  const cur  = current[key] as number
                  const prev = previous ? (previous[key] as number) : null
                  const diff = prev != null ? cur - prev : null
                  const positive = diff != null && diff > 0
                  return (
                    <tr key={key} className="border-t border-slate-700/50 hover:bg-slate-700/30">
                      <td className="px-2 py-1 text-slate-300">{label}</td>
                      <td className="px-2 py-1 text-center font-bold text-white">{cur}</td>
                      <td className={`px-2 py-1 text-center font-bold ${diff == null ? 'text-slate-500' : positive ? 'text-red-400' : diff < 0 ? 'text-green-400' : 'text-slate-400'}`}>
                        {diff == null ? '—' : diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${diff}` : '→ 0'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Section 3 districts */}
          <div>
            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Section 3 — Top Districts of Concern
            </p>
            <div className="space-y-1.5">
              {meta.districts.map((d, i) => (
                <div key={i} className="flex items-center justify-between rounded bg-slate-900/60 border border-slate-700/50 px-3 py-1.5">
                  <div>
                    <p className="text-xs font-semibold text-white">{d.name}</p>
                    <p className="text-[10px] text-slate-400">{d.concern}</p>
                  </div>
                  <span className="text-sm font-bold text-red-400">{d.cases} cases</span>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4 recommendations */}
          <div>
            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Section 4 — Recommendations
            </p>
            <ul className="space-y-1">
              {meta.recommendations.map((r, i) => (
                <li key={i} className="text-xs text-slate-300 flex gap-2">
                  <span className="text-blue-400 font-bold shrink-0">{i + 1}.</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Signature preview */}
        <div className="flex justify-between border-t border-slate-700 pt-4">
          <div className="text-center">
            <div className="h-px w-40 bg-slate-500 mb-1" />
            <p className="text-[10px] text-slate-400">Addl. Director General of Police (Intelligence)</p>
          </div>
          <div className="text-center">
            <div className="h-px w-40 bg-slate-500 mb-1" />
            <p className="text-[10px] text-slate-400">Director General & IGP, Karnataka</p>
          </div>
        </div>
      </div>

      {/* Footer strip */}
      <div className="bg-slate-900 border-t border-slate-700 px-6 py-2 text-center">
        <p className="text-[10px] text-slate-500 tracking-wide">
          Karnataka State Police — CCTNS Crime Intelligence Platform | Confidential
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MonthlyReportPage() {
  const [monthIdx, setMonthIdx] = useState(5) // default to June (latest)

  function handlePrint() {
    const html = buildReportHTML(monthIdx)
    const win  = window.open('', '_blank', 'width=900,height=1200')
    if (!win) return
    win.document.open()
    win.document.write(html)
    win.document.close()
    // Give browser time to load fonts/styles then auto-invoke print dialog
    win.onload = () => win.print()
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      {/* ── Page header ── */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg bg-blue-600/20 border border-blue-500/30">
            <FileText className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Monthly Crime Report Generator
            </h1>
            <p className="text-sm text-slate-400">
              Generate executive summary reports for Karnataka State Police
            </p>
          </div>
        </div>
        <div className="mt-3 h-px bg-gradient-to-r from-blue-600/40 via-slate-700 to-transparent" />
      </div>

      {/* ── Controls ── */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="month-select" className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Select Month
          </label>
          <select
            id="month-select"
            value={monthIdx}
            onChange={e => setMonthIdx(Number(e.target.value))}
            className="rounded-lg bg-slate-800 border border-slate-600 text-white px-4 py-2.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                       hover:border-slate-500 transition-colors cursor-pointer min-w-[200px]"
          >
            {MONTHLY.map((m, i) => (
              <option key={m.month} value={i}>
                {m.month} 2026
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handlePrint}
          className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500
                     active:bg-blue-700 text-white font-semibold px-5 py-2.5 text-sm
                     transition-colors shadow-lg shadow-blue-900/30"
        >
          <Download className="w-4 h-4" />
          Generate PDF Report
        </button>

        <button
          onClick={handlePrint}
          className="flex items-center gap-2 rounded-lg bg-slate-700 hover:bg-slate-600
                     active:bg-slate-800 text-white font-semibold px-5 py-2.5 text-sm
                     transition-colors border border-slate-600"
        >
          <Printer className="w-4 h-4" />
          Print / Save as PDF
        </button>
      </div>

      {/* ── Report info banner ── */}
      <div className="mb-6 rounded-lg bg-blue-900/20 border border-blue-800/40 px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-300 leading-relaxed">
          <span className="font-bold text-blue-200">Report Preview</span> — The card below reflects the
          formatted report for <span className="font-semibold text-white">{MONTHLY[monthIdx].month} 2026</span>.
          Click <span className="font-semibold text-white">"Generate PDF Report"</span> or
          <span className="font-semibold text-white"> "Print / Save as PDF"</span> to open the
          printable A4 government document in a new window.
        </p>
      </div>

      {/* ── Preview area ── */}
      <div className="max-w-4xl">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Report Preview — {MONTHLY[monthIdx].month} 2026
          </span>
        </div>
        <PreviewCard monthIdx={monthIdx} />
      </div>
    </div>
  )
}
