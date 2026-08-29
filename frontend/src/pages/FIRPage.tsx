import { useState, useEffect, useCallback, useRef } from 'react'
import { useDemoStore } from '@/store/demo'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { apiClient } from '@/lib/api'
import {
  PlusCircle, Search, FileText, Loader2, ChevronRight, Printer,
  User, Users, Scale, AlertTriangle, CheckCircle2, X, Eye,
  ArrowLeft, ArrowRight, ChevronDown, MapPin, Database, Save,
  WifiOff, Trash2, Clock, CheckSquare, Building2,
} from 'lucide-react'

// ─── Static Reference Data ─────────────────────────────────────
const DISTRICTS = [
  { id: 5,  name: 'Bengaluru City' },    { id: 6,  name: 'Bengaluru District' },
  { id: 7,  name: 'Bengaluru South' },   { id: 29, name: 'Mysuru City' },
  { id: 30, name: 'Mysuru District' },   { id: 14, name: 'Davanagere' },
  { id: 32, name: 'Shivamogga' },        { id: 15, name: 'Dharwad' },
  { id: 19, name: 'Hubballi-Dharwad' },  { id: 3,  name: 'Belagavi City' },
  { id: 4,  name: 'Belagavi District' }, { id: 28, name: 'Mangaluru City' },
  { id: 13, name: 'Dakshina Kannada' },  { id: 21, name: 'Kalaburagi' },
  { id: 22, name: 'Kalaburagi City' },   { id: 31, name: 'Raichur' },
  { id: 2,  name: 'Ballari' },           { id: 1,  name: 'Bagalkot' },
  { id: 37, name: 'Vijayapur' },         { id: 38, name: 'Yadgir' },
  { id: 8,  name: 'Bidar' },             { id: 26, name: 'Koppal' },
  { id: 27, name: 'Mandya' },            { id: 17, name: 'Hassan' },
  { id: 18, name: 'Haveri' },            { id: 16, name: 'Gadag' },
  { id: 33, name: 'Tumakuru' },          { id: 10, name: 'Chickballapura' },
  { id: 25, name: 'Kolar' },             { id: 20, name: 'K.G.F' },
  { id: 9,  name: 'Chamarajanagar' },    { id: 11, name: 'Chikkamagaluru' },
  { id: 12, name: 'Chitradurga' },       { id: 34, name: 'Udupi' },
  { id: 35, name: 'Uttara Kannada' },    { id: 24, name: 'Kodagu' },
  { id: 36, name: 'Vijayanagara' },      { id: 23, name: 'Karnataka Railways' },
]

const CRIME_HEADS = [
  { id: 1,  name: 'Crimes Against Body' },
  { id: 2,  name: 'Crimes Against Property' },
  { id: 3,  name: 'Crimes Against Women' },
  { id: 4,  name: 'Crimes Against Children' },
  { id: 5,  name: 'Crimes Against SC/ST' },
  { id: 6,  name: 'Cyber Crimes' },
  { id: 7,  name: 'Economic Offences' },
  { id: 8,  name: 'Special & Local Laws' },
  { id: 9,  name: 'Crimes Against State' },
  { id: 10, name: 'Public Order Crimes' },
  { id: 11, name: 'Road Accidents' },
  { id: 12, name: 'Narcotics (NDPS)' },
]

const CRIME_SUB_HEADS: Record<number, { id: number; name: string }[]> = {
  1:  [{ id:101, name:'Murder' }, { id:102, name:'Culpable Homicide' }, { id:103, name:'Attempt to Murder' }, { id:104, name:'Kidnapping & Abduction' }, { id:105, name:'Hurt / GH' }, { id:106, name:'Robbery / Dacoity' }],
  2:  [{ id:201, name:'Robbery' }, { id:202, name:'Dacoity' }, { id:203, name:'Theft' }, { id:204, name:'Burglary' }, { id:205, name:'Vehicle Theft' }, { id:206, name:'Cheating' }, { id:207, name:'Criminal Breach of Trust' }],
  3:  [{ id:301, name:'Rape' }, { id:302, name:'Assault on Women' }, { id:303, name:'Dowry Death' }, { id:304, name:'Domestic Violence' }, { id:305, name:'Stalking' }, { id:306, name:'Sexual Harassment' }, { id:307, name:'Human Trafficking' }],
  4:  [{ id:401, name:'POCSO' }, { id:402, name:'Child Kidnapping' }, { id:403, name:'Child Labour' }, { id:404, name:'Infanticide' }],
  5:  [{ id:501, name:'SC/ST Atrocity' }, { id:502, name:'Murder of SC/ST' }],
  6:  [{ id:601, name:'Online Fraud' }, { id:602, name:'Hacking' }, { id:603, name:'Identity Theft' }, { id:604, name:'Cyberstalking' }],
  7:  [{ id:701, name:'Bank Fraud' }, { id:702, name:'Money Laundering' }, { id:703, name:'Counterfeiting' }],
  8:  [{ id:801, name:'Arms Act' }, { id:802, name:'Excise Act' }, { id:803, name:'KP Act' }, { id:804, name:'Gambling' }],
  9:  [{ id:901, name:'Sedition' }, { id:902, name:'Terrorist Activity' }],
  10: [{ id:1001, name:'Unlawful Assembly' }, { id:1002, name:'Rioting' }, { id:1003, name:'Communal Violence' }],
  11: [{ id:1101, name:'Fatal Accident' }, { id:1102, name:'Non-Fatal Accident' }, { id:1103, name:'Drunk Driving' }],
  12: [{ id:1201, name:'NDPS Possession' }, { id:1202, name:'NDPS Trafficking' }, { id:1203, name:'NDPS Consumption' }],
}

const ACT_SECTIONS = [
  // BNS 2023 — Bharatiya Nyaya Sanhita (replaces IPC)
  { act: 'BNS',       sections: [
    '103',   // Murder (= IPC 302)
    '105',   // Culpable Homicide not amounting to Murder (= IPC 304)
    '107',   // Abetment of suicide (= IPC 306)
    '109',   // Attempt to murder (= IPC 307)
    '115',   // Voluntarily causing hurt (= IPC 323)
    '116',   // Voluntarily causing grievous hurt (= IPC 325)
    '117',   // Causing grievous hurt with dangerous weapons (= IPC 326)
    '118',   // Causing hurt by act endangering life
    '119',   // Causing hurt by poison etc
    '121',   // Assault / criminal force (= IPC 352)
    '124',   // Kidnapping / abduction (= IPC 363)
    '127',   // Abduction for murder (= IPC 364)
    '130',   // Trafficking of person (= IPC 370)
    '137',   // Robbery (= IPC 392)
    '138',   // Dacoity (= IPC 395)
    '140',   // Theft (= IPC 379)
    '305',   // House-breaking (= IPC 445/446)
    '316',   // Cheating (= IPC 420)
    '318',   // Forgery (= IPC 463)
    '319',   // Forgery for purpose of cheating (= IPC 468)
    '308',   // Extortion (= IPC 383)
    '309',   // Putting in fear of death (= IPC 386)
    '326',   // Mischief by fire (= IPC 436)
    '332',   // Criminal trespass (= IPC 441)
    '351',   // Criminal intimidation (= IPC 503)
    '352',   // Intentional insult (= IPC 504)
    '353',   // Statements conducing to public mischief (= IPC 505)
    '356',   // Defamation (= IPC 499)
    '57',    // Sedition / disloyalty (= IPC 124A, modified)
    '111',   // Organised crime
    '113',   // Terrorist act
    '64',    // Rape (= IPC 376)
    '65',    // Rape on woman under 12 / 16
    '66',    // Punishment for rape (= IPC 376)
    '70',    // Gang rape (= IPC 376D)
    '74',    // Assault or use of criminal force with intent to disrobe (= IPC 354B)
    '75',    // Stalking (= IPC 354D)
    '76',    // Voyeurism (= IPC 354C)
    '79',    // Cruelty — dowry / harassment (= IPC 498A)
    '80',    // Dowry death (= IPC 304B)
    '84',    // Abetment of suicide of married woman (= IPC 306)
    '85',    // Dishonour killing / related offences
    '152',   // Endangering sovereignty / integrity
  ]},
  // BNSS 2023 — Bharatiya Nagarik Suraksha Sanhita (procedural, replaces CrPC)
  { act: 'BNSS',      sections: ['173','176','177','178','179','180','181','187','193','197','200','204','209','210','218','227','229'] },
  // NDPS Act 1985
  { act: 'NDPS',      sections: ['8','15','20','21','22','25','27','27A','29','37'] },
  // POCSO Act 2012
  { act: 'POCSO',     sections: ['3','4','5','6','7','8','9','10','11','12','13','14','15'] },
  // SC/ST Prevention of Atrocities Act 1989
  { act: 'SC/ST POA', sections: ['3(1)(a)','3(1)(b)','3(1)(c)','3(1)(d)','3(1)(e)','3(1)(r)','3(1)(s)','3(2)(v)','3(2)(va)','4','14A'] },
  // IT Act 2000
  { act: 'IT Act',    sections: ['43','65','66','66A','66B','66C','66D','66E','66F','67','67A','67B','72','72A'] },
  // Arms Act 1959
  { act: 'Arms Act',  sections: ['3','4','5','7','25','26','27','29','30'] },
  // Karnataka Police Act 1963
  { act: 'KP Act',    sections: ['70','79','88','94','95'] },
  // IPC (legacy — for cases registered before 1 Jul 2024)
  { act: 'IPC',       sections: ['302','307','304','304B','306','376','376D','363','364','366','354','354A','354D','395','396','379','380','381','392','393','420','406','498A','326','325','324','323','504','506','341','147','148','149','153A','489A'] },
]

