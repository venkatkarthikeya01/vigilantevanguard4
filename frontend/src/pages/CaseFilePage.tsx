import { useState, useEffect } from 'react'
import {
  FileText, Plus, X, ChevronRight, Clock, AlertTriangle, CheckCircle2,
  Circle, Shield, Paperclip, MessageSquare, ArrowLeft, Edit2, Save, Trash2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EvidenceItem {
  id: string
  description: string
  type: 'Physical' | 'Digital' | 'Witness Statement' | 'Document' | 'Forensic'
  collectedDate: string
  collectedBy: string
}

interface CaseEvent {
  id: string
  date: string
  action: string
  officer: string
  notes: string
}

interface CaseFile {
  id: string
  crimeNo: string
  district: string
  crimeType: string
  stage: 'Filed' | 'Under Investigation' | 'Chargesheet Filed' | 'Court Trial' | 'Closed'
  priority: 'Normal' | 'High' | 'Critical'
  assignedOfficer: string
  openedDate: string
  lastUpdated: string
  evidence: EvidenceItem[]
  timeline: CaseEvent[]
  notes: string
}

type Stage = CaseFile['stage']
type Priority = CaseFile['priority']
type EvidenceType = EvidenceItem['type']
type DetailTab = 'timeline' | 'evidence' | 'notes'

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGES: Stage[] = ['Filed', 'Under Investigation', 'Chargesheet Filed', 'Court Trial', 'Closed']
const PRIORITIES: Priority[] = ['Normal', 'High', 'Critical']
const EVIDENCE_TYPES: EvidenceType[] = ['Physical', 'Digital', 'Witness Statement', 'Document', 'Forensic']

const LS_KEY = 'vv_casefiles'

const STAGE_COLORS: Record<Stage, string> = {
  'Filed':               'text-gray-400  bg-gray-800        border-gray-700',
  'Under Investigation': 'text-amber-400 bg-amber-500/10    border-amber-500/30',
  'Chargesheet Filed':   'text-blue-400  bg-blue-500/10     border-blue-500/30',
  'Court Trial':         'text-violet-400 bg-violet-500/10  border-violet-500/30',
  'Closed':              'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
}

const PRIORITY_COLORS: Record<Priority, string> = {
  Normal:   'text-gray-400  bg-gray-800        border-gray-700',
  High:     'text-amber-400 bg-amber-500/10    border-amber-500/30',
  Critical: 'text-red-400   bg-red-500/10      border-red-500/30',
}

const PRIORITY_DOT: Record<Priority, string> = {
  Normal: 'bg-gray-500',
  High: 'bg-amber-400',
  Critical: 'bg-red-500',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(d: string) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

// ─── Mock Case Files ──────────────────────────────────────────────────────────

const MOCK_CASES: CaseFile[] = [
  {
    id: uid(),
    crimeNo: 'KA/BLR/001/2026',
    district: 'Bengaluru City',
    crimeType: 'Cyber Crime',
    stage: 'Under Investigation',
    priority: 'High',
    assignedOfficer: 'SI Priya Menon',
    openedDate: '2026-01-10',
    lastUpdated: '2026-06-18',
    notes: 'Victim received phishing link via SMS. ₹4.2L transferred to mule accounts. Coordination with cybercrime cell and bank freeze initiated.',
    evidence: [
      { id: uid(), description: 'Screenshot of phishing SMS', type: 'Digital', collectedDate: '2026-01-11', collectedBy: 'HC Suresh D' },
      { id: uid(), description: 'Bank transaction records (Axis Bank)', type: 'Document', collectedDate: '2026-01-13', collectedBy: 'SI Priya Menon' },
      { id: uid(), description: 'Victim statement – Rajesh Nair', type: 'Witness Statement', collectedDate: '2026-01-10', collectedBy: 'ASI Kavitha R' },
    ],
    timeline: [
      { id: uid(), date: '2026-01-10', action: 'FIR Registered', officer: 'ASI Kavitha R', notes: 'Victim Rajesh Nair filed complaint at Koramangala PS' },
      { id: uid(), date: '2026-01-11', action: 'Case Assigned', officer: 'Inspector Ravi Kumar', notes: 'SI Priya Menon assigned as investigating officer' },
      { id: uid(), date: '2026-01-13', action: 'Bank Account Frozen', officer: 'SI Priya Menon', notes: 'Three mule accounts frozen in coordination with Axis Bank' },
      { id: uid(), date: '2026-03-02', action: 'Suspect Identified', officer: 'SI Priya Menon', notes: 'Primary accused traced to Hyderabad via IP log analysis' },
    ],
  },
  {
    id: uid(),
    crimeNo: 'KA/MYS/014/2026',
    district: 'Mysuru',
    crimeType: 'Murder',
    stage: 'Chargesheet Filed',
    priority: 'Critical',
    assignedOfficer: 'Inspector Anand Gowda',
    openedDate: '2026-02-04',
    lastUpdated: '2026-05-30',
    notes: 'Victim found at Chamundi Hill foothills. Blunt force trauma. Domestic dispute motive established. Accused Mahesh K in judicial custody.',
    evidence: [
      { id: uid(), description: 'Blood-stained iron rod (weapon)', type: 'Physical', collectedDate: '2026-02-04', collectedBy: 'FSL Team' },
      { id: uid(), description: 'Post-mortem report (Dr. Venkatesh, Mysuru GH)', type: 'Forensic', collectedDate: '2026-02-06', collectedBy: 'Inspector Anand Gowda' },
      { id: uid(), description: 'Eyewitness statement – K. Nagaraj', type: 'Witness Statement', collectedDate: '2026-02-05', collectedBy: 'SI Usha Rani' },
      { id: uid(), description: 'CCTV footage from Chamundi Hill gate', type: 'Digital', collectedDate: '2026-02-07', collectedBy: 'HC Santosh M' },
    ],
    timeline: [
      { id: uid(), date: '2026-02-04', action: 'Body Discovered', officer: 'Constable Lokesh', notes: 'Body found by morning walkers at 06:30 hrs' },
      { id: uid(), date: '2026-02-04', action: 'FIR Registered', officer: 'SI Usha Rani', notes: 'Section 302 IPC registered at Chamundi PS' },
      { id: uid(), date: '2026-02-08', action: 'Accused Arrested', officer: 'Inspector Anand Gowda', notes: 'Mahesh K arrested from Nanjangud, Sec 302 IPC' },
      { id: uid(), date: '2026-04-15', action: 'Chargesheet Filed', officer: 'Inspector Anand Gowda', notes: '1200-page chargesheet filed before JMFC Mysuru' },
    ],
  },
  {
    id: uid(),
    crimeNo: 'KA/BLG/022/2026',
    district: 'Belagavi',
    crimeType: 'Vehicle Theft',
    stage: 'Filed',
    priority: 'Normal',
    assignedOfficer: 'HC Rekha N',
    openedDate: '2026-06-10',
    lastUpdated: '2026-06-10',
    notes: 'Honda Activa (KA-22-EF-4891) stolen from Tilakwadi area. CCTV footage being reviewed.',
    evidence: [
      { id: uid(), description: 'Vehicle registration copy', type: 'Document', collectedDate: '2026-06-10', collectedBy: 'HC Rekha N' },
    ],
    timeline: [
      { id: uid(), date: '2026-06-10', action: 'FIR Registered', officer: 'HC Rekha N', notes: 'Complainant Shivanand Patil filed complaint at Camp PS' },
    ],
  },
  {
    id: uid(),
    crimeNo: 'KA/KLB/008/2025',
    district: 'Kalaburagi',
    crimeType: 'NDPS Act',
    stage: 'Court Trial',
    priority: 'High',
    assignedOfficer: 'SI Raju Chavan',
    openedDate: '2025-11-19',
    lastUpdated: '2026-06-05',
    notes: 'Recovery of 4.8 kg ganja near Aland railway station. Two accused in bail-refused custody. Trial commenced at NDPS Special Court.',
    evidence: [
      { id: uid(), description: '4.8 kg cannabis (sealed & labelled)', type: 'Physical', collectedDate: '2025-11-19', collectedBy: 'SI Raju Chavan' },
      { id: uid(), description: 'FSL analysis report – cannabis confirmation', type: 'Forensic', collectedDate: '2025-12-01', collectedBy: 'FSL Kalaburagi' },
      { id: uid(), description: 'Accused confession statement (Sec 67 NDPS)', type: 'Document', collectedDate: '2025-11-20', collectedBy: 'SI Raju Chavan' },
    ],
    timeline: [
      { id: uid(), date: '2025-11-19', action: 'Raid & Recovery', officer: 'SI Raju Chavan', notes: 'Tip-based operation near Aland Rly Stn, two nabbed' },
      { id: uid(), date: '2025-11-20', action: 'FIR Registered', officer: 'SI Raju Chavan', notes: 'Sec 20(b)(ii)(B) NDPS Act registered' },
      { id: uid(), date: '2026-01-12', action: 'Bail Rejected', officer: 'Court Record', notes: 'Sessions Court rejected bail application of A1 and A2' },
      { id: uid(), date: '2026-03-08', action: 'Trial Commenced', officer: 'PP Mahesh Kulkarni', notes: 'Prosecution evidence stage begun before NDPS Special Court' },
    ],
  },
  {
    id: uid(),
    crimeNo: 'KA/SHV/003/2026',
    district: 'Shivamogga',
    crimeType: 'POCSO',
    stage: 'Closed',
    priority: 'Critical',
    assignedOfficer: 'Inspector Deepak Rao',
    openedDate: '2026-01-22',
    lastUpdated: '2026-05-14',
    notes: 'Case involved minor victim aged 13. Accused convicted by POCSO Special Court and sentenced to 10 years RI. Victim support services engaged.',
    evidence: [
      { id: uid(), description: 'Medical examination report (child victim)', type: 'Forensic', collectedDate: '2026-01-22', collectedBy: 'Dr. Suma, DHO Shivamogga' },
      { id: uid(), description: 'Statement of victim (Sec 164 CrPC)', type: 'Witness Statement', collectedDate: '2026-01-25', collectedBy: 'Magistrate – recorded' },
      { id: uid(), description: 'Accused mobile – chat records', type: 'Digital', collectedDate: '2026-01-23', collectedBy: 'Inspector Deepak Rao' },
    ],
    timeline: [
      { id: uid(), date: '2026-01-22', action: 'Complaint Received', officer: 'Inspector Deepak Rao', notes: 'Parent filed complaint at KSS PS; Child Welfare Committee notified' },
      { id: uid(), date: '2026-01-22', action: 'Accused Arrested', officer: 'Inspector Deepak Rao', notes: 'Accused Manjunath S arrested within 6 hrs' },
      { id: uid(), date: '2026-02-14', action: 'Chargesheet Filed', officer: 'Inspector Deepak Rao', notes: 'Chargesheet filed within 60 days per POCSO mandate' },
      { id: uid(), date: '2026-05-14', action: 'Conviction', officer: 'PP record', notes: 'Accused convicted – 10 yrs RI + fine by POCSO Special Court' },
    ],
  },
]

// ─── New Case Form ────────────────────────────────────────────────────────────

interface NewCaseForm {
  crimeNo: string
  district: string
  crimeType: string
  priority: Priority
  assignedOfficer: string
}

const emptyNewCase = (): NewCaseForm => ({
  crimeNo: '',
  district: '',
  crimeType: '',
  priority: 'Normal',
  assignedOfficer: '',
})

// ─── Sub-components ───────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STAGE_COLORS[stage]}`}>
      {stage}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold border ${PRIORITY_COLORS[priority]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[priority]}`} />
      {priority}
    </span>
  )
}

/** 5-step stage progress bar */
function StageProgress({ stage }: { stage: Stage }) {
  const idx = STAGES.indexOf(stage)
  return (
    <div className="flex items-center gap-0">
      {STAGES.map((s, i) => {
        const done = i < idx
        const active = i === idx
        return (
          <div key={s} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center border-2 text-xs font-bold transition-all ${
                  done
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : active
                    ? 'bg-blue-500 border-blue-400 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-600'
                }`}
              >
                {done ? <CheckCircle2 size={14} /> : active ? i + 1 : <Circle size={12} />}
              </div>
              <span className={`text-[9px] whitespace-nowrap font-medium ${active ? 'text-blue-400' : done ? 'text-emerald-500' : 'text-gray-600'}`}>
                {s === 'Under Investigation' ? 'Investigating' : s === 'Chargesheet Filed' ? 'Chargesheet' : s}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`h-0.5 w-8 sm:w-12 mx-0.5 mb-4 ${i < idx ? 'bg-emerald-500' : 'bg-gray-700'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CaseFilePage() {
  const [cases, setCases] = useState<CaseFile[]>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) return JSON.parse(raw) as CaseFile[]
    } catch { /* ignore */ }
    return MOCK_CASES
  })

  const [stageFilter, setStageFilter] = useState<Stage | 'All'>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('timeline')
  const [showNewCaseForm, setShowNewCaseForm] = useState(false)
  const [newCaseForm, setNewCaseForm] = useState<NewCaseForm>(emptyNewCase())

  // Detail panel sub-forms
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [eventForm, setEventForm] = useState({ action: '', officer: '', notes: '' })

  const [showAddEvidence, setShowAddEvidence] = useState(false)
  const [evidenceForm, setEvidenceForm] = useState({
    description: '',
    type: 'Physical' as EvidenceType,
    collectedDate: todayISO(),
    collectedBy: '',
  })

  const [editNotes, setEditNotes] = useState(false)
  const [draftNotes, setDraftNotes] = useState('')

  // Persist
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(cases))
  }, [cases])

  // Sync draftNotes when selected case changes
  useEffect(() => {
    if (selectedId) {
      const c = cases.find(x => x.id === selectedId)
      if (c) setDraftNotes(c.notes)
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filteredCases = stageFilter === 'All' ? cases : cases.filter(c => c.stage === stageFilter)
  const selectedCase = cases.find(c => c.id === selectedId) ?? null

  const statsUnderInv   = cases.filter(c => c.stage === 'Under Investigation').length
  const statsChargesheet = cases.filter(c => c.stage === 'Chargesheet Filed').length
  const statsClosed     = cases.filter(c => c.stage === 'Closed').length

  // ── Mutations ────────────────────────────────────────────────────────────────

  function updateCase(id: string, patch: Partial<CaseFile>) {
    setCases(cs => cs.map(c => c.id === id ? { ...c, ...patch, lastUpdated: todayISO() } : c))
  }

  function handleAddEvent() {
    if (!selectedId || !eventForm.action.trim()) return
    const ev: CaseEvent = {
      id: uid(),
      date: todayISO(),
      action: eventForm.action.trim(),
      officer: eventForm.officer.trim(),
      notes: eventForm.notes.trim(),
    }
    const c = cases.find(x => x.id === selectedId)!
    updateCase(selectedId, { timeline: [...c.timeline, ev] })
    setEventForm({ action: '', officer: '', notes: '' })
    setShowAddEvent(false)
  }

  function handleAddEvidence() {
    if (!selectedId || !evidenceForm.description.trim()) return
    const ev: EvidenceItem = {
      id: uid(),
      description: evidenceForm.description.trim(),
      type: evidenceForm.type,
      collectedDate: evidenceForm.collectedDate,
      collectedBy: evidenceForm.collectedBy.trim(),
    }
    const c = cases.find(x => x.id === selectedId)!
    updateCase(selectedId, { evidence: [...c.evidence, ev] })
    setEvidenceForm({ description: '', type: 'Physical', collectedDate: todayISO(), collectedBy: '' })
    setShowAddEvidence(false)
  }

  function handleSaveNotes() {
    if (!selectedId) return
    updateCase(selectedId, { notes: draftNotes })
    setEditNotes(false)
  }

  function handleCreateCase() {
    if (!newCaseForm.crimeNo.trim() || !newCaseForm.crimeType.trim()) return
    const c: CaseFile = {
      id: uid(),
      crimeNo: newCaseForm.crimeNo.trim(),
      district: newCaseForm.district.trim(),
      crimeType: newCaseForm.crimeType.trim(),
      stage: 'Filed',
      priority: newCaseForm.priority,
      assignedOfficer: newCaseForm.assignedOfficer.trim(),
      openedDate: todayISO(),
      lastUpdated: todayISO(),
      evidence: [],
      timeline: [{ id: uid(), date: todayISO(), action: 'Case Filed', officer: newCaseForm.assignedOfficer.trim(), notes: 'New case file created.' }],
      notes: '',
    }
    setCases(cs => [...cs, c])
    setShowNewCaseForm(false)
    setNewCaseForm(emptyNewCase())
    setSelectedId(c.id)
    setDetailTab('timeline')
  }

  function handleDeleteCase(id: string) {
    if (!confirm('Delete this case file? This cannot be undone.')) return
    setCases(cs => cs.filter(c => c.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  // ── Render: Detail Panel ─────────────────────────────────────────────────────

  function renderDetailPanel(c: CaseFile) {
    return (
      <div className="flex flex-col gap-0 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {/* Case header */}
        <div className="border-b border-gray-800 px-5 py-4 space-y-4">
          <div className="flex items-start gap-3 flex-wrap">
            <button
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm transition-colors"
            >
              <ArrowLeft size={15} />
              Back to list
            </button>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {/* Change Priority */}
              <select
                value={c.priority}
                onChange={e => updateCase(c.id, { priority: e.target.value as Priority })}
                className={`text-xs font-semibold border rounded-md px-2 py-1 bg-transparent cursor-pointer focus:outline-none ${PRIORITY_COLORS[c.priority]}`}
              >
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {/* Change Stage */}
              <select
                value={c.stage}
                onChange={e => updateCase(c.id, { stage: e.target.value as Stage })}
                className={`text-xs font-semibold border rounded-md px-2 py-1 bg-transparent cursor-pointer focus:outline-none ${STAGE_COLORS[c.stage]}`}
              >
                {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                onClick={() => handleDeleteCase(c.id)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                title="Delete case"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold text-white font-mono">{c.crimeNo}</span>
              <PriorityBadge priority={c.priority} />
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-400 flex-wrap">
              <span className="font-medium text-gray-300">{c.crimeType}</span>
              <span className="text-gray-600">•</span>
              <span>{c.district}</span>
              <span className="text-gray-600">•</span>
              <span className="flex items-center gap-1">
                <Shield size={12} />
                {c.assignedOfficer}
              </span>
              <span className="text-gray-600">•</span>
              <span className="flex items-center gap-1">
                <Clock size={12} />
                Opened {fmtDate(c.openedDate)}
              </span>
            </div>
          </div>

          {/* Stage Progress */}
          <div className="overflow-x-auto pb-1">
            <StageProgress stage={c.stage} />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {([
            { key: 'timeline', label: 'Timeline', icon: <Clock size={14} /> },
            { key: 'evidence', label: 'Evidence', icon: <Paperclip size={14} /> },
            { key: 'notes',    label: 'Notes',    icon: <MessageSquare size={14} /> },
          ] as { key: DetailTab; label: string; icon: React.ReactNode }[]).map(tab => (
            <button
              key={tab.key}
              onClick={() => { setDetailTab(tab.key); setShowAddEvent(false); setShowAddEvidence(false); setEditNotes(false) }}
              className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-all ${
                detailTab === tab.key
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.key === 'evidence' && (
                <span className="ml-1 text-xs bg-gray-800 text-gray-400 rounded-full px-1.5">{c.evidence.length}</span>
              )}
              {tab.key === 'timeline' && (
                <span className="ml-1 text-xs bg-gray-800 text-gray-400 rounded-full px-1.5">{c.timeline.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5 flex-1">
          {/* ── Timeline ── */}
          {detailTab === 'timeline' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-300">Case Timeline</h3>
                <button
                  onClick={() => setShowAddEvent(v => !v)}
                  className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Plus size={13} />
                  Add Event
                </button>
              </div>

              {/* Add event inline form */}
              {showAddEvent && (
                <div className="bg-gray-950 border border-gray-700 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">New Event</p>
                  <input
                    type="text"
                    placeholder="Action / event description"
                    value={eventForm.action}
                    onChange={e => setEventForm(f => ({ ...f, action: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Officer name"
                      value={eventForm.officer}
                      onChange={e => setEventForm(f => ({ ...f, officer: e.target.value }))}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                    />
                    <textarea
                      placeholder="Notes (optional)"
                      value={eventForm.notes}
                      onChange={e => setEventForm(f => ({ ...f, notes: e.target.value }))}
                      rows={1}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddEvent}
                      disabled={!eventForm.action.trim()}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded-lg py-1.5 transition-colors"
                    >
                      Save Event
                    </button>
                    <button
                      onClick={() => setShowAddEvent(false)}
                      className="px-4 bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Timeline list */}
              <div className="relative">
                <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gray-800" />
                <div className="space-y-1">
                  {[...c.timeline].reverse().map((ev, i) => (
                    <div key={ev.id} className="relative pl-10 pb-6 last:pb-0">
                      <div className="absolute left-2 top-1.5 h-3 w-3 rounded-full bg-blue-500 border-2 border-gray-950 z-10" />
                      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl px-4 py-3">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div>
                            <p className="text-sm font-semibold text-white">{ev.action}</p>
                            {ev.notes && <p className="text-xs text-gray-400 mt-0.5">{ev.notes}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs text-gray-500">{fmtDate(ev.date)}</p>
                            {ev.officer && <p className="text-xs text-gray-500 mt-0.5">{ev.officer}</p>}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Evidence ── */}
          {detailTab === 'evidence' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-300">Evidence Items</h3>
                <button
                  onClick={() => setShowAddEvidence(v => !v)}
                  className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Plus size={13} />
                  Add Evidence
                </button>
              </div>

              {/* Add evidence inline form */}
              {showAddEvidence && (
                <div className="bg-gray-950 border border-gray-700 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">New Evidence</p>
                  <input
                    type="text"
                    placeholder="Evidence description"
                    value={evidenceForm.description}
                    onChange={e => setEvidenceForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      value={evidenceForm.type}
                      onChange={e => setEvidenceForm(f => ({ ...f, type: e.target.value as EvidenceType }))}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                      {EVIDENCE_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                    <input
                      type="date"
                      value={evidenceForm.collectedDate}
                      onChange={e => setEvidenceForm(f => ({ ...f, collectedDate: e.target.value }))}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Collected by (officer name)"
                    value={evidenceForm.collectedBy}
                    onChange={e => setEvidenceForm(f => ({ ...f, collectedBy: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddEvidence}
                      disabled={!evidenceForm.description.trim()}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded-lg py-1.5 transition-colors"
                    >
                      Save Evidence
                    </button>
                    <button
                      onClick={() => setShowAddEvidence(false)}
                      className="px-4 bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Evidence table */}
              {c.evidence.length === 0 ? (
                <p className="text-sm text-gray-600 text-center py-8">No evidence items recorded</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-800/60 text-left">
                        <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">#</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Description</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Type</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Collected</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">By</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {c.evidence.map((ev, i) => {
                        const typeColors: Record<EvidenceType, string> = {
                          Physical:          'text-orange-400 bg-orange-500/10',
                          Digital:           'text-cyan-400   bg-cyan-500/10',
                          'Witness Statement':'text-amber-400  bg-amber-500/10',
                          Document:          'text-blue-400   bg-blue-500/10',
                          Forensic:          'text-violet-400 bg-violet-500/10',
                        }
                        return (
                          <tr key={ev.id} className="hover:bg-gray-800/30 transition-colors">
                            <td className="px-4 py-3 text-gray-600 font-mono text-xs">{i + 1}</td>
                            <td className="px-4 py-3 text-gray-200 max-w-xs">{ev.description}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${typeColors[ev.type]}`}>{ev.type}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDate(ev.collectedDate)}</td>
                            <td className="px-4 py-3 text-gray-400 text-xs">{ev.collectedBy || '—'}</td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => {
                                  updateCase(c.id, { evidence: c.evidence.filter(x => x.id !== ev.id) })
                                }}
                                className="text-gray-600 hover:text-red-400 transition-colors"
                              >
                                <X size={13} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Notes ── */}
          {detailTab === 'notes' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-300">Case Notes</h3>
                {editNotes ? (
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveNotes}
                      className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Save size={12} />
                      Save
                    </button>
                    <button
                      onClick={() => { setEditNotes(false); setDraftNotes(c.notes) }}
                      className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditNotes(true)}
                    className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Edit2 size={12} />
                    Edit
                  </button>
                )}
              </div>
              {editNotes ? (
                <textarea
                  value={draftNotes}
                  onChange={e => setDraftNotes(e.target.value)}
                  rows={12}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none leading-relaxed"
                  placeholder="Enter case notes here…"
                />
              ) : (
                <div className="bg-gray-800/40 border border-gray-800 rounded-xl px-4 py-4 min-h-[200px]">
                  {c.notes ? (
                    <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{c.notes}</p>
                  ) : (
                    <p className="text-sm text-gray-600 italic">No notes recorded. Click Edit to add notes.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Render: List View ────────────────────────────────────────────────────────

  function renderListView() {
    return (
      <div className="space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Cases',          value: cases.length,       icon: <FileText size={15} className="text-blue-400" />,     border: 'border-blue-500/20' },
            { label: 'Under Investigation',  value: statsUnderInv,      icon: <AlertTriangle size={15} className="text-amber-400" />,border: statsUnderInv > 0 ? 'border-amber-500/30' : 'border-gray-800' },
            { label: 'Chargesheet Filed',    value: statsChargesheet,   icon: <CheckCircle2 size={15} className="text-blue-400" />,  border: 'border-blue-500/20' },
            { label: 'Closed',               value: statsClosed,        icon: <Shield size={15} className="text-emerald-400" />,    border: 'border-emerald-500/20' },
          ].map(s => (
            <div key={s.label} className={`bg-gray-900 border ${s.border} rounded-xl p-4 flex items-center gap-3`}>
              <div className="p-2 bg-gray-800 rounded-lg">{s.icon}</div>
              <div>
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className="text-2xl font-bold text-white">{s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filter row + New Case button */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-wrap gap-2">
            {(['All', ...STAGES] as (Stage | 'All')[]).map(s => (
              <button
                key={s}
                onClick={() => setStageFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  stageFilter === s
                    ? 'bg-blue-500/15 border-blue-500/50 text-blue-300'
                    : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowNewCaseForm(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={15} />
            New Case File
          </button>
        </div>

        {/* New case form modal */}
        {showNewCaseForm && (
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Create New Case File</p>
              <button onClick={() => setShowNewCaseForm(false)} className="text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Crime Number *</label>
                <input
                  type="text"
                  placeholder="e.g. KA/BLR/025/2026"
                  value={newCaseForm.crimeNo}
                  onChange={e => setNewCaseForm(f => ({ ...f, crimeNo: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Crime Type *</label>
                <input
                  type="text"
                  placeholder="e.g. Robbery, Cyber Crime"
                  value={newCaseForm.crimeType}
                  onChange={e => setNewCaseForm(f => ({ ...f, crimeType: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">District</label>
                <input
                  type="text"
                  placeholder="e.g. Bengaluru City"
                  value={newCaseForm.district}
                  onChange={e => setNewCaseForm(f => ({ ...f, district: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Assigned Officer</label>
                <input
                  type="text"
                  placeholder="e.g. SI Priya Menon"
                  value={newCaseForm.assignedOfficer}
                  onChange={e => setNewCaseForm(f => ({ ...f, assignedOfficer: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Priority</label>
                <select
                  value={newCaseForm.priority}
                  onChange={e => setNewCaseForm(f => ({ ...f, priority: e.target.value as Priority }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreateCase}
                disabled={!newCaseForm.crimeNo.trim() || !newCaseForm.crimeType.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg py-2 transition-colors"
              >
                Create Case File
              </button>
              <button
                onClick={() => setShowNewCaseForm(false)}
                className="px-5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Cases table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800/60 border-b border-gray-800">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Crime No</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">District</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Crime Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Stage</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Priority</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Officer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Last Updated</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredCases.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-gray-600 text-sm">
                      No cases match this filter.
                    </td>
                  </tr>
                )}
                {filteredCases.map(c => (
                  <tr key={c.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-200 whitespace-nowrap">{c.crimeNo}</td>
                    <td className="px-4 py-3 text-gray-300">{c.district}</td>
                    <td className="px-4 py-3 text-gray-300">{c.crimeType}</td>
                    <td className="px-4 py-3">
                      <StageBadge stage={c.stage} />
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={c.priority} />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{c.assignedOfficer}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(c.lastUpdated)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { setSelectedId(c.id); setDetailTab('timeline') }}
                        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap transition-colors"
                      >
                        Open
                        <ChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  // ── Root render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Page header */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-violet-500/10 rounded-xl border border-violet-500/20">
            <FileText className="text-violet-400" size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Case File &amp; Evidence Tracker</h1>
            <p className="text-sm text-gray-400 mt-0.5">Full case lifecycle management — from FIR to closure</p>
          </div>
        </div>

        {/* Conditional view */}
        {selectedCase
          ? renderDetailPanel(selectedCase)
          : renderListView()
        }

      </div>
    </div>
  )
}
