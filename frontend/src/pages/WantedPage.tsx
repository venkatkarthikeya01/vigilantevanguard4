import { useState } from 'react'
import { Search, User, AlertTriangle, CheckCircle2, Clock, X, MapPin, Car, Phone, Fingerprint, Award } from 'lucide-react'

// ── Comprehensive wanted / accused data (BNS 2023 sections) ──────────────────
interface WantedPerson {
  id: string; name: string; alias: string; age: number; gender: string
  crimeHead: string; section: string; district: string; fir: string
  status: 'Wanted' | 'Arrested' | 'Absconding'
  addedDate: string; description: string
  // Extended fields
  height?: string; weight?: string; complexion?: string; build?: string
  identificationMarks?: string; fatherName?: string; address?: string
  mobile?: string; nativity?: string; education?: string
  lastSeenLocation?: string; lastSeenDate?: string
  reward?: string; psRegistration?: string; investigatingOfficer?: string
  accomplices?: string; vehicle?: string; photoPlaceholder?: string
  bnsSections?: string[]; actNote?: string
}

const WANTED: WantedPerson[] = [
  {
    id:'A001', name:'Ravi Kumar S', alias:'Ravi Anna', age:34, gender:'Male',
    crimeHead:'Murder', section:'BNS Sec 103', district:'Bengaluru City',
    fir:'10000500052026001234', status:'Wanted', addedDate:'2026-01-08',
    description:'Suspect in fatal stabbing near KR Market on 08-Jan-2026. Armed and considered dangerous. Has prior history of assault cases.',
    height:'5\'9"', weight:'72 kg', complexion:'Wheatish', build:'Medium',
    identificationMarks:'Large scar on left forearm, tattoo of eagle on right bicep',
    fatherName:'Suresh Kumar', address:'Plot 12, 4th Cross, Nagarbhavi, Bengaluru – 560072',
    mobile:'9845XXXXXX', nativity:'Kolar', lastSeenLocation:'Majestic Bus Stand, Bengaluru',
    lastSeenDate:'2026-01-10', reward:'₹1,00,000', psRegistration:'KR Market PS',
    investigatingOfficer:'Insp. Ramesh K', vehicle:'Red Honda Activa – KA 53 XX 2214',
    bnsSections:['103','351'], actNote:'BNS 2023 — replaces IPC 302',
    accomplices:'A002 (Farooq Bhai) — suspected associate',
  },
  {
    id:'A002', name:'Mohammed Farooq', alias:'Farooq Bhai', age:29, gender:'Male',
    crimeHead:'Robbery', section:'BNS Sec 137', district:'Mysuru City',
    fir:'10002900032026000872', status:'Arrested', addedDate:'2026-01-15',
    description:'Arrested for chain snatching series in Mysuru. 3 cases linked. Caught at Mysuru railway station.',
    height:'5\'7"', weight:'65 kg', complexion:'Dark', build:'Slim',
    identificationMarks:'Chipped front tooth, scar on chin',
    fatherName:'Abdul Rahman', address:'Ward 8, Devaraja Mohalla, Mysuru – 570001',
    nativity:'Mysuru', lastSeenLocation:'Mysuru Railway Station (at arrest)',
    lastSeenDate:'2026-01-15', psRegistration:'Devaraja PS, Mysuru City',
    investigatingOfficer:'SI Priya Naik', bnsSections:['137','140'],
    actNote:'BNS 2023 — replaces IPC 392/379',
  },
  {
    id:'A003', name:'Suresh Naik', alias:'Suresh', age:41, gender:'Male',
    crimeHead:'NDPS Trafficking', section:'NDPS Sec 20', district:'Shivamogga',
    fir:'10003200082026001101', status:'Absconding', addedDate:'2026-01-22',
    description:'Major ganja supplier across Shivamogga–Udupi belt. Absconded before arrest. Known associate of Udupi cartel.',
    height:'5\'6"', weight:'68 kg', complexion:'Dark', build:'Stocky',
    identificationMarks:'Tattoo "786" on right wrist, missing left little finger',
    fatherName:'Vishwanath Naik', address:'Last known: Sagar Taluk, Shivamogga District',
    nativity:'Sagar', lastSeenLocation:'Sagar Bus Stand, Shivamogga',
    lastSeenDate:'2026-01-20', reward:'₹75,000', psRegistration:'Sagar PS',
    investigatingOfficer:'Insp. Gopal S', vehicle:'White Bolero – KA 14 XX 8870',
    bnsSections:['130'], actNote:'NDPS Act 1985 Sec 20; BNS 130 (Trafficking)',
    accomplices:'4 unknown associates; Udupi cartel link',
  },
  {
    id:'A004', name:'Anita Reddy', alias:'Anita', age:27, gender:'Female',
    crimeHead:'Online Fraud', section:'IT Act Sec 66D', district:'Bengaluru City',
    fir:'10000500062026002345', status:'Arrested', addedDate:'2026-02-03',
    description:'Ran cyber fraud network targeting senior citizens. Arrested with 3 accomplices at Whitefield.',
    height:'5\'3"', weight:'55 kg', complexion:'Fair', build:'Slim',
    identificationMarks:'Small mole above left eyebrow',
    fatherName:'Venkat Reddy', address:'103, Prestige Layout, Whitefield, Bengaluru – 560066',
    mobile:'8088XXXXXX', nativity:'Hyderabad', education:'B.Tech (CS)',
    lastSeenLocation:'Whitefield PS (under custody)', psRegistration:'Whitefield CEN PS',
    investigatingOfficer:'SI Rekha T', bnsSections:['316'], actNote:'IT Act 66D; BNS 316 (Cheating)',
    accomplices:'3 co-accused in custody',
  },
  {
    id:'A005', name:'Prakash Gowda', alias:'Pakku', age:38, gender:'Male',
    crimeHead:'Dacoity', section:'BNS Sec 138', district:'Belagavi District',
    fir:'10000400102026000456', status:'Wanted', addedDate:'2026-02-11',
    description:'Armed dacoity at national highway dhaba near Belagavi. Escaped on motorcycle with 2 associates.',
    height:'5\'10"', weight:'78 kg', complexion:'Dark', build:'Heavy',
    identificationMarks:'Deep cut scar on left cheek, crooked nose (past injury)',
    fatherName:'Basappa Gowda', address:'Athani Taluk, Belagavi District (approximate)',
    nativity:'Athani, Belagavi', lastSeenLocation:'NH-4, Belagavi–Dharwad stretch',
    lastSeenDate:'2026-02-11', reward:'₹50,000', psRegistration:'Athani PS',
    investigatingOfficer:'Insp. Satish B', vehicle:'Black Yamaha FZ – KA 04 XX 5612',
    bnsSections:['138','137'], actNote:'BNS 2023 — replaces IPC 395/392',
    accomplices:'2 unidentified male associates, armed',
  },
  {
    id:'A006', name:'Venkatesh B', alias:'Venku', age:45, gender:'Male',
    crimeHead:'Grievous Hurt', section:'BNS Sec 117', district:'Ballari',
    fir:'10000200052026000789', status:'Arrested', addedDate:'2026-02-18',
    description:'Grievous hurt with iron rod in property dispute. Arrested at Hospet bus stand.',
    height:'5\'8"', weight:'74 kg', complexion:'Wheatish', build:'Medium',
    identificationMarks:'Burn scar on right palm',
    fatherName:'Basavanna B', address:'Plot 45, Vijayanagar Colony, Ballari – 583102',
    nativity:'Ballari', lastSeenLocation:'Hospet BS (at arrest)', psRegistration:'Kampli PS, Ballari',
    investigatingOfficer:'SI Kumar N', bnsSections:['117','116'], actNote:'BNS 2023 — replaces IPC 326/325',
  },
  {
    id:'A007', name:'Deepa Kumari', alias:'Deepa', age:23, gender:'Female',
    crimeHead:'Dowry Death', section:'BNS Sec 80', district:'Tumakuru',
    fir:'10003300032026001567', status:'Wanted', addedDate:'2026-03-04',
    description:'Accused in dowry death case. Victim died within 7 years of marriage. Anticipatory bail rejected, absconded.',
    height:'5\'2"', weight:'50 kg', complexion:'Fair', build:'Slim',
    identificationMarks:'Mole on right cheek',
    fatherName:'Raju Gowda (natal), Husband: Mahesh K', address:'Gubbi Taluk, Tumakuru District',
    nativity:'Gubbi, Tumakuru', lastSeenLocation:'Gubbi Town, Tumakuru',
    lastSeenDate:'2026-03-03', reward:'₹25,000', psRegistration:'Gubbi PS, Tumakuru',
    investigatingOfficer:'SI Meena P', bnsSections:['80','79'], actNote:'BNS 2023 — replaces IPC 304B/498A',
  },
  {
    id:'A008', name:'Imran Khan A', alias:'Imran', age:31, gender:'Male',
    crimeHead:'Cyber Stalking', section:'IT Act Sec 66E', district:'Bengaluru South',
    fir:'10000700062026003001', status:'Absconding', addedDate:'2026-03-12',
    description:'Repeated cyberstalking and morphed photo distribution targeting multiple women. Technical tracking initiated.',
    height:'5\'8"', weight:'68 kg', complexion:'Wheatish', build:'Slim',
    identificationMarks:'Spectacles wearer, short beard, thinning hairline',
    fatherName:'Akbar Khan', address:'JP Nagar 6th Phase, Bengaluru (vacated)',
    mobile:'9900XXXXXX', nativity:'Bengaluru', education:'MCA',
    lastSeenLocation:'Hejjala, Bengaluru South (last IP trace)',
    lastSeenDate:'2026-03-10', psRegistration:'JP Nagar PS / CEN PS South',
    investigatingOfficer:'SI Divya R', bnsSections:['75','76'], actNote:'IT Act 66E; BNS 75/76 (Stalking/Voyeurism)',
  },
  {
    id:'A009', name:'Srinivasa Murthy', alias:'SM', age:52, gender:'Male',
    crimeHead:'Bank Fraud', section:'BNS Sec 316', district:'Bengaluru City',
    fir:'10000500072026004321', status:'Arrested', addedDate:'2026-03-19',
    description:'₹4.2 Crore bank fraud via shell companies. Arrested at Kempegowda International Airport attempting to flee.',
    height:'5\'7"', weight:'80 kg', complexion:'Wheatish', build:'Heavy',
    identificationMarks:'Reading glasses, receding grey hair, paunch',
    fatherName:'T.R. Murthy', address:'Sadashivanagar, Bengaluru – 560080',
    mobile:'9980XXXXXX', nativity:'Mandya', education:'MBA (Finance)',
    lastSeenLocation:'KIA Terminal 2 (at arrest)', psRegistration:'Sampangiram Nagar PS',
    investigatingOfficer:'Insp. Rao K', bnsSections:['316','318'], actNote:'BNS 2023 — replaces IPC 420/463',
  },
  {
    id:'A010', name:'Basha Mohammed', alias:'Basha', age:36, gender:'Male',
    crimeHead:'NDPS Possession', section:'NDPS Sec 21', district:'Raichur',
    fir:'10003100082026000234', status:'Arrested', addedDate:'2026-04-02',
    description:'Seized with 12 kg brown sugar (heroin). Arrested near Raichur Railway Station.',
    height:'5\'6"', weight:'62 kg', complexion:'Dark', build:'Medium',
    identificationMarks:'Missing right index finger, tattoo on neck',
    fatherName:'Riyaz Mohammed', address:'Railway Station Road, Raichur – 584101',
    nativity:'Raichur', lastSeenLocation:'Raichur Railway Station (at arrest)',
    psRegistration:'Raichur Town PS', investigatingOfficer:'SI Prasad M',
    bnsSections:['130'], actNote:'NDPS Act 1985 Sec 21',
  },
  {
    id:'A011', name:'Chandra Shekar R', alias:'CS', age:44, gender:'Male',
    crimeHead:'Murder', section:'BNS Sec 103', district:'Kalaburagi',
    fir:'10002100012026000543', status:'Wanted', addedDate:'2026-04-15',
    description:'Honour killing suspect. Victim was adult daughter. Lookout notice issued at all Maharashtra & AP border entry points.',
    height:'5\'9"', weight:'75 kg', complexion:'Dark', build:'Athletic',
    identificationMarks:'Prominent jawline, mole on left jaw, tribal tattoo on right shoulder',
    fatherName:'Ramaiah R', address:'Chincholi Taluk, Kalaburagi District',
    nativity:'Chincholi', lastSeenLocation:'Bidar–Solapur Highway, near Maharashtra border',
    lastSeenDate:'2026-04-14', reward:'₹1,50,000', psRegistration:'Chincholi PS, Kalaburagi',
    investigatingOfficer:'Insp. Shiva K', vehicle:'Blue Tata Sumo – MH 26 XX 1109 (stolen plates)',
    bnsSections:['103','85'], actNote:'BNS 2023 — replaces IPC 302; BNS 85 (Dishonour killing)',
    accomplices:'1 unknown male relative',
  },
  {
    id:'A012', name:'Kavitha S', alias:'Kavitha', age:26, gender:'Female',
    crimeHead:'SC/ST Atrocity', section:'SC/ST POA Sec 3(1)(r)', district:'Yadgir',
    fir:'10003800052026000678', status:'Absconding', addedDate:'2026-04-28',
    description:'Accused in caste-based atrocity and abetment of suicide of SC victim. Anticipatory bail rejected. Absconded from Yadgir.',
    height:'5\'4"', weight:'58 kg', complexion:'Wheatish', build:'Medium',
    identificationMarks:'None notable',
    fatherName:'Shivanna S', address:'Shahapur Taluk, Yadgir District',
    nativity:'Shahapur', lastSeenLocation:'Gulbarga (Kalaburagi) city area',
    lastSeenDate:'2026-04-27', psRegistration:'Shahapur PS, Yadgir',
    investigatingOfficer:'SI Lakshmi B', bnsSections:['107'], actNote:'SC/ST POA 1989 Sec 3(1)(r); BNS 107 (Abetment of Suicide)',
  },
  {
    id:'A013', name:'Nagesh Patil', alias:'Nagu', age:39, gender:'Male',
    crimeHead:'Robbery', section:'BNS Sec 137', district:'Vijayapur',
    fir:'10003700102026000912', status:'Wanted', addedDate:'2026-05-06',
    description:'Serial jewellery shop robbery. 5 cases across Bijapur–Bagalkot belt. Uses disguise kit. Last seen Bagalkot bus stand.',
    height:'5\'8"', weight:'70 kg', complexion:'Wheatish', build:'Medium',
    identificationMarks:'Small birthmark on right neck, usually wears cap and glasses as disguise',
    fatherName:'Siddaiah Patil', address:'Vijayapur City (address changed)',
    nativity:'Vijayapur', lastSeenLocation:'Bagalkot Bus Stand',
    lastSeenDate:'2026-05-04', reward:'₹25,000', psRegistration:'Civil Lines PS, Vijayapur',
    investigatingOfficer:'Insp. Mahesh P', vehicle:'Grey Honda Shine – KA 37 XX 7743',
    bnsSections:['137','140'], actNote:'BNS 2023 — replaces IPC 392/379',
  },
  {
    id:'A014', name:'Rajesh Kumar N', alias:'RK', age:33, gender:'Male',
    crimeHead:'Attempt to Murder', section:'BNS Sec 109', district:'Bengaluru City',
    fir:'10000500012026005432', status:'Arrested', addedDate:'2026-05-20',
    description:'Rival gang attack near Hebbal flyover with sharp weapons. 3-day manhunt ended with arrest at Yelahanka.',
    height:'5\'10"', weight:'73 kg', complexion:'Dark', build:'Athletic',
    identificationMarks:'Gang tattoo "RK" on left forearm, fractured right thumb (old)',
    fatherName:'Narayanaswamy K', address:'Yelahanka New Town, Bengaluru – 560064',
    nativity:'Tumakuru', lastSeenLocation:'Yelahanka (at arrest)', psRegistration:'Hebbal PS',
    investigatingOfficer:'Insp. Venugopal S', bnsSections:['109','137'], actNote:'BNS 2023 — replaces IPC 307/392',
    accomplices:'2 co-accused arrested; 1 absconding',
  },
  {
    id:'A015', name:'Savitha Devi', alias:'Savitha', age:48, gender:'Female',
    crimeHead:'Cheating (Chit Fund)', section:'BNS Sec 316', district:'Mangaluru City',
    fir:'10002800072026001289', status:'Absconding', addedDate:'2026-06-01',
    description:'Multi-level chit fund fraud. ₹80+ Lakhs collected from 200+ victims. Absconded with family. LN issued at all airports.',
    height:'5\'3"', weight:'62 kg', complexion:'Fair', build:'Heavy',
    identificationMarks:'Reading glasses, prominent vermillion bindi mark, greying hair',
    fatherName:'Husband: Deva Das', address:'Kankanady, Mangaluru – 575002 (vacated)',
    mobile:'9480XXXXXX', nativity:'Udupi', education:'SSLC',
    lastSeenLocation:'Mangaluru International Airport (last CCTV appearance)',
    lastSeenDate:'2026-05-30', reward:'₹50,000', psRegistration:'Kankanady PS, Mangaluru City',
    investigatingOfficer:'Insp. Anitha S', bnsSections:['316','319'], actNote:'BNS 2023 — replaces IPC 420/468',
    accomplices:'Husband co-accused, also absconding',
  },
]