const GRAVITY_OPTIONS = [
  { id:1, name:'Heinous' }, { id:2, name:'Serious' },
  { id:3, name:'Non-Heinous' }, { id:4, name:'Minor' },
]
const GENDERS     = [{ id:1, name:'Male' }, { id:2, name:'Female' }, { id:3, name:'Transgender' }]
const RELIGIONS   = [{ id:1, name:'Hindu' }, { id:2, name:'Muslim' }, { id:3, name:'Christian' }, { id:4, name:'Sikh' }, { id:5, name:'Jain' }, { id:6, name:'Buddhist' }, { id:7, name:'Other' }]
const OCCUPATIONS = [{ id:1, name:'Farmer' }, { id:2, name:'Government Employee' }, { id:3, name:'Business' }, { id:4, name:'Student' }, { id:5, name:'Labour' }, { id:6, name:'Retired' }, { id:7, name:'Housewife' }, { id:8, name:'Professional' }, { id:9, name:'Other' }]
const CASTES      = [{ id:1, name:'Scheduled Caste' }, { id:2, name:'Scheduled Tribe' }, { id:3, name:'Other Backward Class' }, { id:4, name:'General / Unreserved' }, { id:5, name:'Vokkaliga' }, { id:6, name:'Lingayat' }, { id:7, name:'Kuruba' }, { id:8, name:'Brahmin' }, { id:9, name:'Muslim OBC' }, { id:10, name:'Christian' }, { id:12, name:'Other' }]
const CASE_CATEGORIES = [
  { id:1, code:'1', name:'FIR' },
  { id:2, code:'3', name:'UDR' },
  { id:3, code:'4', name:'PAR' },
  { id:4, code:'8', name:'Zero FIR' },
  { id:5, code:'9', name:'NC (Non-Cognizable)' },
]

// BNS section descriptions for the UI tooltip
const BNS_DESCRIPTIONS: Record<string, string> = {
  '103':'Murder', '105':'Culpable Homicide', '107':'Abetment of Suicide',
  '109':'Attempt to Murder', '115':'Hurt', '116':'Grievous Hurt',
  '117':'GH — Dangerous Weapon', '121':'Assault / Criminal Force',
  '124':'Kidnapping', '127':'Abduction for Murder', '130':'Trafficking',
  '137':'Robbery', '138':'Dacoity', '140':'Theft', '316':'Cheating',
  '308':'Extortion', '332':'Criminal Trespass', '351':'Criminal Intimidation',
  '64':'Rape', '70':'Gang Rape', '75':'Stalking', '79':'Cruelty / Dowry Harassment',
  '80':'Dowry Death', '111':'Organised Crime', '113':'Terrorist Act',
  '57':'Sedition (Modified)',
}

// ─── Local-storage key ──────────────────────────────────────────
const LS_KEY = 'vv_firs_local'

// ─── Types ─────────────────────────────────────────────────────
interface PersonEntry {
  name: string; age: string; genderId: number
  occupationId?: number; religionId?: number; casteId?: number
  isPolice?: boolean; personId?: string
  // Extended fields
  fatherName?: string; address?: string; mobile?: string
  aadhaar?: string; nativity?: string; education?: string
  identificationMark?: string
}
interface ActSectionEntry { act: string; section: string }
interface LocalFIR {
  id: string; crime_no: string; case_no: string; monthly_table: string
  crime_registered_date: string; police_station_id: number
  district_name: string; crime_head: string; brief_facts: string
  latitude: number | null; longitude: number | null
  case_status: string; source: 'backend' | 'local'
  created_at: string
  formSnapshot?: FIRFormState  // stored so we can reprint properly
}

interface FIRFormState {
  policeStationId: number; districtId: number; caseCategoryId: number
  gravityOffenceId: number; crimeMajorHeadId: number; crimeMinorHeadId: number
  incidentFromDate: string; incidentToDate: string; infoReceivedDate: string
  latitude: string; longitude: string; briefFacts: string
  actSections: ActSectionEntry[]
  complainants: PersonEntry[]; victims: PersonEntry[]; accused: PersonEntry[]
  // Extended case fields
  placeOfOccurrence: string; propertyDetails: string; vehicleDetails: string
  witnessDetails: string; investigatingOfficer: string; ioRank: string
  firPsName: string; isZeroFIR: boolean; transferredTo: string
}

const emptyPerson  = (): PersonEntry => ({ name: '', age: '', genderId: 1 })
const emptyForm    = (): FIRFormState => ({
  policeStationId: 5, districtId: 5, caseCategoryId: 1, gravityOffenceId: 2,
  crimeMajorHeadId: 1, crimeMinorHeadId: 101,
  incidentFromDate: new Date().toISOString().slice(0, 16),
  incidentToDate: '', infoReceivedDate: new Date().toISOString().slice(0, 16),
  latitude: '', longitude: '', briefFacts: '',
  actSections: [{ act: 'BNS', section: '103' }],
  complainants: [emptyPerson()], victims: [emptyPerson()],
  accused: [{ ...emptyPerson(), personId: 'A1' }],
  placeOfOccurrence: '', propertyDetails: '', vehicleDetails: '',
  witnessDetails: '', investigatingOfficer: '', ioRank: '',
  firPsName: '', isZeroFIR: false, transferredTo: '',
})

// ─── Local-storage helpers ──────────────────────────────────────
function loadLocalFIRs(): LocalFIR[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') }
  catch { return [] }
}
function saveLocalFIR(fir: LocalFIR) {
  const all = loadLocalFIRs()
  // Upsert: replace if id already exists, else prepend
  const exists = all.some(f => f.id === fir.id || f.crime_no === fir.crime_no)
  const updated = exists
    ? all.map(f => (f.id === fir.id || f.crime_no === fir.crime_no) ? { ...f, ...fir } : f)
    : [fir, ...all]
  localStorage.setItem(LS_KEY, JSON.stringify(updated.slice(0, 500)))
}
function upsertLocalFIRFromRow(row: LocalFIR) {
  // Ensures backend FIRs exist in local store so status changes work
  const all = loadLocalFIRs()
  const exists = all.some(f => f.id === row.id || f.crime_no === row.crime_no)
  if (exists) return all
  const updated = [row, ...all]
  localStorage.setItem(LS_KEY, JSON.stringify(updated.slice(0, 500)))
  return updated
}
function updateLocalFIRStatus(id: string, newStatus: string) {
  const all = loadLocalFIRs()
  const updated = all.map(f => f.id === id ? { ...f, case_status: newStatus } : f)
  localStorage.setItem(LS_KEY, JSON.stringify(updated))
  return updated
}
function deleteLocalFIR(id: string) {
  const all = loadLocalFIRs()
  const updated = all.filter(f => f.id !== id)
  localStorage.setItem(LS_KEY, JSON.stringify(updated))
  return updated
}
function genLocalCrimeNo(districtId: number, stationId: number): string {
  const now = new Date()
  const serial = Math.floor(Math.random() * 89999) + 10000
  return `1${districtId.toString().padStart(4, '0')}${stationId.toString().padStart(4, '0')}${now.getFullYear()}${serial}`
}

// ─── Leaflet pin icon ───────────────────────────────────────────
const PIN_ICON = L.divIcon({
  html: `<div style="width:28px;height:28px;background:#ef4444;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,0.5)"></div>`,
  className: '', iconAnchor: [14, 28],
})

// ─── Map click handler ──────────────────────────────────────────
function MapClickHandler({ onPin }: { onPin: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onPin(e.latlng.lat, e.latlng.lng) } })
  return null
}

