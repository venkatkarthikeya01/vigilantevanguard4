import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { FileBarChart, Download, Mail, Loader2, CheckCircle } from 'lucide-react'

const REPORT_TYPES = [
  {
    id: 'daily_brief',
    label: 'Daily Intelligence Brief',
    desc: 'Auto-generated daily summary of all registered FIRs — emailed by Catalyst Cron at 6am',
    icon: '📋',
  },
  {
    id: 'district_report',
    label: 'District Crime Report',
    desc: 'Full crime statistics for a selected district — exported as PDF via Catalyst SmartBrowz',
    icon: '🗺️',
  },
  {
    id: 'case_summary',
    label: 'Case Summary Report',
    desc: 'Detailed AI-generated summary for a specific FIR — includes accused, victims, sections',
    icon: '🔍',
  },
]

export default function ReportsPage() {
  const [selectedType, setSelectedType] = useState('daily_brief')
  const [caseId, setCaseId] = useState('')
  const [districtId, setDistrictId] = useState('')
  const [email, setEmail] = useState('')
  const [success, setSuccess] = useState(false)

  const generateMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/reports/generate', {
        report_type: selectedType,
        case_id: caseId ? parseInt(caseId) : null,
        district_id: districtId ? parseInt(districtId) : null,
        email_recipients: email ? [email] : [],
      }).then(r => r.data),
    onSuccess: () => {
      setSuccess(true)
      setTimeout(() => setSuccess(false), 4000)
    },
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Intelligence Reports</h1>
        <p className="text-sm text-gray-400 mt-1">
          Generate PDF reports via Catalyst SmartBrowz · Delivered via Catalyst Mail
        </p>
      </div>

      {/* Report type cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {REPORT_TYPES.map(rt => (
          <button
            key={rt.id}
            onClick={() => setSelectedType(rt.id)}
            className={`text-left p-5 rounded-2xl border transition-all ${
              selectedType === rt.id
                ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500/50'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'
            }`}
          >
            <span className="text-2xl">{rt.icon}</span>
            <p className="text-sm font-semibold text-white mt-2">{rt.label}</p>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">{rt.desc}</p>
          </button>
        ))}
      </div>

      {/* Options */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Report Options</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {selectedType === 'case_summary' && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Case Master ID</label>
              <input
                value={caseId}
                onChange={e => setCaseId(e.target.value)}
                placeholder="e.g. 1234"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}
          {selectedType === 'district_report' && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">District ID</label>
              <input
                value={districtId}
                onChange={e => setDistrictId(e.target.value)}
                placeholder="e.g. 5 (Bengaluru City)"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Email Report To (optional)</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="officer@ksp.gov.in"
              type="email"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-5 py-3 rounded-xl transition-colors"
          >
            {generateMutation.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" />Generating...</>
              : <><FileBarChart className="h-4 w-4" />Generate Report</>}
          </button>

          {success && (
            <span className="flex items-center gap-2 text-green-400 text-sm">
              <CheckCircle className="h-4 w-4" />
              Report queued — check your email
            </span>
          )}
        </div>

        <p className="text-xs text-gray-600">
          PDFs generated via Catalyst SmartBrowz · Stored in Catalyst Stratus · Delivered via Catalyst Mail
        </p>
      </div>

      {/* Daily brief summary from real data */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Last Auto-Brief — January 2026 Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total FIRs', value: '10,168', note: 'All crime heads' },
            { label: 'Violent Crimes', value: '1,820', note: 'Murder + Hurt + Robbery' },
            { label: 'Property Crimes', value: '2,576', note: 'Theft + Burglary + Dacoity' },
            { label: 'Special Laws', value: '5,857', note: 'SLL cognizable cases' },
          ].map(s => (
            <div key={s.label} className="bg-gray-800/60 rounded-xl p-4">
              <p className="text-xl font-bold text-white">{s.value}</p>
              <p className="text-xs font-medium text-gray-300 mt-1">{s.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
