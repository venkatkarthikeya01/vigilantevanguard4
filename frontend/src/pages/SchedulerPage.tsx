import { useState, useEffect } from 'react'
import {
  Users, Plus, X, AlertTriangle, Shield, Clock, ChevronRight,
  Calendar, ChevronLeft,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShiftSlot {
  id: string
  district: string
  beat: string
  shift: 'Morning (6AM-2PM)' | 'Afternoon (2PM-10PM)' | 'Night (10PM-6AM)'
  officer: string
  rank: string
  riskLevel: 'High' | 'Medium' | 'Low'
  date: string   // ISO yyyy-mm-dd
}

type ShiftLabel = ShiftSlot['shift']
type RankLabel  = 'Constable' | 'HC' | 'ASI' | 'SI' | 'Inspector'

// ─── Constants ────────────────────────────────────────────────────────────────

const DISTRICTS = [
  'Bengaluru City',
  'Mysuru',
  'Belagavi',
  'Kalaburagi',
  'Shivamogga',
  'Raichur',
] as const

const SHIFTS: ShiftLabel[] = [
  'Morning (6AM-2PM)',
  'Afternoon (2PM-10PM)',
  'Night (10PM-6AM)',
]

const SHIFT_ICONS: Record<ShiftLabel, string> = {
  'Morning (6AM-2PM)': '☀️',
  'Afternoon (2PM-10PM)': '🌤️',
  'Night (10PM-6AM)': '🌙',
}

const RANKS: RankLabel[] = ['Constable', 'HC', 'ASI', 'SI', 'Inspector']

const DISTRICT_RISK: Record<string, ShiftSlot['riskLevel']> = {
  'Bengaluru City': 'High',
  'Raichur':        'High',
  'Belagavi':       'Medium',
  'Kalaburagi':     'Medium',
  'Mysuru':         'Low',
  'Shivamogga':     'Low',
}

const RISK_DOT: Record<ShiftSlot['riskLevel'], string> = {
  High:   'bg-red-500',
  Medium: 'bg-amber-400',
  Low:    'bg-emerald-500',
}

const RISK_BADGE: Record<ShiftSlot['riskLevel'], string> = {
  High:   'text-red-400 bg-red-500/10 border border-red-500/30',
  Medium: 'text-amber-400 bg-amber-500/10 border border-amber-500/30',
  Low:    'text-emerald-400 bg-emerald-500/10 border border-emerald-500/30',
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const LS_KEY = 'vv_scheduler'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Returns Mon–Sun ISO dates for the week containing `baseDate` (offset by weekOffset weeks) */
function weekDatesFor(weekOffset: number): string[] {
  const today = new Date()
  const dow   = today.getDay()                           // 0=Sun
  const mon   = new Date(today)
  mon.setDate(today.getDate() - ((dow + 6) % 7) + weekOffset * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    return d.toISOString().slice(0, 10)
  })
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ─── Seed roster — covers today + adjacent days ──────────────────────────────

function buildInitialRoster(): ShiftSlot[] {
  const today = todayISO()
  return [
    // Bengaluru City — today
    { id: uid(), district: 'Bengaluru City', beat: 'MG Road Beat',    shift: 'Morning (6AM-2PM)',     officer: 'Ravi Kumar',    rank: 'SI',        riskLevel: 'High',   date: today },
    { id: uid(), district: 'Bengaluru City', beat: 'MG Road Beat',    shift: 'Morning (6AM-2PM)',     officer: 'Nagaraj B',     rank: 'Constable', riskLevel: 'High',   date: today },
    { id: uid(), district: 'Bengaluru City', beat: 'Shivajinagar',    shift: 'Afternoon (2PM-10PM)',  officer: 'Priya Menon',   rank: 'HC',        riskLevel: 'High',   date: today },
    { id: uid(), district: 'Bengaluru City', beat: 'Shivajinagar',    shift: 'Afternoon (2PM-10PM)',  officer: 'Suresh D',      rank: 'ASI',       riskLevel: 'High',   date: today },
    { id: uid(), district: 'Bengaluru City', beat: 'Koramangala',     shift: 'Night (10PM-6AM)',      officer: 'Mahesh T',      rank: 'SI',        riskLevel: 'High',   date: today },
    { id: uid(), district: 'Bengaluru City', beat: 'Koramangala',     shift: 'Night (10PM-6AM)',      officer: 'Kavitha R',     rank: 'Constable', riskLevel: 'High',   date: today },
    // Mysuru — today
    { id: uid(), district: 'Mysuru',         beat: 'Devaraja Beat',   shift: 'Morning (6AM-2PM)',     officer: 'Anand Gowda',   rank: 'Inspector', riskLevel: 'Low',    date: today },
    { id: uid(), district: 'Mysuru',         beat: 'Chamaraja Beat',  shift: 'Afternoon (2PM-10PM)',  officer: 'Usha Rani',     rank: 'SI',        riskLevel: 'Low',    date: today },
    { id: uid(), district: 'Mysuru',         beat: 'Nazarbad Beat',   shift: 'Night (10PM-6AM)',      officer: 'Santosh M',     rank: 'HC',        riskLevel: 'Low',    date: today },
    // Belagavi — today
    { id: uid(), district: 'Belagavi',       beat: 'Camp Beat',       shift: 'Morning (6AM-2PM)',     officer: 'Vijay Patil',   rank: 'SI',        riskLevel: 'Medium', date: today },
    { id: uid(), district: 'Belagavi',       beat: 'Tilakwadi',       shift: 'Afternoon (2PM-10PM)',  officer: 'Rekha N',       rank: 'Constable', riskLevel: 'Medium', date: today },
    { id: uid(), district: 'Belagavi',       beat: 'Hindwadi Beat',   shift: 'Night (10PM-6AM)',      officer: 'Girish L',      rank: 'ASI',       riskLevel: 'Medium', date: today },
    // Kalaburagi — today
    { id: uid(), district: 'Kalaburagi',     beat: 'City Beat',       shift: 'Morning (6AM-2PM)',     officer: 'Siddappa K',    rank: 'HC',        riskLevel: 'Medium', date: today },
    { id: uid(), district: 'Kalaburagi',     beat: 'Aland Road',      shift: 'Afternoon (2PM-10PM)',  officer: 'Laxmi Devi',    rank: 'Constable', riskLevel: 'Medium', date: today },
    { id: uid(), district: 'Kalaburagi',     beat: 'Gulbarga Stn',    shift: 'Night (10PM-6AM)',      officer: 'Raju Chavan',   rank: 'SI',        riskLevel: 'Medium', date: today },
    // Shivamogga — today
    { id: uid(), district: 'Shivamogga',     beat: 'Sagar Road',      shift: 'Morning (6AM-2PM)',     officer: 'Deepak Rao',    rank: 'Inspector', riskLevel: 'Low',    date: today },
    { id: uid(), district: 'Shivamogga',     beat: 'KSS Beat',        shift: 'Afternoon (2PM-10PM)',  officer: 'Nirmala B',     rank: 'ASI',       riskLevel: 'Low',    date: today },
    { id: uid(), district: 'Shivamogga',     beat: 'Vinoba Nagar',    shift: 'Night (10PM-6AM)',      officer: 'Harish J',      rank: 'HC',        riskLevel: 'Low',    date: today },
    // Raichur — today (intentionally understaffed to trigger warning)
    { id: uid(), district: 'Raichur',        beat: 'Devadurga Beat',  shift: 'Morning (6AM-2PM)',     officer: 'Abdul Raheem',  rank: 'SI',        riskLevel: 'High',   date: today },
    { id: uid(), district: 'Raichur',        beat: 'Sindhanur Road',  shift: 'Afternoon (2PM-10PM)',  officer: 'Bheem Reddy',   rank: 'Constable', riskLevel: 'High',   date: today },
    { id: uid(), district: 'Raichur',        beat: 'Manvi Beat',      shift: 'Night (10PM-6AM)',      officer: 'Yellamma S',    rank: 'ASI',       riskLevel: 'High',   date: today },
  ]
}

// ─── Inline add-form state ────────────────────────────────────────────────────

interface AddFormState {
  officer: string
  rank:    RankLabel
  beat:    string
}

const emptyAddForm = (): AddFormState => ({ officer: '', rank: 'Constable', beat: '' })

// ─── Sub-components ───────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: string }) {
  const colors: Record<string, string> = {
    Inspector: 'text-violet-400 bg-violet-500/10',
    SI:        'text-blue-400 bg-blue-500/10',
    ASI:       'text-cyan-400 bg-cyan-500/10',
    HC:        'text-teal-400 bg-teal-500/10',
    Constable: 'text-gray-400 bg-gray-700',
  }
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${colors[rank] ?? 'text-gray-400 bg-gray-700'}`}>
      {rank}
    </span>
  )
}

function OfficerCard({ slot, onRemove }: { slot: ShiftSlot; onRemove: () => void }) {
  return (
    <div className="flex items-start justify-between bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 group">
      <div className="flex items-start gap-2 min-w-0">
        <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${RISK_DOT[slot.riskLevel]}`} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{slot.officer}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <RankBadge rank={slot.rank} />
            <span className="text-[10px] text-gray-500 truncate">{slot.beat}</span>
          </div>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all"
        title="Remove officer"
      >
        <X size={14} />
      </button>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SchedulerPage() {
  const [roster, setRoster] = useState<ShiftSlot[]>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) return JSON.parse(raw) as ShiftSlot[]
    } catch { /* ignore */ }
    return buildInitialRoster()
  })

  const [weekOffset,      setWeekOffset]      = useState(0)
  const [activeDistrict,  setActiveDistrict]  = useState<string>(DISTRICTS[0])
  const [selectedDate,    setSelectedDate]    = useState<string>(todayISO())
  const [openForm,        setOpenForm]        = useState<string | null>(null)
  const [formState,       setFormState]       = useState<AddFormState>(emptyAddForm())

  const TODAY    = todayISO()
  const weekDates = weekDatesFor(weekOffset)

  // When week changes, keep selectedDate in range
  useEffect(() => {
    if (!weekDates.includes(selectedDate)) {
      setSelectedDate(weekDates[0])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset])

  // Persist roster
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(roster))
  }, [roster])

  // ── Derived ─────────────────────────────────────────────────────────────────

  function slotsFor(district: string, shift: ShiftLabel) {
    return roster.filter(
      s => s.district === district && s.shift === shift && s.date === selectedDate
    )
  }

  function totalForDate() {
    return roster.filter(s => s.date === selectedDate).length
  }

  function understaffedHighRisk() {
    let count = 0
    for (const d of DISTRICTS) {
      if (DISTRICT_RISK[d] !== 'High') continue
      for (const sh of SHIFTS) {
        if (slotsFor(d, sh).length < 2) count++
      }
    }
    return count
  }

  function districtsCoveredOnDate() {
    return new Set(roster.filter(s => s.date === selectedDate).map(s => s.district)).size
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  function handleAddOfficer(district: string, shift: ShiftLabel) {
    if (!formState.officer.trim() || !formState.beat.trim()) return
    const newSlot: ShiftSlot = {
      id:        uid(),
      district,
      beat:      formState.beat.trim(),
      shift,
      officer:   formState.officer.trim(),
      rank:      formState.rank,
      riskLevel: DISTRICT_RISK[district] as ShiftSlot['riskLevel'],
      date:      selectedDate,
    }
    setRoster(r => [...r, newSlot])
    setOpenForm(null)
    setFormState(emptyAddForm())
  }

  function handleRemove(id: string) {
    setRoster(r => r.filter(s => s.id !== id))
  }

  function openAddForm(key: string) {
    setOpenForm(key)
    setFormState(emptyAddForm())
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const riskLevel = DISTRICT_RISK[activeDistrict]

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/20">
              <Clock className="text-blue-400" size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Patrol Shift Scheduler</h1>
              <p className="text-sm text-gray-400 mt-0.5">Assign officers to beats · Viewing <span className="text-white font-medium">{fmtDate(selectedDate)}</span></p>
            </div>
          </div>
          <div className="text-xs text-gray-500 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 flex items-center gap-2">
            <Calendar size={13} />
            <span>Week: {weekDates[0].slice(5)} – {weekDates[6].slice(5)}</span>
          </div>
        </div>

        {/* ── Stats Bar ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Officers on Selected Day',     value: totalForDate(),            icon: <Users size={16} className="text-blue-400" />,     color: 'border-blue-500/20' },
            { label: 'High-Risk Shifts Understaffed',value: understaffedHighRisk(),     icon: <AlertTriangle size={16} className="text-red-400" />,  color: understaffedHighRisk() > 0 ? 'border-red-500/40' : 'border-gray-800' },
            { label: 'Districts Covered',            value: districtsCoveredOnDate(),   icon: <Shield size={16} className="text-emerald-400" />,  color: 'border-emerald-500/20' },
            { label: 'Selected Date',                value: fmtDate(selectedDate),      icon: <Calendar size={16} className="text-violet-400" />, color: 'border-violet-500/20' },
          ].map(stat => (
            <div key={stat.label} className={`bg-gray-900 border ${stat.color} rounded-xl p-4 flex items-center gap-3`}>
              <div className="p-2 bg-gray-800 rounded-lg">{stat.icon}</div>
              <div className="min-w-0">
                <p className="text-xs text-gray-500 leading-tight">{stat.label}</p>
                <p className="text-lg font-bold text-white mt-0.5 truncate">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Week calendar with prev/next navigation ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Navigation row */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
            <button
              onClick={() => setWeekOffset(w => w - 1)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg px-3 py-1.5 transition-colors"
            >
              <ChevronLeft size={13} /> Prev Week
            </button>

            <button
              onClick={() => { setWeekOffset(0); setSelectedDate(TODAY) }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                weekOffset === 0
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
              }`}
            >
              This Week
            </button>

            <button
              onClick={() => setWeekOffset(w => w + 1)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg px-3 py-1.5 transition-colors"
            >
              Next Week <ChevronRight size={13} />
            </button>
          </div>

          {/* Day columns — clickable */}
          <div className="grid grid-cols-7 divide-x divide-gray-800">
            {weekDates.map((date, i) => {
              const isToday    = date === TODAY
              const isSelected = date === selectedDate
              const slotCount  = roster.filter(s => s.date === date).length

              return (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`py-3 px-1 text-center transition-colors w-full ${
                    isSelected
                      ? 'bg-blue-600/20 ring-inset ring-1 ring-blue-500/60'
                      : isToday
                        ? 'bg-blue-500/8 hover:bg-gray-800/60'
                        : 'hover:bg-gray-800/60'
                  }`}
                >
                  <p className={`text-xs font-semibold ${isSelected ? 'text-blue-300' : isToday ? 'text-blue-400' : 'text-gray-500'}`}>
                    {DAYS[i]}
                  </p>
                  <p className={`text-sm font-bold mt-0.5 ${isSelected ? 'text-white' : isToday ? 'text-blue-300' : 'text-gray-300'}`}>
                    {date.slice(8)}
                  </p>
                  {/* Officer count pill */}
                  <div className="mt-1.5 flex justify-center">
                    {slotCount > 0 ? (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        isSelected ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-400'
                      }`}>
                        {slotCount}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-700">—</span>
                    )}
                  </div>
                  {isToday && !isSelected && (
                    <div className="mt-1 mx-auto h-1 w-1 rounded-full bg-blue-400" />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── District Selector ── */}
        <div className="flex flex-wrap gap-2">
          {DISTRICTS.map(d => {
            const risk     = DISTRICT_RISK[d]
            const isActive = activeDistrict === d
            const count    = slotsFor(d, 'Morning (6AM-2PM)').length +
                             slotsFor(d, 'Afternoon (2PM-10PM)').length +
                             slotsFor(d, 'Night (10PM-6AM)').length
            return (
              <button
                key={d}
                onClick={() => setActiveDistrict(d)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                  isActive
                    ? 'bg-blue-500/15 border-blue-500/50 text-blue-300'
                    : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${RISK_DOT[risk]}`} />
                {d}
                {count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-blue-500/30 text-blue-200' : 'bg-gray-700 text-gray-500'}`}>
                    {count}
                  </span>
                )}
                <ChevronRight size={12} className={isActive ? 'text-blue-400' : 'text-gray-600'} />
              </button>
            )
          })}
        </div>

        {/* ── District Risk Banner ── */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${RISK_BADGE[riskLevel]}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${RISK_DOT[riskLevel]}`} />
          <span className="text-sm font-semibold">{activeDistrict}</span>
          <span className="text-xs opacity-70">— Risk Level: {riskLevel}</span>
          <span className="text-xs opacity-60 ml-1">· {fmtDate(selectedDate)}</span>
          {riskLevel === 'High' && (
            <span className="ml-auto flex items-center gap-1 text-xs text-red-400">
              <AlertTriangle size={12} />
              High-risk district — ensure ≥2 officers per shift
            </span>
          )}
        </div>

        {/* ── 3-Shift Grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SHIFTS.map(shift => {
            const officers     = slotsFor(activeDistrict, shift)
            const formKey      = `${activeDistrict}__${shift}`
            const isFormOpen   = openForm === formKey
            const isUnderstaffed = riskLevel === 'High' && officers.length < 2

            return (
              <div key={shift} className="bg-gray-900 border border-gray-800 rounded-xl flex flex-col">
                {/* Shift header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{SHIFT_ICONS[shift]}</span>
                    <div>
                      <p className="text-sm font-semibold text-white">{shift.split(' ')[0]}</p>
                      <p className="text-[11px] text-gray-500">{shift.match(/\(([^)]+)\)/)?.[1]}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isUnderstaffed && (
                      <span title="Understaffed!">
                        <AlertTriangle size={14} className="text-red-400 animate-pulse" />
                      </span>
                    )}
                    <span className="text-xs bg-gray-800 text-gray-400 rounded-full px-2 py-0.5">
                      {officers.length}
                    </span>
                  </div>
                </div>

                {/* Officer cards */}
                <div className="flex-1 p-3 space-y-2 min-h-[80px]">
                  {officers.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-4">No officers assigned for {fmtDate(selectedDate)}</p>
                  ) : (
                    officers.map(slot => (
                      <OfficerCard key={slot.id} slot={slot} onRemove={() => handleRemove(slot.id)} />
                    ))
                  )}

                  {isUnderstaffed && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-red-400">
                      <AlertTriangle size={12} />
                      <span>Needs {2 - officers.length} more officer{2 - officers.length > 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>

                {/* Inline add form */}
                {isFormOpen ? (
                  <div className="border-t border-gray-800 p-3 space-y-2 bg-gray-950/50 rounded-b-xl">
                    <p className="text-[10px] text-gray-500 font-medium">Adding for {fmtDate(selectedDate)}</p>
                    <input
                      type="text"
                      placeholder="Officer name"
                      value={formState.officer}
                      onChange={e => setFormState(f => ({ ...f, officer: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                    />
                    <select
                      value={formState.rank}
                      onChange={e => setFormState(f => ({ ...f, rank: e.target.value as RankLabel }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                      {RANKS.map(r => <option key={r}>{r}</option>)}
                    </select>
                    <input
                      type="text"
                      placeholder="Beat name"
                      value={formState.beat}
                      onChange={e => setFormState(f => ({ ...f, beat: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAddOfficer(activeDistrict, shift)}
                        disabled={!formState.officer.trim() || !formState.beat.trim()}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg py-1.5 transition-colors"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => setOpenForm(null)}
                        className="px-3 bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 pt-0">
                    <button
                      onClick={() => openAddForm(formKey)}
                      className="w-full flex items-center justify-center gap-1.5 border border-dashed border-gray-700 hover:border-blue-500/50 hover:bg-blue-500/5 text-gray-500 hover:text-blue-400 rounded-lg py-2 text-xs font-medium transition-all"
                    >
                      <Plus size={13} />
                      Add Officer for {fmtDate(selectedDate)}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}