const STATUS_STYLE = {
  Wanted:     { bg: 'bg-red-900/40',    border: 'border-red-800',    text: 'text-red-400',    icon: AlertTriangle },
  Arrested:   { bg: 'bg-green-900/40',  border: 'border-green-800',  text: 'text-green-400',  icon: CheckCircle2  },
  Absconding: { bg: 'bg-amber-900/40',  border: 'border-amber-800',  text: 'text-amber-400',  icon: Clock         },
}

function DetailRow({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-3 text-sm py-1.5 border-b border-gray-800/60 last:border-0">
      <span className="text-gray-500 shrink-0 min-w-28">{label}</span>
      <span className={`text-right ${mono ? 'font-mono text-xs text-blue-300' : 'text-gray-200 font-medium'}`}>{value}</span>
    </div>
  )
}

export default function WantedPage() {
  const [search, setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState<'All' | 'Wanted' | 'Arrested' | 'Absconding'>('All')
  const [selected, setSelected] = useState<WantedPerson | null>(null)

  const filtered = WANTED.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      p.name.toLowerCase().includes(q) || p.alias.toLowerCase().includes(q) ||
      p.fir.includes(q) || p.district.toLowerCase().includes(q) ||
      p.crimeHead.toLowerCase().includes(q) ||
      (p.section.toLowerCase().includes(q)) ||
      (p.lastSeenLocation ?? '').toLowerCase().includes(q)
    const matchStatus = statusFilter === 'All' || p.status === statusFilter
    return matchSearch && matchStatus
  })

  const counts = {
    Wanted:     WANTED.filter(p => p.status === 'Wanted').length,
    Arrested:   WANTED.filter(p => p.status === 'Arrested').length,
    Absconding: WANTED.filter(p => p.status === 'Absconding').length,
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Wanted & Accused Persons</h1>
        <p className="text-sm text-gray-400 mt-1">Accused register from registered FIRs — Karnataka State Police · BNS 2023</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {(['Wanted','Arrested','Absconding'] as const).map(s => {
          const style = STATUS_STYLE[s]
          const Icon  = style.icon
          return (
            <div key={s} className={`bg-gray-900 border rounded-xl px-4 py-3 flex items-center gap-3 ${style.border}`}>
              <div className={`p-2 rounded-lg ${style.bg}`}><Icon className={`h-4 w-4 ${style.text}`} /></div>
              <div>
                <p className="text-xl font-bold text-white">{counts[s]}</p>
                <p className={`text-xs font-semibold ${style.text}`}>{s}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, alias, FIR, district, section, last-seen..."
            className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
        </div>
        <div className="flex gap-1.5">
          {(['All','Wanted','Arrested','Absconding'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-2.5 rounded-xl border transition-colors ${statusFilter === s ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <span className="text-sm font-medium text-white">Accused Register</span>
          <span className="text-xs text-gray-500">{filtered.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                {['ID','Name / Alias','Age','Crime Head','Section (BNS/Act)','District','Last Seen','Status',''].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(p => {
                const style = STATUS_STYLE[p.status]
                const Icon  = style.icon
                return (
                  <tr key={p.id} className="hover:bg-gray-800/40 transition-colors cursor-pointer" onClick={() => setSelected(p)}>
                    <td className="px-4 py-3"><span className="font-mono text-xs text-gray-500">{p.id}</span></td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-white">{p.name}</p>
                      <p className="text-xs text-gray-500">"{p.alias}"</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{p.age} / {p.gender[0]}</td>
                    <td className="px-4 py-3 text-xs text-gray-300">{p.crimeHead}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-blue-400">{p.section}</span>
                      {p.reward && <p className="text-xs text-amber-400 mt-0.5 flex items-center gap-1"><Award className="h-2.5 w-2.5" />{p.reward}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{p.district}</td>
                    <td className="px-4 py-3">
                      {p.lastSeenLocation
                        ? <div><p className="text-xs text-gray-300 flex items-center gap-1"><MapPin className="h-2.5 w-2.5 text-orange-400" />{p.lastSeenLocation.length > 22 ? p.lastSeenLocation.slice(0,22)+'…' : p.lastSeenLocation}</p>
                           {p.lastSeenDate && <p className="text-xs text-gray-600 mt-0.5">{p.lastSeenDate}</p>}</div>
                        : <span className="text-xs text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
                        <Icon className="h-3 w-3" />{p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button className="text-xs text-gray-500 hover:text-blue-400 transition-colors">View</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setSelected(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl shadow-2xl my-4" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-gray-800">
              <div className="flex items-start gap-4">
                {/* Photo placeholder */}
                <div className="bg-gray-800 border border-gray-700 rounded-xl h-16 w-14 flex flex-col items-center justify-center flex-shrink-0">
                  <User className="h-6 w-6 text-gray-500 mb-0.5" />
                  <span className="text-[9px] text-gray-600 text-center leading-tight">No Photo</span>
                </div>
                <div>
                  <p className="text-lg font-bold text-white">{selected.name}</p>
                  <p className="text-xs text-gray-400">"{selected.alias}" · {selected.age} yrs · {selected.gender}</p>
                  {selected.reward && (
                    <p className="text-xs text-amber-400 mt-1 flex items-center gap-1 font-semibold">
                      <Award className="h-3 w-3" />Reward: {selected.reward}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {(() => { const style = STATUS_STYLE[selected.status]; const Icon = style.icon; return (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${style.bg} ${style.text}`}>
                    <Icon className="h-3.5 w-3.5" />{selected.status}
                  </span>
                )})()}
                <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-white ml-1"><X className="h-5 w-5" /></button>
              </div>
            </div>

            <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0">
              {/* Left column */}
              <div>
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mt-2 mb-1">Identity</p>
                <DetailRow label="Accused ID"   value={selected.id} mono />
                <DetailRow label="Father/Husband" value={selected.fatherName} />
                <DetailRow label="Address"      value={selected.address} />
                <DetailRow label="Nativity"     value={selected.nativity} />
                <DetailRow label="Education"    value={selected.education} />
                <DetailRow label="Mobile"       value={selected.mobile} mono />

                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mt-4 mb-1">Physical Description</p>
                <DetailRow label="Height"       value={selected.height} />
                <DetailRow label="Weight"       value={selected.weight} />
                <DetailRow label="Complexion"   value={selected.complexion} />
                <DetailRow label="Build"        value={selected.build} />
                <DetailRow label="ID Marks"     value={selected.identificationMarks} />
              </div>

              {/* Right column */}
              <div>
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mt-2 mb-1">Case Details</p>
                <DetailRow label="Crime Head"   value={selected.crimeHead} />
                <DetailRow label="Section"      value={selected.section} mono />
                <DetailRow label="Act Note"     value={selected.actNote} />
                <DetailRow label="FIR Number"   value={selected.fir} mono />
                <DetailRow label="District"     value={selected.district} />
                <DetailRow label="PS"           value={selected.psRegistration} />
                <DetailRow label="IO"           value={selected.investigatingOfficer} />
                <DetailRow label="Added On"     value={selected.addedDate} />

                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mt-4 mb-1">Last Seen & Vehicle</p>
                <DetailRow label="Last Seen"    value={selected.lastSeenLocation} />
                <DetailRow label="Last Seen Date" value={selected.lastSeenDate} />
                <DetailRow label="Vehicle"      value={selected.vehicle} />
                <DetailRow label="Accomplices"  value={selected.accomplices} />
              </div>
            </div>

            {/* BNS Sections strip */}
            {selected.bnsSections && selected.bnsSections.length > 0 && (
              <div className="px-6 pb-2">
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">BNS 2023 Sections</p>
                <div className="flex flex-wrap gap-1.5">
                  {selected.bnsSections.map(s => (
                    <span key={s} className="bg-blue-900/40 border border-blue-800 text-blue-300 text-xs font-mono px-2 py-0.5 rounded-lg">BNS {s}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            <div className="px-6 pb-4">
              <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-3 mt-2">
                <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Fingerprint className="h-3 w-3" />Case Notes</p>
                <p className="text-sm text-gray-200 leading-relaxed">{selected.description}</p>
              </div>
            </div>

            {/* Action footer */}
            <div className="px-6 pb-4 flex gap-2 flex-wrap border-t border-gray-800 pt-3">
              {selected.mobile && (
                <a href={`tel:${selected.mobile}`} className="flex items-center gap-1.5 text-xs text-green-400 border border-green-800 bg-green-900/20 rounded-lg px-3 py-2 hover:bg-green-900/40 transition-colors">
                  <Phone className="h-3 w-3" />Contact
                </a>
              )}
              {selected.lastSeenLocation && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected.lastSeenLocation + ', Karnataka')}`}
                  target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs text-orange-400 border border-orange-800 bg-orange-900/20 rounded-lg px-3 py-2 hover:bg-orange-900/40 transition-colors">
                  <MapPin className="h-3 w-3" />Map Last Seen
                </a>
              )}
              {selected.vehicle && (
                <span className="flex items-center gap-1.5 text-xs text-purple-400 border border-purple-800 bg-purple-900/20 rounded-lg px-3 py-2">
                  <Car className="h-3 w-3" />{selected.vehicle}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