// ─── FIR Location Map ───────────────────────────────────────────
function FIRLocationMap({ lat, lng, onPin }: {
  lat: string; lng: string; onPin: (lat: number, lng: number) => void
}) {
  const parsedLat = parseFloat(lat) || 15.3173
  const parsedLng = parseFloat(lng) || 75.7139
  const hasPin = !!lat && !!lng

  return (
    <div className="rounded-xl overflow-hidden border border-gray-700" style={{ height: 260 }}>
      <style>{`
        .fir-map .leaflet-container { background:#0f172a !important; cursor:crosshair !important; }
        .fir-map .leaflet-tile { filter:brightness(0.5) saturate(0.5) hue-rotate(180deg) invert(1); }
        .fir-map .leaflet-control-zoom a { background:#1e293b!important;color:#94a3b8!important;border-color:#334155!important; }
        .fir-map .leaflet-control-attribution { background:rgba(15,23,42,0.8)!important;color:#475569!important;font-size:9px; }
      `}</style>
      <div className="fir-map" style={{ height: '100%' }}>
        <MapContainer
          center={[parsedLat, parsedLng]}
          zoom={hasPin ? 13 : 7}
          style={{ width: '100%', height: '100%' }}
          zoomControl={true}
          scrollWheelZoom={true}
          attributionControl={true}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='© <a href="https://openstreetmap.org">OSM</a>'
            maxZoom={18}
          />
          <MapClickHandler onPin={onPin} />
          {hasPin && (
            <Marker position={[parsedLat, parsedLng]} icon={PIN_ICON} />
          )}
        </MapContainer>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────
function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-xs font-medium text-gray-400 mb-1 block">
      {children}{required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  )
}
function SelectField({ value, onChange, children, className = '' }: { value: any; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 appearance-none pr-8 ${className}`}>
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
    </div>
  )
}
function InputField({ value, onChange, placeholder = '', type = 'text', className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 ${className}`} />
  )
}
function PersonCard({ person, index, onChange, onRemove, showOccupation, showCaste, showIsPolice, labelPrefix }: {
  person: PersonEntry; index: number; onChange: (p: PersonEntry) => void; onRemove: () => void
  showOccupation?: boolean; showCaste?: boolean; showIsPolice?: boolean; labelPrefix: string
}) {
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-300">{labelPrefix} #{index + 1}</span>
        <button onClick={onRemove} className="text-gray-600 hover:text-red-400 transition-colors"><X className="h-3.5 w-3.5" /></button>
      </div>
      {/* Row 1 — Core identity */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <FieldLabel required>Full Name</FieldLabel>
          <InputField value={person.name} onChange={v => onChange({ ...person, name: v })} placeholder="Full name as per ID" />
        </div>
        <div>
          <FieldLabel required>Age (yrs)</FieldLabel>
          <InputField value={person.age} onChange={v => onChange({ ...person, age: v })} type="number" placeholder="Years" />
        </div>
      </div>
      {/* Row 2 — Father, gender */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <FieldLabel>Father / Husband Name</FieldLabel>
          <InputField value={person.fatherName ?? ''} onChange={v => onChange({ ...person, fatherName: v })} placeholder="S/o, D/o, W/o" />
        </div>
        <div>
          <FieldLabel required>Gender</FieldLabel>
          <SelectField value={person.genderId} onChange={v => onChange({ ...person, genderId: +v })}>
            {GENDERS.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </SelectField>
        </div>
      </div>
      {/* Row 3 — Mobile, Aadhaar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <FieldLabel>Mobile No.</FieldLabel>
          <InputField value={person.mobile ?? ''} onChange={v => onChange({ ...person, mobile: v })} placeholder="10-digit mobile" />
        </div>
        <div>
          <FieldLabel>Aadhaar No.</FieldLabel>
          <InputField value={person.aadhaar ?? ''} onChange={v => onChange({ ...person, aadhaar: v })} placeholder="XXXX-XXXX-XXXX" />
        </div>
      </div>
      {/* Row 4 — Address */}
      <div>
        <FieldLabel>Address (Residential)</FieldLabel>
        <InputField value={person.address ?? ''} onChange={v => onChange({ ...person, address: v })} placeholder="Door No., Street, Village/City, Taluk, District, PIN" />
      </div>
      {/* Row 5 — Nativity, Education */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <FieldLabel>Nativity / Native Place</FieldLabel>
          <InputField value={person.nativity ?? ''} onChange={v => onChange({ ...person, nativity: v })} placeholder="Village / Town of origin" />
        </div>
        <div>
          <FieldLabel>Education</FieldLabel>
          <InputField value={person.education ?? ''} onChange={v => onChange({ ...person, education: v })} placeholder="e.g. SSLC, PUC, Graduate" />
        </div>
      </div>
      {/* Row 6 — Identification mark */}
      <div>
        <FieldLabel>Identification Marks</FieldLabel>
        <InputField value={person.identificationMark ?? ''} onChange={v => onChange({ ...person, identificationMark: v })} placeholder="e.g. Scar on left cheek, tattoo on right forearm" />
      </div>
      {/* Optional fields */}
      {showOccupation && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <FieldLabel>Occupation</FieldLabel>
            <SelectField value={person.occupationId ?? 9} onChange={v => onChange({ ...person, occupationId: +v })}>
              {OCCUPATIONS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </SelectField>
          </div>
        </div>
      )}
      {showCaste && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <FieldLabel>Religion</FieldLabel>
            <SelectField value={person.religionId ?? 1} onChange={v => onChange({ ...person, religionId: +v })}>
              {RELIGIONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </SelectField>
          </div>
          <div>
            <FieldLabel>Caste / Community</FieldLabel>
            <SelectField value={person.casteId ?? 4} onChange={v => onChange({ ...person, casteId: +v })}>
              {CASTES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
          </div>
        </div>
      )}
      {labelPrefix === 'Accused' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <FieldLabel>Accused Sort ID</FieldLabel>
            <InputField value={person.personId ?? ''} onChange={v => onChange({ ...person, personId: v })} placeholder="A1, A2..." />
          </div>
        </div>
      )}
      {showIsPolice && (
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={!!person.isPolice} onChange={e => onChange({ ...person, isPolice: e.target.checked })}
            className="rounded accent-blue-500" id={`police-${index}`} />
          <label htmlFor={`police-${index}`} className="text-xs text-gray-400">Is Police Officer / Personnel</label>
        </div>
      )}
    </div>
  )
}

// ─── Print FIR ──────────────────────────────────────────────────
function fmtDate(raw: string | undefined | null): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (isNaN(d.getTime())) return raw
  return d.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })
}

