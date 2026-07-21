import { useState } from 'react'
import { Search, User, AlertTriangle, CheckCircle2, Clock, X } from 'lucide-react'

// ── Static accused data pulled from the FIR dataset ──────────────────────────
const WANTED: {
  id: string; name: string; alias: string; age: number; gender: string
  crimeHead: string; section: string; district: string; fir: string
  status: 'Wanted' | 'Arrested' | 'Absconding'
  addedDate: string; description: string
}[] = [
  { id:'A001', name:'Ravi Kumar S',      alias:'Ravi Anna',   age:34, gender:'Male',   crimeHead:'Murder',              section:'Sec 302 IPC',       district:'Bengaluru City',    fir:'10000500052026001234', status:'Wanted',     addedDate:'2026-01-08', description:'Suspect in fatal stabbing near KR Market. Armed and dangerous.' },
  { id:'A002', name:'Mohammed Farooq',   alias:'Farooq Bhai', age:29, gender:'Male',   crimeHead:'Robbery',             section:'Sec 392 IPC',       district:'Mysuru City',       fir:'10002900032026000872', status:'Arrested',   addedDate:'2026-01-15', description:'Arrested for chain snatching series in Mysuru. 3 cases linked.' },
  { id:'A003', name:'Suresh Naik',       alias:'Suresh',      age:41, gender:'Male',   crimeHead:'NDPS Trafficking',    section:'Sec 20 NDPS',       district:'Shivamogga',        fir:'10003200082026001101', status:'Absconding', addedDate:'2026-01-22', description:'Major ganja supplier. Absconded before arrest. Known associate of Udupi cartel.' },
  { id:'A004', name:'Anita Reddy',       alias:'Anita',       age:27, gender:'Female', crimeHead:'Online Fraud',        section:'Sec 66D IT Act',    district:'Bengaluru City',    fir:'10000500062026002345', status:'Arrested',   addedDate:'2026-02-03', description:'Ran cyber fraud network targeting senior citizens. Arrested with accomplices.' },
  { id:'A005', name:'Prakash Gowda',     alias:'Pakku',       age:38, gender:'Male',   crimeHead:'Dacoity',             section:'Sec 395 IPC',       district:'Belagavi District', fir:'10000400102026000456', status:'Wanted',     addedDate:'2026-02-11', description:'Armed dacoity at highway dhaba. Escaped on motorcycle. Reward: ₹50,000.' },
  { id:'A006', name:'Venkatesh B',       alias:'Venku',       age:45, gender:'Male',   crimeHead:'Hurt / GH',           section:'Sec 326 IPC',       district:'Ballari',           fir:'10000200052026000789', status:'Arrested',   addedDate:'2026-02-18', description:'Grievous hurt in property dispute. Arrested at Hospet bus stand.' },
  { id:'A007', name:'Deepa Kumari',      alias:'Deepa',       age:23, gender:'Female', crimeHead:'Dowry Death',         section:'Sec 304B IPC',      district:'Tumakuru',          fir:'10003300032026001567', status:'Wanted',     addedDate:'2026-03-04', description:'Alleged dowry harassment leading to victim death. FIR filed by victim family.' },
  { id:'A008', name:'Imran Khan A',      alias:'Imran',       age:31, gender:'Male',   crimeHead:'Cyber Stalking',      section:'Sec 66E IT Act',    district:'Bengaluru South',   fir:'10000700062026003001', status:'Absconding', addedDate:'2026-03-12', description:'Repeated cyberstalking of multiple women. Technical tracking underway.' },
  { id:'A009', name:'Srinivasa Murthy',  alias:'SM',          age:52, gender:'Male',   crimeHead:'Bank Fraud',          section:'Sec 420 IPC',       district:'Bengaluru City',    fir:'10000500072026004321', status:'Arrested',   addedDate:'2026-03-19', description:'₹4.2 Crore bank fraud via shell companies. Arrested at Kempegowda airport.' },
  { id:'A010', name:'Basha Mohammed',    alias:'Basha',       age:36, gender:'Male',   crimeHead:'NDPS Possession',     section:'Sec 21 NDPS',       district:'Raichur',           fir:'10003100082026000234', status:'Arrested',   addedDate:'2026-04-02', description:'Seized with 12kg brown sugar. Arrested near Raichur railway station.' },
  { id:'A011', name:'Chandra Shekar R',  alias:'CS',          age:44, gender:'Male',   crimeHead:'Murder',              section:'Sec 302 IPC',       district:'Kalaburagi Dist',   fir:'10002100012026000543', status:'Wanted',     addedDate:'2026-04-15', description:'Honour killing suspect. Last seen near Maharashtra border. Lookout notice issued.' },
  { id:'A012', name:'Kavitha S',         alias:'Kavitha',     age:26, gender:'Female', crimeHead:'SC/ST Atrocity',      section:'Sec 3(1) SC/ST POA',district:'Yadgir',            fir:'10003800052026000678', status:'Absconding', addedDate:'2026-04-28', description:'Accused in caste-based atrocity case. Anticipatory bail rejected.' },
  { id:'A013', name:'Nagesh Patil',      alias:'Nagu',        age:39, gender:'Male',   crimeHead:'Robbery',             section:'Sec 392 IPC',       district:'Vijayapur',         fir:'10003700102026000912', status:'Wanted',     addedDate:'2026-05-06', description:'Serial jewellery robbery. 5 cases in Bijapur-Bagalkot belt. Reward: ₹25,000.' },
  { id:'A014', name:'Rajesh Kumar N',    alias:'RK',          age:33, gender:'Male',   crimeHead:'Attempt to Murder',   section:'Sec 307 IPC',       district:'Bengaluru City',    fir:'10000500012026005432', status:'Arrested',   addedDate:'2026-05-20', description:'Rival gang attack near Hebbal. Arrested after 3-day manhunt.' },
  { id:'A015', name:'Savitha Devi',      alias:'Savitha',     age:48, gender:'Female', crimeHead:'Cheating',            section:'Sec 420 IPC',       district:'Mangaluru City',    fir:'10002800072026001289', status:'Absconding', addedDate:'2026-06-01', description:'Multi-level chit fund fraud affecting 200+ victims. ₹80L collected, absconded.' },
]