function printFIR(fir: any, form: FIRFormState) {
  const esc            = (s: string) => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const crimeNo        = fir?.crime_no ?? 'PENDING'
  const caseNo         = fir?.case_no  ?? '—'
  const registeredDate = fmtDate(fir?.crime_registered_date)
  const caseStatus     = fir?.case_status ?? 'Under Investigation'
  const districtName   = DISTRICTS.find(d => d.id === form.districtId)?.name ?? '—'
  const psName         = form.firPsName || `Station ID: ${form.policeStationId} — ${districtName} District`
  const category       = CASE_CATEGORIES.find(c => c.id === form.caseCategoryId)?.name ?? 'FIR'
  const gravity        = GRAVITY_OPTIONS.find(g => g.id === form.gravityOffenceId)?.name ?? '—'
  const crimeHead      = CRIME_HEADS.find(h => h.id === form.crimeMajorHeadId)?.name ?? '—'
  const subHead        = CRIME_SUB_HEADS[form.crimeMajorHeadId]?.find(s => s.id === form.crimeMinorHeadId)?.name ?? '—'
  const lat            = fir?.latitude  ?? (form.latitude  ? parseFloat(form.latitude)  : null)
  const lng            = fir?.longitude ?? (form.longitude ? parseFloat(form.longitude) : null)
  const gpsText        = lat && lng ? `${Number(lat).toFixed(6)}\u00b0N, ${Number(lng).toFixed(6)}\u00b0E` : 'Not recorded'
  const mapUrl         = lat && lng
    ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`
    : null
  const printDate      = new Date().toLocaleString('en-IN', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })
  const statusColor    = caseStatus.toLowerCase().includes('complet') ? '#166534' : '#854d0e'
  const statusBg       = caseStatus.toLowerCase().includes('complet') ? '#dcfce7' : '#fef9c3'

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>FIR ${crimeNo} \u2014 Karnataka Police</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Times New Roman',serif;font-size:12pt;color:#000;background:#fff;padding:15mm 20mm}
  h1,h2,h3,p,div,td,th{font-family:'Times New Roman',serif}
  /* ── Header ── */
  .header{text-align:center;border-bottom:3px double #000;padding-bottom:12px;margin-bottom:16px}
  .header .emblem{font-size:32px;margin-bottom:6px}
  .header .org{font-size:13pt;font-weight:bold;letter-spacing:3px;text-transform:uppercase}
  .header .sub-org{font-size:9pt;color:#444;margin-top:3px;letter-spacing:.5px}
  .header h1{font-size:18pt;font-weight:bold;letter-spacing:2px;margin-top:8px;text-transform:uppercase;text-decoration:underline}
  .header h2{font-size:9.5pt;font-weight:normal;margin-top:4px;font-style:italic;color:#444}
  .header-meta{display:flex;justify-content:space-between;margin-top:10px;font-size:9.5pt}
  .crime-no-box{border:2px solid #000;padding:4px 18px;font-size:13pt;font-weight:bold;letter-spacing:3px;background:#f9f9f9}
  .status-badge{padding:3px 14px;font-size:9pt;font-weight:bold;border:1px solid;border-radius:3px}
  /* ── Section blocks ── */
  .section{margin-bottom:14px;page-break-inside:avoid}
  .section-title{font-size:9.5pt;font-weight:bold;text-transform:uppercase;letter-spacing:.8px;background:#1a1a1a;color:#fff;padding:4px 10px;margin-bottom:0}
  /* ── Main table ── */
  table.info{width:100%;border-collapse:collapse;font-size:10pt}
  table.info td,table.info th{border:1px solid #555;padding:5px 9px;vertical-align:top}
  table.info th{background:#f0f0f0;font-weight:bold;text-align:left;width:22%;white-space:nowrap}
  table.info td.val{width:28%}
  /* ── Acts table ── */
  table.acts{width:100%;border-collapse:collapse;font-size:10pt;margin-top:0}
  table.acts th{background:#f0f0f0;border:1px solid #555;padding:5px 9px;text-align:left;font-weight:bold}
  table.acts td{border:1px solid #555;padding:5px 9px}
  /* ── Facts box ── */
  .facts-box{border:1px solid #555;padding:10px 12px;min-height:80px;font-size:10.5pt;line-height:1.8;white-space:pre-wrap;font-family:'Times New Roman',serif}
  /* ── Person table ── */
  table.person{width:100%;border-collapse:collapse;font-size:10pt;margin-bottom:8px}
  table.person th{background:#f0f0f0;border:1px solid #555;padding:5px 9px;font-weight:bold;text-align:left}
  table.person td{border:1px solid #555;padding:5px 9px}
  .person-header{background:#ddd;font-weight:bold;padding:5px 9px;border:1px solid #555;border-bottom:none;font-size:10pt}
  /* ── Signature row ── */
  .sig-row{display:table;width:100%;margin-top:36px;border-top:1px solid #000}
  .sig-col{display:table-cell;width:33.33%;text-align:center;padding-top:8px;font-size:9.5pt;padding-left:6px;padding-right:6px;vertical-align:top}
  .sig-line{margin-top:42px;border-top:1px solid #000;padding-top:5px;font-size:9pt}
  .stamp-box{border:2px dashed #aaa;width:82px;height:82px;margin:8px auto 0;display:flex;align-items:center;justify-content:center;font-size:8.5pt;color:#aaa;text-align:center;line-height:1.4}
  /* ── Misc ── */
  .meta-footer{font-size:7.5pt;color:#777;margin-top:16px;text-align:center;border-top:1px solid #ccc;padding-top:6px}
  @media print{
    body{padding:10mm 12mm}
    .no-break{page-break-inside:avoid}
  }
</style></head><body>

<div class="header">
  <div class="emblem">&#9878;</div>
  <div class="org">Karnataka State Police</div>
  <div class="sub-org">&#3221;&#3248;&#3226;&#3277;&#3240;&#3240;&#3240;&#3277; &#3248;&#3240;&#3277;&#3247; &#3228;&#3261;&#3234;&#3265;&#3222;&#3266; &nbsp;&mdash;&nbsp; CCTNS Crime Reporting System</div>
  <h1>${category === 'FIR' ? 'First Information Report' : category}</h1>
  <h2>(Registered under Section 154 Cr.P.C. / Section 173 B.N.S.S. 2023)</h2>
  <div class="header-meta">
    <div class="crime-no-box">Crime No: &nbsp;${crimeNo}</div>
    <div style="text-align:right">
      <div class="status-badge" style="color:${statusColor};background:${statusBg};border-color:${statusColor}">&#9632; ${caseStatus}</div>
      <div style="font-size:8.5pt;color:#555;margin-top:4px">Date: ${registeredDate}</div>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">I. Case Details</div>
  <table class="info">
    <tr>
      <th>Crime Number</th><td class="val"><strong>${crimeNo}</strong></td>
      <th>Case Number</th><td class="val">${caseNo}</td>
    </tr>
    <tr>
      <th>Case Category</th><td>${category}</td>
      <th>Gravity of Offence</th><td>${gravity}</td>
    </tr>
    <tr>
      <th>Crime Major Head</th><td>${crimeHead}</td>
      <th>Crime Sub-Head</th><td>${subHead}</td>
    </tr>
    <tr>
      <th>District</th><td>${districtName}</td>
      <th>Police Station</th><td>${psName}</td>
    </tr>
    <tr>
      <th>Date Registered</th><td>${registeredDate}</td>
      <th>Case Status</th><td><strong>${caseStatus}</strong></td>
    </tr>
    <tr>
      <th>Incident From</th><td>${fmtDate(form.incidentFromDate) || '&mdash;'}</td>
      <th>Incident To</th><td>${fmtDate(form.incidentToDate) || '&mdash;'}</td>
    </tr>
    <tr>
      <th>Info Received at PS</th><td>${fmtDate(form.infoReceivedDate) || '&mdash;'}</td>
      <th>GPS Coordinates</th><td>${gpsText}</td>
    </tr>
    <tr>
      <th>Place of Occurrence</th><td colspan="3">${esc(form.placeOfOccurrence) || '&mdash;'}</td>
    </tr>
    ${form.isZeroFIR ? `<tr><th>Zero FIR — Transfer PS</th><td colspan="3"><strong>${esc(form.transferredTo) || 'Not specified'}</strong></td></tr>` : ''}
    ${mapUrl ? `<tr><th>Location Link</th><td colspan="3" style="font-size:9pt;color:#1a56db">${mapUrl}</td></tr>` : ''}
  </table>
</div>

<div class="section">
  <div class="section-title">II. Act &amp; Section(s) Invoked</div>
  ${form.actSections.length === 0
    ? '<p style="font-size:10pt;color:#777;padding:7px 9px;border:1px solid #ccc;font-style:italic">No sections added.</p>'
    : `<table class="acts">
        <tr><th style="width:5%">#</th><th style="width:35%">Act</th><th>Section / Provision</th></tr>
        ${form.actSections.map((s,i) => `<tr><td>${i+1}</td><td><strong>${s.act}</strong></td><td>Section <strong>${s.section}</strong></td></tr>`).join('')}
       </table>`}
</div>

<div class="section">
  <div class="section-title">III. Brief Facts of the Case</div>
  <div class="facts-box">${esc(form.briefFacts) || '(Not provided)'}</div>
</div>

${(form.propertyDetails || form.vehicleDetails || form.witnessDetails) ? `
<div class="section">
  <div class="section-title">III-A. Property, Vehicle &amp; Witness Details</div>
  <table class="info">
    ${form.propertyDetails ? `<tr><th style="width:22%">Property Involved</th><td colspan="3">${esc(form.propertyDetails)}</td></tr>` : ''}
    ${form.vehicleDetails  ? `<tr><th>Vehicle Details</th><td colspan="3">${esc(form.vehicleDetails)}</td></tr>` : ''}
    ${form.witnessDetails  ? `<tr><th>Witness Details</th><td colspan="3" style="white-space:pre-wrap">${esc(form.witnessDetails)}</td></tr>` : ''}
  </table>
</div>` : ''}

<div class="section no-break">
  <div class="section-title">IV. Complainant Details</div>
  ${form.complainants.length === 0
    ? '<p style="font-size:10pt;color:#777;padding:7px 9px;border:1px solid #ccc;font-style:italic">No complainants recorded.</p>'
    : form.complainants.map((c,i) => `
      <div class="person-header">Complainant #${i+1}${c.name ? ' \u2014 ' + c.name : ''}</div>
      <table class="person">
        <tr>
          <th style="width:22%">Full Name</th><td style="width:28%">${esc(c.name)||'&mdash;'}</td>
          <th style="width:22%">Age</th><td>${c.age ? c.age+' years' : '&mdash;'}</td>
        </tr>
        <tr>
          <th>Father / Husband</th><td>${esc(c.fatherName||'')||'&mdash;'}</td>
          <th>Gender</th><td>${GENDERS.find(g=>g.id===c.genderId)?.name||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Mobile</th><td>${esc(c.mobile||'')||'&mdash;'}</td>
          <th>Aadhaar No.</th><td>${esc(c.aadhaar||'')||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Address</th><td colspan="3">${esc(c.address||'')||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Nativity</th><td>${esc(c.nativity||'')||'&mdash;'}</td>
          <th>Education</th><td>${esc(c.education||'')||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Occupation</th><td>${OCCUPATIONS.find(o=>o.id===c.occupationId)?.name||'&mdash;'}</td>
          <th>Religion / Caste</th><td>${RELIGIONS.find(r=>r.id===c.religionId)?.name||'&mdash;'} / ${CASTES.find(ca=>ca.id===c.casteId)?.name||'&mdash;'}</td>
        </tr>
        ${c.identificationMark ? `<tr><th>Identification Marks</th><td colspan="3">${esc(c.identificationMark)}</td></tr>` : ''}
      </table>`).join('')}
</div>

<div class="section no-break">
  <div class="section-title">V. Victim Details</div>
  ${form.victims.length === 0
    ? '<p style="font-size:10pt;color:#777;padding:7px 9px;border:1px solid #ccc;font-style:italic">No victims recorded.</p>'
    : form.victims.map((v,i) => `
      <div class="person-header">Victim #${i+1}${v.name ? ' \u2014 ' + v.name : ''}</div>
      <table class="person">
        <tr>
          <th style="width:22%">Full Name</th><td style="width:28%">${esc(v.name)||'&mdash;'}</td>
          <th style="width:22%">Age</th><td>${v.age ? v.age+' years' : '&mdash;'}</td>
        </tr>
        <tr>
          <th>Father / Husband</th><td>${esc(v.fatherName||'')||'&mdash;'}</td>
          <th>Gender</th><td>${GENDERS.find(g=>g.id===v.genderId)?.name||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Mobile</th><td>${esc(v.mobile||'')||'&mdash;'}</td>
          <th>Aadhaar No.</th><td>${esc(v.aadhaar||'')||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Address</th><td colspan="3">${esc(v.address||'')||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Nativity</th><td>${esc(v.nativity||'')||'&mdash;'}</td>
          <th>Education</th><td>${esc(v.education||'')||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Is Police Officer</th><td>${v.isPolice ? 'Yes \u2014 Police Personnel' : 'No'}</td>
          <th>Identification Marks</th><td>${esc(v.identificationMark||'')||'&mdash;'}</td>
        </tr>
      </table>`).join('')}
</div>

<div class="section no-break">
  <div class="section-title">VI. Accused Details</div>
  ${form.accused.length === 0
    ? '<p style="font-size:10pt;color:#777;padding:7px 9px;border:1px solid #ccc;font-style:italic">No accused recorded.</p>'
    : form.accused.map((a,i) => `
      <div class="person-header">Accused ${a.personId || '#'+(i+1)}${a.name ? ' \u2014 ' + a.name : ' \u2014 Unknown'}</div>
      <table class="person">
        <tr>
          <th style="width:22%">Name</th><td style="width:28%">${esc(a.name)||'<em>Unknown / Not Identified</em>'}</td>
          <th style="width:22%">Accused ID</th><td>${a.personId||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Father / Husband</th><td>${esc(a.fatherName||'')||'&mdash;'}</td>
          <th>Gender</th><td>${GENDERS.find(g=>g.id===a.genderId)?.name||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Age</th><td>${a.age ? a.age+' years' : '&mdash;'}</td>
          <th>Mobile</th><td>${esc(a.mobile||'')||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Aadhaar No.</th><td>${esc(a.aadhaar||'')||'&mdash;'}</td>
          <th>Education</th><td>${esc(a.education||'')||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Address</th><td colspan="3">${esc(a.address||'')||'&mdash;'}</td>
        </tr>
        <tr>
          <th>Nativity</th><td>${esc(a.nativity||'')||'&mdash;'}</td>
          <th>Identification Marks</th><td>${esc(a.identificationMark||'')||'&mdash;'}</td>
        </tr>
      </table>`).join('')}
</div>

${form.investigatingOfficer ? `
<div class="section">
  <div class="section-title">VII. Investigating Officer</div>
  <table class="info">
    <tr>
      <th style="width:22%">IO Name</th><td style="width:28%">${esc(form.investigatingOfficer)}</td>
      <th style="width:22%">IO Rank</th><td>${esc(form.ioRank)||'&mdash;'}</td>
    </tr>
    <tr>
      <th>Police Station</th><td colspan="3">${esc(psName)}</td>
    </tr>
  </table>
</div>` : ''}

<div class="sig-row">
  <div class="sig-col">
    <div style="font-size:9.5pt;font-weight:bold">Informant / Complainant</div>
    <div class="sig-line">Signature / Thumb Impression</div>
  </div>
  <div class="sig-col">
    <div style="font-size:9.5pt;font-weight:bold">Station House Officer${form.investigatingOfficer ? ' / IO' : ''}</div>
    <div class="sig-line">${form.investigatingOfficer ? esc(form.investigatingOfficer) + (form.ioRank ? ', ' + esc(form.ioRank) : '') : 'Name, Rank &amp; Signature'}</div>
  </div>
  <div class="sig-col">
    <div style="font-size:9.5pt;font-weight:bold">Official Seal</div>
    <div class="stamp-box">POLICE<br>STATION<br>SEAL</div>
  </div>
</div>

<div class="meta-footer">
  Printed on: ${printDate} &nbsp;&bull;&nbsp; VigilanteVanguard &mdash; Karnataka State Police Intelligence Platform &nbsp;&bull;&nbsp; Crime No: ${crimeNo}
</div>
</body></html>`

  const w = window.open('', '_blank', 'width=960,height=1200')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 800)
}

const STEPS = [
  { id:1, label:'Case Info', icon:FileText },
  { id:2, label:'Location', icon:MapPin },
  { id:3, label:'Sections', icon:Scale },
  { id:4, label:'Complainant', icon:User },
  { id:5, label:'Victims', icon:AlertTriangle },
  { id:6, label:'Accused', icon:Users },
]

// ─── Main Component ─────────────────────────────────────────────
export default function FIRPage() {
  const [view, setView]               = useState<'list'|'create'|'detail'>('list')
  const [step, setStep]               = useState(1)
  const [search, setSearch]           = useState('')
  const [selectedFir, setSelectedFir] = useState<any>(null)
  const [form, setForm]               = useState<FIRFormState>(emptyForm())
  const [submittedFir, setSubmittedFir] = useState<any>(null)
  const [localFIRs, setLocalFIRs]     = useState<LocalFIR[]>(loadLocalFIRs)
  const qc = useQueryClient()

  // ── Read pre-selected station from demo store (set by StationsPage) ──
  const { selectedStation, setSelectedStation } = useDemoStore()
  useEffect(() => {
    if (selectedStation && view === 'list') {
      const matchedDistrict = DISTRICTS.find(
        d => d.name.toLowerCase().includes(selectedStation.district.toLowerCase().split(' ')[0])
      )
      if (matchedDistrict) {
        setForm(f => ({ ...f, districtId: matchedDistrict.id, policeStationId: selectedStation.id }))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStation])

  const { data: firData, isLoading } = useQuery({
    queryKey: ['firs'],
    queryFn: () => apiClient.get('/fir/', { params: { page:1, page_size:50 } }).then(r => r.data),
    retry: 1,
    staleTime: 30000,
  })

  const createMutation = useMutation({
    mutationFn: (f: FIRFormState) =>
      apiClient.post('/fir/', {
        police_station_id:  f.policeStationId,
        case_category_id:   f.caseCategoryId,
        gravity_offence_id: f.gravityOffenceId,
        crime_major_head_id: f.crimeMajorHeadId,
        crime_minor_head_id: f.crimeMinorHeadId,
        incident_from_date:  f.incidentFromDate,
        incident_to_date:    f.incidentToDate || null,
        latitude:   f.latitude  ? parseFloat(f.latitude)  : null,
        longitude:  f.longitude ? parseFloat(f.longitude) : null,
        brief_facts: f.briefFacts,
        act_sections: f.actSections.map(s => ({ act_id: s.act, section_id: s.section })),
        complainants: f.complainants.map(c => ({ ComplainantName: c.name, AgeYear: c.age ? +c.age : null, GenderID: c.genderId, OccupationID: c.occupationId??9, ReligionID: c.religionId??1, CasteID: c.casteId??4 })),
        victims:     f.victims.map(v => ({ VictimName: v.name, AgeYear: v.age ? +v.age : null, GenderID: v.genderId, VictimPolice: v.isPolice?'1':'0' })),
        accused:     f.accused.map(a => ({ AccusedName: a.name, AgeYear: a.age ? +a.age : null, GenderID: a.genderId, PersonID: a.personId??'' })),
      }).then(r => r.data),
    onSuccess: (data) => {
      const localEntry: LocalFIR = {
        id: String(data.case_master_id), crime_no: data.crime_no, case_no: data.case_no,
        monthly_table: data.monthly_table, crime_registered_date: data.crime_registered_date,
        police_station_id: data.police_station_id,
        district_name: DISTRICTS.find(d => d.id === form.districtId)?.name ?? '',
        crime_head: CRIME_HEADS.find(h => h.id === form.crimeMajorHeadId)?.name ?? '',
        brief_facts: data.brief_facts, latitude: data.latitude, longitude: data.longitude,
        case_status: data.case_status, source: 'backend',
        created_at: new Date().toISOString(),
        formSnapshot: form,
      }
      saveLocalFIR(localEntry)
      setLocalFIRs(loadLocalFIRs())
      qc.invalidateQueries({ queryKey: ['firs'] })
      setSubmittedFir(data)
      setView('detail')
    },
    onError: () => {
      // Backend offline — save locally
      const now = new Date()
      const crimeNo = genLocalCrimeNo(form.districtId, form.policeStationId)
      const table = `fir_${now.getFullYear()}_${String(now.getMonth()+1).padStart(2,'0')}`
      const localData = {
        crime_no: crimeNo, case_no: `${now.getFullYear()}${String(Math.floor(Math.random()*99999)).padStart(5,'0')}`,
        monthly_table: table, crime_registered_date: now.toISOString().split('T')[0],
        police_station_id: form.policeStationId, case_category: 'FIR',
        crime_major_head: CRIME_HEADS.find(h => h.id === form.crimeMajorHeadId)?.name ?? '',
        brief_facts: form.briefFacts, case_status: 'Under Investigation (Local)',
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
        case_master_id: Math.floor(Math.random() * 90000) + 10000,
        created_at: now.toISOString(),
        _offline: true,
      }
      const localEntry: LocalFIR = {
        id: String(localData.case_master_id), crime_no: crimeNo, case_no: localData.case_no,
        monthly_table: table, crime_registered_date: localData.crime_registered_date,
        police_station_id: form.policeStationId,
        district_name: DISTRICTS.find(d => d.id === form.districtId)?.name ?? '',
        crime_head: CRIME_HEADS.find(h => h.id === form.crimeMajorHeadId)?.name ?? '',
        brief_facts: form.briefFacts, latitude: localData.latitude, longitude: localData.longitude,
        case_status: 'Local — Pending Sync', source: 'local',
        created_at: now.toISOString(),
        formSnapshot: form,
      }
      saveLocalFIR(localEntry)
      setLocalFIRs(loadLocalFIRs())
      setSubmittedFir(localData)
      setView('detail')
    },
  })

  // Merge backend + local FIRs for the list view
  const backendRows: any[] = firData?.data ?? []
  const backendCrimeNos = new Set(backendRows.map((f: any) => f.CrimeNo))
  const merged: LocalFIR[] = [
    ...backendRows.map((f: any): LocalFIR => ({
      id: String(f.CaseMasterID ?? f.CrimeNo), crime_no: f.CrimeNo ?? '',
      case_no: f.CaseNo ?? '', monthly_table: f.MonthlyTable ?? '',
      crime_registered_date: f.CrimeRegisteredDate ?? '',
      police_station_id: f.PoliceStationID ?? 0, district_name: '',
      crime_head: CRIME_HEADS.find(h => h.id === f.CrimeMajorHeadID)?.name ?? '',
      brief_facts: f.BriefFacts ?? '', latitude: f.Latitude ?? null,
      longitude: f.Longitude ?? null, case_status: 'Under Investigation',
      source: 'backend', created_at: f.CrimeRegisteredDate ?? '',
    })),
    ...localFIRs.filter(lf => !backendCrimeNos.has(lf.crime_no)),
  ]

  const filtered = merged.filter(f =>
    !search ||
    f.crime_no.toLowerCase().includes(search.toLowerCase()) ||
    f.brief_facts.toLowerCase().includes(search.toLowerCase()) ||
    f.district_name.toLowerCase().includes(search.toLowerCase())
  )

  function updatePerson(list: PersonEntry[], i: number, val: PersonEntry) { return list.map((p,idx) => idx===i?val:p) }
  function removePerson(list: PersonEntry[], i: number) { return list.filter((_,idx) => idx!==i) }

  const canProceed = step===1 ? !!form.briefFacts.trim() : true

  // ─── CREATE WIZARD VIEW ──────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="p-6 space-y-5 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => { setView('list'); setStep(1); setForm(emptyForm()) }}
              className="text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">Register New FIR</h1>
              <p className="text-xs text-gray-500 mt-0.5">Step {step} of {STEPS.length} — {STEPS[step-1].label}</p>
            </div>
          </div>
          {/* Step indicator */}
          <div className="hidden sm:flex items-center gap-0.5">
            {STEPS.map((s, i) => {
              const Icon = s.icon
              const done = step > s.id
              const active = step === s.id
              return (
                <div key={s.id} className="flex items-center">
                  <div className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${active?'bg-blue-600 text-white':done?'bg-green-900/40 text-green-400':'bg-gray-800 text-gray-500'}`}>
                    {done ? <CheckCircle2 className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                    <span className="hidden xl:inline">{s.label}</span>
                  </div>
                  {i < STEPS.length-1 && <ChevronRight className="h-3 w-3 text-gray-700 mx-0.5" />}
                </div>
              )
            })}
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">

          {/* ── Step 1: Case Info ── */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-sm font-semibold text-white border-b border-gray-800 pb-2">Case Information</h2>

              {/* Sub-section: Registration */}
              <div>
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">Registration Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>District</FieldLabel>
                    <SelectField value={form.districtId} onChange={v => setForm(f => ({ ...f, districtId: +v }))}>
                      {DISTRICTS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </SelectField>
                  </div>
                  <div>
                    <FieldLabel>Police Station Name</FieldLabel>
                    <InputField value={form.firPsName} onChange={v => setForm(f => ({ ...f, firPsName: v }))} placeholder="e.g. Cubbon Park PS, Bengaluru City" />
                  </div>
                  <div>
                    <FieldLabel required>Case Category</FieldLabel>
                    <SelectField value={form.caseCategoryId} onChange={v => {
                      const isZero = CASE_CATEGORIES.find(c => c.id === +v)?.code === '8'
                      setForm(f => ({ ...f, caseCategoryId: +v, isZeroFIR: isZero }))
                    }}>
                      {CASE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name} — Cat. {c.code}</option>)}
                    </SelectField>
                  </div>
                  {form.isZeroFIR && (
                    <div>
                      <FieldLabel>Transfer to PS (Zero FIR)</FieldLabel>
                      <InputField value={form.transferredTo} onChange={v => setForm(f => ({ ...f, transferredTo: v }))} placeholder="PS having jurisdiction" />
                    </div>
                  )}
                  <div>
                    <FieldLabel required>Gravity of Offence</FieldLabel>
                    <SelectField value={form.gravityOffenceId} onChange={v => setForm(f => ({ ...f, gravityOffenceId: +v }))}>
                      {GRAVITY_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </SelectField>
                  </div>
                </div>
              </div>

              {/* Sub-section: Crime Classification */}
              <div>
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">Crime Classification</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>Crime Major Head</FieldLabel>
                    <SelectField value={form.crimeMajorHeadId} onChange={v => setForm(f => ({ ...f, crimeMajorHeadId: +v, crimeMinorHeadId: CRIME_SUB_HEADS[+v]?.[0]?.id ?? 0 }))}>
                      {CRIME_HEADS.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </SelectField>
                  </div>
                  <div>
                    <FieldLabel>Crime Sub-Head</FieldLabel>
                    <SelectField value={form.crimeMinorHeadId} onChange={v => setForm(f => ({ ...f, crimeMinorHeadId: +v }))}>
                      {(CRIME_SUB_HEADS[form.crimeMajorHeadId] ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </SelectField>
                  </div>
                </div>
              </div>

              {/* Sub-section: Date & Time */}
              <div>
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">Dates & Times</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>Incident Date & Time (From)</FieldLabel>
                    <InputField type="datetime-local" value={form.incidentFromDate} onChange={v => setForm(f => ({ ...f, incidentFromDate: v }))} />
                  </div>
                  <div>
                    <FieldLabel>Incident Date & Time (To)</FieldLabel>
                    <InputField type="datetime-local" value={form.incidentToDate} onChange={v => setForm(f => ({ ...f, incidentToDate: v }))} />
                  </div>
                  <div>
                    <FieldLabel>Info Received at PS</FieldLabel>
                    <InputField type="datetime-local" value={form.infoReceivedDate} onChange={v => setForm(f => ({ ...f, infoReceivedDate: v }))} />
                  </div>
                </div>
              </div>

              {/* Sub-section: Place of Occurrence */}
              <div>
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">Place of Occurrence</p>
                <InputField value={form.placeOfOccurrence} onChange={v => setForm(f => ({ ...f, placeOfOccurrence: v }))}
                  placeholder="Specific address / landmark where the offence occurred" />
              </div>

              {/* Sub-section: Brief Facts */}
              <div>
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">Brief Facts</p>
                <textarea value={form.briefFacts} onChange={e => setForm(f => ({ ...f, briefFacts: e.target.value }))} rows={5}
                  placeholder="Describe the incident in full detail — date, time, location, what happened, how, witnesses..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none" />
                <p className="text-xs text-gray-600 mt-1">{form.briefFacts.length} characters</p>
              </div>

              {/* Sub-section: Property / Vehicle / Witness */}
              <div>
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">Property, Vehicle & Witness Details</p>
                <div className="space-y-3">
                  <div>
                    <FieldLabel>Property Involved (if any)</FieldLabel>
                    <InputField value={form.propertyDetails} onChange={v => setForm(f => ({ ...f, propertyDetails: v }))}
                      placeholder="Description, estimated value, items seized/stolen..." />
                  </div>
                  <div>
                    <FieldLabel>Vehicle Details (if any)</FieldLabel>
                    <InputField value={form.vehicleDetails} onChange={v => setForm(f => ({ ...f, vehicleDetails: v }))}
                      placeholder="Vehicle type, reg. no., colour, make/model..." />
                  </div>
                  <div>
                    <FieldLabel>Witness Details</FieldLabel>
                    <textarea value={form.witnessDetails} onChange={e => setForm(f => ({ ...f, witnessDetails: e.target.value }))} rows={2}
                      placeholder="Name, address, contact of each witness..."
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none" />
                  </div>
                </div>
              </div>

              {/* Sub-section: Investigating Officer */}
              <div>
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">Investigating Officer (IO)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>IO Name</FieldLabel>
                    <InputField value={form.investigatingOfficer} onChange={v => setForm(f => ({ ...f, investigatingOfficer: v }))} placeholder="Full name of IO" />
                  </div>
                  <div>
                    <FieldLabel>IO Rank</FieldLabel>
                    <InputField value={form.ioRank} onChange={v => setForm(f => ({ ...f, ioRank: v }))} placeholder="e.g. Sub-Inspector, Inspector" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Location Map ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                <h2 className="text-sm font-semibold text-white">Incident Location</h2>
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <MapPin className="h-3 w-3" />Click anywhere on the map to pin the exact location
                </span>
              </div>

              <FIRLocationMap
                lat={form.latitude} lng={form.longitude}
                onPin={(lat, lng) => setForm(f => ({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }))}
              />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Latitude</FieldLabel>
                  <InputField type="number" value={form.latitude} onChange={v => setForm(f => ({ ...f, latitude: v }))} placeholder="e.g. 12.9716" />
                </div>
                <div>
                  <FieldLabel>Longitude</FieldLabel>
                  <InputField type="number" value={form.longitude} onChange={v => setForm(f => ({ ...f, longitude: v }))} placeholder="e.g. 77.5946" />
                </div>
              </div>

              {form.latitude && form.longitude ? (
                <div className="bg-green-950/30 border border-green-800 rounded-xl p-3 flex items-center gap-2 text-xs text-green-300">
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                  Location pinned: <span className="font-mono font-bold text-green-200">{parseFloat(form.latitude).toFixed(5)}°N, {parseFloat(form.longitude).toFixed(5)}°E</span>
                  <button onClick={() => setForm(f => ({ ...f, latitude: '', longitude: '' }))} className="ml-auto text-green-600 hover:text-red-400 transition-colors">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-3 text-xs text-gray-400 flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-600" />
                  No location set — click the map above or type coordinates manually. Location is optional but recommended.
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                {[
                  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
                  { name: 'Mysuru',    lat: 12.2958, lng: 76.6394 },
                  { name: 'Hubballi',  lat: 15.3647, lng: 75.1240 },
                  { name: 'Belagavi', lat: 15.8497,  lng: 74.4977 },
                  { name: 'Mangaluru', lat: 12.9141, lng: 74.8560 },
                  { name: 'Kalaburagi',lat: 17.2297, lng: 76.7000 },
                ].map(city => (
                  <button key={city.name}
                    onClick={() => setForm(f => ({ ...f, latitude: city.lat.toFixed(6), longitude: city.lng.toFixed(6) }))}
                    className="text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors">
                    {city.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 3: Act & Sections ── */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-white border-b border-gray-800 pb-2">Acts & Sections Invoked</h2>
              <div className="space-y-2">
                {form.actSections.map((s, i) => {
                  const bnsDesc = s.act === 'BNS' ? BNS_DESCRIPTIONS[s.section] : null
                  return (
                    <div key={i} className="flex gap-2 items-start">
                      <div className="w-32 flex-shrink-0">
                        <SelectField value={s.act} onChange={v => {
                          const updated = form.actSections.map((sec, idx) => idx===i ? { ...sec, act:v, section: ACT_SECTIONS.find(a=>a.act===v)?.sections[0]??'' } : sec)
                          setForm(f => ({ ...f, actSections: updated }))
                        }}>
                          {ACT_SECTIONS.map(a => <option key={a.act} value={a.act}>{a.act}</option>)}
                        </SelectField>
                      </div>
                      <div className="flex-1">
                        <SelectField value={s.section} onChange={v => {
                          const updated = form.actSections.map((sec,idx) => idx===i ? { ...sec, section:v } : sec)
                          setForm(f => ({ ...f, actSections: updated }))
                        }}>
                          {(ACT_SECTIONS.find(a=>a.act===s.act)?.sections??[]).map(sec => {
                            const desc = s.act === 'BNS' ? BNS_DESCRIPTIONS[sec] : null
                            return <option key={sec} value={sec}>Sec. {sec}{desc ? ` — ${desc}` : ''}</option>
                          })}
                        </SelectField>
                        {bnsDesc && (
                          <p className="text-xs text-blue-400 mt-0.5 pl-1">BNS Sec. {s.section} — <span className="font-medium">{bnsDesc}</span></p>
                        )}
                      </div>
                      <button onClick={() => setForm(f => ({ ...f, actSections: f.actSections.filter((_,idx)=>idx!==i) }))}
                        className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0 mt-2.5">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
              <button onClick={() => setForm(f => ({ ...f, actSections: [...f.actSections, { act:'BNS', section:'103' }] }))}
                className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 border border-blue-800 hover:border-blue-600 rounded-lg px-3 py-2 transition-colors">
                <PlusCircle className="h-3.5 w-3.5" />Add Section
              </button>
              <div className="bg-blue-950/30 border border-blue-900/50 rounded-lg p-3 text-xs text-blue-300">
                <strong>BNS 2023</strong> (Bharatiya Nyaya Sanhita) is the primary law for offences after 1 Jul 2024. Add all applicable BNS / NDPS / POCSO / SC-ST POA sections. IPC is retained for legacy cases only.
              </div>
            </div>
          )}

          {/* ── Step 4: Complainant ── */}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-white border-b border-gray-800 pb-2">Complainant Details</h2>
              <div className="space-y-3">
                {form.complainants.map((c, i) => (
                  <PersonCard key={i} person={c} index={i} labelPrefix="Complainant"
                    onChange={p => setForm(f => ({ ...f, complainants: updatePerson(f.complainants,i,p) }))}
                    onRemove={() => setForm(f => ({ ...f, complainants: removePerson(f.complainants,i) }))}
                    showOccupation showCaste />
                ))}
              </div>
              <button onClick={() => setForm(f => ({ ...f, complainants: [...f.complainants, emptyPerson()] }))}
                className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 border border-blue-800 hover:border-blue-600 rounded-lg px-3 py-2 transition-colors">
                <PlusCircle className="h-3.5 w-3.5" />Add Complainant
              </button>
            </div>
          )}

          {/* ── Step 5: Victims ── */}
          {step === 5 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-white border-b border-gray-800 pb-2">Victim Details</h2>
              <div className="space-y-3">
                {form.victims.map((v, i) => (
                  <PersonCard key={i} person={v} index={i} labelPrefix="Victim"
                    onChange={p => setForm(f => ({ ...f, victims: updatePerson(f.victims,i,p) }))}
                    onRemove={() => setForm(f => ({ ...f, victims: removePerson(f.victims,i) }))}
                    showIsPolice />
                ))}
              </div>
              <button onClick={() => setForm(f => ({ ...f, victims: [...f.victims, emptyPerson()] }))}
                className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 border border-blue-800 hover:border-blue-600 rounded-lg px-3 py-2 transition-colors">
                <PlusCircle className="h-3.5 w-3.5" />Add Victim
              </button>
            </div>
          )}

          {/* ── Step 6: Accused ── */}
          {step === 6 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-white border-b border-gray-800 pb-2">Accused Details</h2>
              <div className="space-y-3">
                {form.accused.map((a, i) => (
                  <PersonCard key={i} person={a} index={i} labelPrefix="Accused"
                    onChange={p => setForm(f => ({ ...f, accused: updatePerson(f.accused,i,p) }))}
                    onRemove={() => setForm(f => ({ ...f, accused: removePerson(f.accused,i) }))} />
                ))}
              </div>
              <button onClick={() => setForm(f => ({ ...f, accused: [...f.accused, { ...emptyPerson(), personId:`A${f.accused.length+1}` }] }))}
                className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 border border-blue-800 hover:border-blue-600 rounded-lg px-3 py-2 transition-colors">
                <PlusCircle className="h-3.5 w-3.5" />Add Accused
              </button>
              {createMutation.isPending && (
                <div className="bg-blue-950/30 border border-blue-800 rounded-lg p-3 text-xs text-blue-300 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />Registering FIR in Catalyst Data Store...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between">
          <button onClick={() => step>1 ? setStep(s=>s-1) : setView('list')}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-4 py-2.5 rounded-xl transition-colors">
            <ArrowLeft className="h-4 w-4" />{step>1 ? 'Back' : 'Cancel'}
          </button>
          {step < STEPS.length ? (
            <button onClick={() => setStep(s=>s+1)} disabled={!canProceed}
              className="flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-5 py-2.5 rounded-xl transition-colors">
              Next <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending}
              className="flex items-center gap-2 text-sm bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-6 py-2.5 rounded-xl font-medium transition-colors">
              {createMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" />Registering...</>
                : <><CheckCircle2 className="h-4 w-4" />Register FIR</>}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ─── DETAIL VIEW ─────────────────────────────────────────────
  if (view === 'detail' && submittedFir) {
    const isOffline = !!submittedFir._offline
    const now = new Date()
    const monthlyTable = submittedFir.monthly_table ?? `fir_${now.getFullYear()}_${String(now.getMonth()+1).padStart(2,'0')}`
    // find the saved local FIR so we can reflect status changes live
    const savedEntry = localFIRs.find(f => f.crime_no === submittedFir.crime_no || f.id === String(submittedFir.case_master_id))
    const currentStatus = savedEntry?.case_status ?? submittedFir.case_status ?? 'Under Investigation'

    const handleDetailStatus = (newStatus: string) => {
      if (savedEntry) {
        const updated = updateLocalFIRStatus(savedEntry.id, newStatus)
        setLocalFIRs(updated)
        setSubmittedFir((prev: any) => ({ ...prev, case_status: newStatus }))
      }
    }

    const handleDetailDelete = () => {
      if (confirm(`Delete FIR ${submittedFir.crime_no}? This cannot be undone.`)) {
        if (savedEntry) setLocalFIRs(deleteLocalFIR(savedEntry.id))
        setView('list'); setSubmittedFir(null); setForm(emptyForm()); setStep(1)
      }
    }

    return (
      <div className="p-6 space-y-5 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <button onClick={() => { setView('list'); setSubmittedFir(null); setForm(emptyForm()); setStep(1) }}
            className="text-gray-400 hover:text-white"><ArrowLeft className="h-5 w-5" /></button>
          <h1 className="text-xl font-bold text-white">FIR Registered Successfully</h1>
          {isOffline && <span className="text-xs bg-amber-900/50 border border-amber-700 text-amber-300 px-2 py-0.5 rounded-full flex items-center gap-1"><WifiOff className="h-3 w-3" />Offline — Saved Locally</span>}
        </div>

        <div className={`border rounded-2xl p-6 space-y-4 ${isOffline ? 'bg-amber-950/20 border-amber-800' : 'bg-green-950/30 border-green-800'}`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className={`h-8 w-8 ${isOffline ? 'text-amber-400' : 'text-green-400'}`} />
              <div>
                <p className={`text-lg font-bold ${isOffline ? 'text-amber-300' : 'text-green-300'}`}>
                  {isOffline ? 'FIR Saved Locally (Pending Sync)' : 'FIR Registered in Catalyst Data Store'}
                </p>
                <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                  <Database className="h-3 w-3" />
                  Crime No: <span className="font-mono text-blue-300">{submittedFir.crime_no}</span>
                  {!isOffline && <span className="text-green-500 ml-1">• Live in Catalyst</span>}
                </p>
              </div>
            </div>
            {/* Current status badge */}
            <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${
              currentStatus.toLowerCase().includes('complet')
                ? 'bg-green-900/40 border-green-700 text-green-300'
                : currentStatus.toLowerCase().includes('sync') || currentStatus.toLowerCase().includes('local')
                  ? 'bg-amber-900/40 border-amber-700 text-amber-300'
                  : 'bg-yellow-900/40 border-yellow-700 text-yellow-300'
            }`}>{currentStatus}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Crime Number',    value: submittedFir.crime_no,              mono: true },
              { label: 'Case Number',     value: submittedFir.case_no,               mono: true },
              { label: 'Registered Date', value: submittedFir.crime_registered_date, mono: false },
              { label: 'Police Station',  value: `Station ID: ${submittedFir.police_station_id}`, mono: false },
            ].map(item => (
              <div key={item.label} className="bg-gray-900 rounded-xl px-4 py-3">
                <p className="text-xs text-gray-500 mb-0.5">{item.label}</p>
                <p className={`text-sm font-semibold ${item.mono ? 'font-mono text-blue-300' : 'text-white'}`}>{item.value ?? '—'}</p>
              </div>
            ))}
          </div>

          {(submittedFir.latitude || form.latitude) && (submittedFir.longitude || form.longitude) && (
            <div className="bg-gray-900 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><MapPin className="h-3 w-3" />Incident Location (GPS)</p>
              <p className="text-sm font-mono text-green-300">
                {parseFloat(submittedFir.latitude ?? form.latitude).toFixed(6)}°N,{' '}
                {parseFloat(submittedFir.longitude ?? form.longitude).toFixed(6)}°E
              </p>
            </div>
          )}

          <div className="bg-gray-900 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500 mb-1">Brief Facts</p>
            <p className="text-sm text-gray-300 leading-relaxed">{submittedFir.brief_facts || form.briefFacts}</p>
          </div>

          {/* ── Status management + actions ── */}
          <div className="border-t border-gray-700/50 pt-4 space-y-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Case Management</p>
            <div className="flex gap-3 flex-wrap">
              <button onClick={() => handleDetailStatus('Under Investigation')}
                disabled={currentStatus === 'Under Investigation'}
                className="flex items-center gap-2 text-sm border border-yellow-700 hover:bg-yellow-900/30 disabled:opacity-40 disabled:cursor-not-allowed text-yellow-300 px-4 py-2 rounded-xl transition-colors">
                <Clock className="h-4 w-4" />Mark Ongoing
              </button>
              <button onClick={() => handleDetailStatus('Completed')}
                disabled={currentStatus === 'Completed'}
                className="flex items-center gap-2 text-sm border border-green-700 hover:bg-green-900/30 disabled:opacity-40 disabled:cursor-not-allowed text-green-300 px-4 py-2 rounded-xl transition-colors">
                <CheckSquare className="h-4 w-4" />Mark Completed
              </button>
              <button onClick={handleDetailDelete}
                className="flex items-center gap-2 text-sm border border-red-800 hover:bg-red-900/30 text-red-400 px-4 py-2 rounded-xl transition-colors ml-auto">
                <Trash2 className="h-4 w-4" />Delete FIR
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-1 flex-wrap border-t border-gray-700/50">
            <button onClick={() => printFIR(submittedFir, form)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors mt-3">
              <Printer className="h-4 w-4" />Print Official FIR
            </button>
            <button onClick={() => { setView('create'); setStep(1); setForm(emptyForm()); setSubmittedFir(null) }}
              className="flex items-center gap-2 border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white text-sm px-5 py-2.5 rounded-xl transition-colors mt-3">
              <PlusCircle className="h-4 w-4" />Register Another
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── LIST VIEW ───────────────────────────────────────────────
  const localPending = localFIRs.filter(f => f.source === 'local').length

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">FIR Management</h1>
          <p className="text-sm text-gray-400 mt-1">Register and manage First Information Reports — Karnataka State Police</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs flex items-center gap-1 px-2 py-1 rounded-full border bg-amber-950/30 border-amber-800 text-amber-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Demo Mode
          </span>
          <button onClick={() => { setView('create'); setStep(1); setForm(emptyForm()) }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors">
            <PlusCircle className="h-4 w-4" />Register FIR
          </button>
        </div>
      </div>

      {/* Pre-selected station context banner (from Stations page) */}
      {selectedStation && (
        <div className="flex items-center gap-3 bg-blue-950/30 border border-blue-700/40 rounded-xl px-4 py-2.5 text-xs">
          <Building2 className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
          <span className="text-blue-300 font-medium">Station pre-selected from directory:</span>
          <span className="text-white font-semibold">{selectedStation.name}</span>
          <span className="text-gray-500">·</span>
          <span className="text-gray-400">{selectedStation.district}</span>
          <span className="text-gray-500">·</span>
          <span className="text-gray-400">{selectedStation.zone} Zone</span>
          <button
            onClick={() => { setView('create'); setStep(1) }}
            className="ml-auto text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg transition-colors font-medium"
          >
            Register FIR at this Station →
          </button>
          <button
            onClick={() => setSelectedStation(null)}
            className="text-gray-600 hover:text-gray-300 transition-colors text-base leading-none ml-1"
          >×</button>
        </div>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:'Total FIRs',           value: merged.length,                                  color:'blue' },
          { label:'Under Investigation',  value: merged.filter(f=>f.case_status.includes('Investigation')).length, color:'yellow' },
          { label:'Pending Sync',         value: localPending,                                   color:'amber' },
          { label:'This Month',           value: merged.filter(f => { const now=new Date(); return f.monthly_table===`fir_${now.getFullYear()}_${String(now.getMonth()+1).padStart(2,'0')}` }).length, color:'green' },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className="text-xl font-bold text-white mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by Crime No, district, or brief facts..."
          className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
      </div>

      {/* FIR Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <span className="text-sm font-medium text-white">Registered FIRs</span>
          <span className="text-xs text-gray-500">{filtered.length} records</span>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
          </div>
        ) : !filtered.length ? (
          <div className="text-center py-16 space-y-2">
            <FileText className="h-10 w-10 text-gray-700 mx-auto" />
            <p className="text-gray-500 text-sm">No FIRs found.</p>
            <p className="text-gray-600 text-xs">Register the first FIR using the button above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/50">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Crime No</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">District</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Crime Head</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Source</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.map(fir => (
                  <tr key={fir.id} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-3"><span className="font-mono text-xs font-semibold text-blue-400">{fir.crime_no || '—'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-400">{fir.crime_registered_date || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{fir.district_name || `Stn ${fir.police_station_id}`}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{fir.crime_head || '—'}</td>
                    <td className="px-4 py-3">
                      {fir.case_status?.toLowerCase().includes('complet')
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400">Completed</span>
                        : fir.case_status?.toLowerCase().includes('local') || fir.case_status?.toLowerCase().includes('sync')
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400">Pending Sync</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/40 text-yellow-400">Ongoing</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${fir.source==='backend' ? 'bg-green-900/40 text-green-400' : 'bg-amber-900/40 text-amber-400'}`}>
                        {fir.source==='backend' ? 'Catalyst' : 'Local'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {/* Print — uses stored formSnapshot */}
                        <button
                          onClick={() => {
                            const snap = (fir as any).formSnapshot as FIRFormState | undefined
                            if (snap) {
                              printFIR({ crime_no: fir.crime_no, case_no: fir.case_no, monthly_table: fir.monthly_table, crime_registered_date: fir.crime_registered_date, case_status: fir.case_status, latitude: fir.latitude, longitude: fir.longitude }, snap)
                            } else {
                              setSubmittedFir({ crime_no: fir.crime_no, case_no: fir.case_no, monthly_table: fir.monthly_table, crime_registered_date: fir.crime_registered_date, case_status: fir.case_status, case_category: 'FIR', brief_facts: fir.brief_facts, police_station_id: fir.police_station_id, latitude: fir.latitude, longitude: fir.longitude, case_master_id: fir.id, _offline: fir.source === 'local' })
                              setView('detail')
                            }
                          }}
                          className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-400 border border-gray-700 hover:border-blue-700 rounded-lg px-2 py-1.5 transition-colors"
                          title="Print FIR">
                          <Printer className="h-3 w-3" />
                        </button>
                        {/* Mark as Ongoing */}
                         <button
                           onClick={() => {
                             upsertLocalFIRFromRow(fir)
                             setLocalFIRs(updateLocalFIRStatus(fir.id, 'Under Investigation'))
                           }}
                           className="flex items-center gap-1 text-xs text-gray-400 hover:text-yellow-400 border border-gray-700 hover:border-yellow-700 rounded-lg px-2 py-1.5 transition-colors"
                           title="Mark as Ongoing">
                           <Clock className="h-3 w-3" />
                         </button>
                         {/* Mark as Completed */}
                         <button
                           onClick={() => {
                             upsertLocalFIRFromRow(fir)
                             setLocalFIRs(updateLocalFIRStatus(fir.id, 'Completed'))
                           }}
                           className={`flex items-center gap-1 text-xs border rounded-lg px-2 py-1.5 transition-colors ${
                             fir.case_status?.toLowerCase().includes('complet')
                               ? 'bg-green-900/30 border-green-700 text-green-400 cursor-default'
                               : 'text-gray-400 hover:text-green-400 border-gray-700 hover:border-green-700'
                           }`}
                           title="Mark as Completed">
                           <CheckSquare className="h-3 w-3" />
                         </button>
                         {/* Delete */}
                         <button
                           onClick={() => { if (confirm(`Delete FIR ${fir.crime_no}? This cannot be undone.`)) setLocalFIRs(deleteLocalFIR(fir.id)) }}
                           className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 border border-gray-700 hover:border-red-700 rounded-lg px-2 py-1.5 transition-colors"
                           title="Delete FIR">
                           <Trash2 className="h-3 w-3" />
                         </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