const STATUS_STYLE = {
  Wanted:     { bg: 'bg-red-900/40',    text: 'text-red-400',    icon: AlertTriangle },
  Arrested:   { bg: 'bg-green-900/40',  text: 'text-green-400',  icon: CheckCircle2  },
  Absconding: { bg: 'bg-amber-900/40',  text: 'text-amber-400',  icon: Clock         },
}

export default function WantedPage() {
  const [search, setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState<'All' | 'Wanted' | 'Arrested' | 'Absconding'>('All')
  const [selected, setSelected] = useState<typeof WANTED[0] | null>(null)

  const filtered = WANTED.filter(p => {
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.fir.includes(search) ||
      p.district.toLowerCase().includes(search.toLowerCase()) ||
      p.crimeHead.toLowerCase().includes(search.toLowerCase())
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
        <p className="text-sm text-gray-400 mt-1">Accused register from registered FIRs — Karnataka State Police</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {(['Wanted','Arrested','Absconding'] as const).map(s => {
          const style = STATUS_STYLE[s]
          const Icon  = style.icon
          return (
            <div key={s} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
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
            placeholder="Search by name, FIR no, district, crime..."
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
                {['ID','Name / Alias','Age','Crime Head','Section','District','FIR No','Status',''].map(h => (
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
                    <td className="px-4 py-3"><span className="font-mono text-xs text-blue-400">{p.section}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{p.district}</td>
                    <td className="px-4 py-3"><span className="font-mono text-xs text-purple-400">{p.fir.slice(-6)}</span></td>
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

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <div className="flex items-center gap-3">
                <div className="bg-gray-800 rounded-full h-10 w-10 flex items-center justify-center">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-base font-bold text-white">{selected.name}</p>
                  <p className="text-xs text-gray-400">"{selected.alias}" · {selected.age} yrs · {selected.gender}</p>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="px-6 py-4 space-y-3">
              {[
                ['Accused ID',  selected.id],
                ['Crime Head',  selected.crimeHead],
                ['Section',     selected.section],
                ['FIR Number',  selected.fir],
                ['District',    selected.district],
                ['Added On',    selected.addedDate],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-white font-medium font-mono text-xs">{val}</span>
                </div>
              ))}
              <div className="bg-gray-800 rounded-xl p-3 mt-2">
                <p className="text-xs text-gray-400 mb-1">Case Notes</p>
                <p className="text-sm text-gray-200 leading-relaxed">{selected.description}</p>
              </div>
              <div className="flex justify-center pt-1">
                {(() => { const style = STATUS_STYLE[selected.status]; const Icon = style.icon; return (
                  <span className={`inline-flex items-center gap-1.5 text-sm font-bold px-4 py-1.5 rounded-full ${style.bg} ${style.text}`}>
                    <Icon className="h-4 w-4" />{selected.status}
                  </span>
                )})()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
