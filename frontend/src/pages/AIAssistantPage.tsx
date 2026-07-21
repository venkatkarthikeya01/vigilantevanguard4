import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Mic, MicOff, Send, User, Loader2, Volume2, VolumeX, AlertCircle, Zap } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  language: string
  source?: 'local' | 'backend'
}

declare global {
  interface Window { SpeechRecognition: any; webkitSpeechRecognition: any }
}

// ═══════════════════════════════════════════════════════════════
//  KSP CRIME DATA — Jan–Jun 2026 (from official PDFs)
// ═══════════════════════════════════════════════════════════════
const KSP = {
  murder:    [98, 73, 104, 78, 94, 113],   // Jan–Jun
  robbery:   [92, 86, 102, 82, 101, 94],
  chainSnatch:[29,33,  38, 30,  36,  39],
  dacoity:   [6,  14,  18,  7,  15,  16],
  burglary:  [441,380, 345,397, 381, 335],
  theft:     [1742,1637,1713,1694,1740,1589],
  hurt:      [1437,1418,1784,1756,1710,1565],
  rape:      [45, 41,  48,  56,  57,  63],
  dowryDeath:[11,  5,  18,  15,  10,   8],
  pocso:     [316,341, 368, 394, 406, 374],
  scst:      [223,203, 225, 237, 232, 240],
  cyber:     [1259,1028,1013,928, 947, 921],
  ndps:      [1397,980,1017, 940, 813,1232],
  mvTheft:   [767,683, 755, 804, 761, 706],
  riots:     [319,268, 332, 342, 383, 378],
  sll:       [5857,5304,6726,5395,5563,5996],
  ecoOffences:[470,633,494,546,542,543],
}
const MONTHS = ['January','February','March','April','May','June']
const MONTHS_KN = ['ಜನವರಿ','ಫೆಬ್ರವರಿ','ಮಾರ್ಚ್','ಏಪ್ರಿಲ್','ಮೇ','ಜೂನ್']

const sum = (arr: number[]) => arr.reduce((a,b)=>a+b,0)
const fmt = (n: number) => n.toLocaleString('en-IN')
const maxMonth = (arr: number[]) => MONTHS[arr.indexOf(Math.max(...arr))]
const minMonth = (arr: number[]) => MONTHS[arr.indexOf(Math.min(...arr))]

const MURDER_MOTIVES: Record<string,number[]> = {
  'Sudden Quarrel':       [48,10,17,25,33,46],
  'Due to Other Causes':  [76,13,21,50,63,76],
  'Revenge/Enmity':       [15, 1, 5,10,18,25],
  'Civil Disputes':       [4,  7,11,16,22,29],
  'For Gain':             [5,  8, 3, 1, 3, 6],
  'Love Intrigue':        [2,  1, 4, 5, 5, 8],
  'Rape with Murder':     [2,  4, 5, 5, 5, 5],
  'Sexual Jealousy':      [1,  2, 3, 3, 7, 7],
  'Adultery':             [2,  2, 5, 7, 7,10],
  'Property Dispute':     [0,  5, 3, 6, 6, 8],
}

const MURDER_WEAPONS: Record<string,number[]> = {
  'Sharp Weapons':        [33,21,37,29,28,40],
  'Blunt Objects':        [20,14,22,18,21,24],
  'Hands/Legs/Teeth':     [15,10,17,14,17,18],
  'Firearms':             [8,  5, 9, 5, 8,10],
  'Fire/Burning':         [5,  3, 5, 3, 4, 5],
  'Strangulation':        [7,  6, 7, 4, 8, 8],
  'Poison':               [4,  4, 3, 2, 3, 4],
  'Other/Unknown':        [6, 10, 4, 3, 5, 4],
}

const TOP_DISTRICTS: Record<string,{district:string,value:number}[]> = {
  murder: [
    {district:'Bengaluru City',value:89},
    {district:'Mysuru City',value:34},
    {district:'Kalaburagi',value:31},
    {district:'Belagavi Dist',value:28},
    {district:'Shivamogga',value:24},
  ],
  cyber: [
    {district:'Bengaluru City',value:3102},
    {district:'Mysuru City',value:421},
    {district:'Hubballi Dharwad',value:312},
    {district:'Kalaburagi City',value:198},
    {district:'Mangaluru City',value:187},
  ],
  theft: [
    {district:'Bengaluru City',value:5241},
    {district:'Mysuru City',value:892},
    {district:'Hubballi Dharwad',value:521},
    {district:'Belagavi City',value:412},
    {district:'Davanagere',value:398},
  ],
  ndps: [
    {district:'Bengaluru City',value:1821},
    {district:'Belagavi City',value:521},
    {district:'Kalaburagi',value:412},
    {district:'Vijayapur',value:382},
    {district:'Dakshina Kannada',value:341},
  ],
  pocso: [
    {district:'Bengaluru City',value:412},
    {district:'Kalaburagi',value:198},
    {district:'Mysuru Dist',value:156},
    {district:'Belagavi Dist',value:143},
    {district:'Raichur',value:132},
  ],
}

// ═══════════════════════════════════════════════════════════════
//  LOCAL AI ENGINE — pattern-match questions to KSP data
// ═══════════════════════════════════════════════════════════════
function localAnswer(q: string, lang: 'en' | 'kn'): string {
  const ql = q.toLowerCase()
  const kn = lang === 'kn'

  // helper: month index from question
  const getMi = (): number => {
    for (let i=0;i<MONTHS.length;i++) {
      if (ql.includes(MONTHS[i].toLowerCase()) || ql.includes(MONTHS_KN[i])) return i
    }
    return -1
  }
  const mi = getMi()
  const mLabel = mi>=0 ? MONTHS[mi] : null

  // ── MURDER ──────────────────────────────────────────────────
  if (/murder|ಕೊಲೆ/.test(ql)) {
    if (/motive|reason|why|cause|ಕಾರಣ/.test(ql)) {
      if (kn) {
        const lines = Object.entries(MURDER_MOTIVES).map(([m,v])=>`${m}: ${fmt(sum(v))}`).join('\n')
        return `2026 ಜನವರಿ–ಜೂನ್ ಕೊಲೆ ಕಾರಣಗಳು:\n\n${lines}\n\nಅತ್ಯಧಿಕ: "Due to Other Causes" (${fmt(sum(MURDER_MOTIVES['Due to Other Causes']))} ಪ್ರಕರಣಗಳು)`
      }
      const lines = Object.entries(MURDER_MOTIVES).map(([m,v])=>`• ${m}: ${fmt(sum(v))} cases`).join('\n')
      return `Murder Motives — Jan to Jun 2026 (Total: ${fmt(sum(KSP.murder))} murders)\n\n${lines}\n\nTop motive: "Due to Other Causes" (${fmt(sum(MURDER_MOTIVES['Due to Other Causes']))} cases)`
    }
    if (/weapon|arm|knife|gun|ಆಯುಧ|ಶಸ್ತ್ರ/.test(ql)) {
      if (kn) {
        const lines = Object.entries(MURDER_WEAPONS).map(([w,v])=>`${w}: ${fmt(sum(v))}`).join('\n')
        return `2026 ಕೊಲೆಗಳಲ್ಲಿ ಬಳಸಿದ ಆಯುಧಗಳು:\n\n${lines}\n\nಅತ್ಯಧಿಕ: ಚೂಪಾದ ಆಯುಧಗಳು (${fmt(sum(MURDER_WEAPONS['Sharp Weapons']))} ಪ್ರಕರಣಗಳು)`
      }
      const lines = Object.entries(MURDER_WEAPONS).map(([w,v])=>`• ${w}: ${fmt(sum(v))} cases`).join('\n')
      return `Weapons Used in Murders — Jan to Jun 2026\n\n${lines}\n\nMost common: Sharp Weapons (${fmt(sum(MURDER_WEAPONS['Sharp Weapons']))} cases)`
    }
    if (/district|top|highest|area|ಜಿಲ್ಲೆ/.test(ql)) {
      const lines = TOP_DISTRICTS.murder.map((d,i)=>`${i+1}. ${d.district}: ${fmt(d.value)} murders`).join('\n')
      if (kn) return `ಹೆಚ್ಚು ಕೊಲೆ ಪ್ರಕರಣಗಳ ಜಿಲ್ಲೆಗಳು (ಜನ–ಜೂನ್ 2026):\n\n${lines}`
      return `Top Districts for Murder — Jan to Jun 2026\n\n${lines}`
    }
    if (mLabel) {
      const v = KSP.murder[mi]
      if (kn) return `${MONTHS_KN[mi]} 2026ರಲ್ಲಿ ಕರ್ನಾಟಕದಲ್ಲಿ ${fmt(v)} ಕೊಲೆ ಪ್ರಕರಣಗಳು ದಾಖಲಾಗಿವೆ.\n\n6 ತಿಂಗಳ ಒಟ್ಟು: ${fmt(sum(KSP.murder))} | ಅತ್ಯಧಿಕ: ${maxMonth(KSP.murder)} (${fmt(Math.max(...KSP.murder))})`
      return `In ${mLabel} 2026, Karnataka recorded ${fmt(v)} murder cases.\n\n6-Month Total: ${fmt(sum(KSP.murder))} | Highest: ${maxMonth(KSP.murder)} (${fmt(Math.max(...KSP.murder))}) | Lowest: ${minMonth(KSP.murder)} (${fmt(Math.min(...KSP.murder))})`
    }
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.murder[i])}`).join('  |  ')
    if (kn) return `2026 ಜನವರಿ–ಜೂನ್ ಕೊಲೆ ಅಂಕಿಅಂಶಗಳು:\n\n${MONTHS_KN.map((m,i)=>`${m}: ${fmt(KSP.murder[i])}`).join('\n')}\n\nಒಟ್ಟು: ${fmt(sum(KSP.murder))} | ಅತ್ಯಧಿಕ: ${maxMonth(KSP.murder)} (${fmt(Math.max(...KSP.murder))})`
    return `Karnataka Murder Cases — Jan to Jun 2026\n\n${rows}\n\nTotal: ${fmt(sum(KSP.murder))} | Peak: ${maxMonth(KSP.murder)} (${fmt(Math.max(...KSP.murder))}) | Lowest: ${minMonth(KSP.murder)} (${fmt(Math.min(...KSP.murder))})`
  }

  // ── RAPE / SEXUAL OFFENCES ───────────────────────────────────
  if (/rape|sexual|ಬಲಾತ್ಕಾರ|ಲೈಂಗಿಕ/.test(ql)) {
    if (mLabel) {
      return `Rape cases in ${mLabel} 2026: ${fmt(KSP.rape[mi])}\n\nJan–Jun 2026 Total: ${fmt(sum(KSP.rape))} rape cases registered across Karnataka.\nPeak month: ${maxMonth(KSP.rape)} with ${fmt(Math.max(...KSP.rape))} cases — showing a rising trend.\n\nRelevant sections: IPC 376, BNS 64, POCSO Act`
    }
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.rape[i])}`).join(' | ')
    return `Rape Cases — Jan to Jun 2026\n\n${rows}\n\nTotal: ${fmt(sum(KSP.rape))} | Trend: Increasing (${KSP.rape[0]} → ${KSP.rape[5]})\nPOCSO (child sexual offences): ${fmt(sum(KSP.pocso))} (much higher — includes all child protection offences)`
  }

  // ── POCSO ──────────────────────────────────────────────────
  if (/pocso|child|children|ಮಕ್ಕಳ/.test(ql)) {
    if (mLabel) {
      return `POCSO cases in ${mLabel} 2026: ${fmt(KSP.pocso[mi])}\n\nThis is one of the highest-priority crime categories in Karnataka.`
    }
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.pocso[i])}`).join(' | ')
    const top = TOP_DISTRICTS.pocso.map((d,i)=>`${i+1}. ${d.district}: ${d.value}`).join('\n')
    return `POCSO Cases (Protection of Children from Sexual Offences) — 2026\n\n${rows}\n\nTotal Jan–Jun: ${fmt(sum(KSP.pocso))} | Peak: ${maxMonth(KSP.pocso)}\n\nTop 5 Districts:\n${top}\n\nKey sections: POCSO Act Sec 3,4,5,6,7,8 | IPC 376AB`
  }

  // ── THEFT ─────────────────────────────────────────────────
  if (/theft|steal|stolen|ಕಳ್ಳತನ/.test(ql) && !/vehicle|mv|bike|car/.test(ql)) {
    if (/district|top|highest|ಜಿಲ್ಲೆ/.test(ql)) {
      const lines = TOP_DISTRICTS.theft.map((d,i)=>`${i+1}. ${d.district}: ${fmt(d.value)}`).join('\n')
      return `Top Districts for Theft (Jan–Jun 2026):\n\n${lines}\n\nBengaluru City dominates with over 50% of state total.`
    }
    if (mLabel) return `Theft cases in ${mLabel} 2026: ${fmt(KSP.theft[mi])}\n\nState average: ~${fmt(Math.round(sum(KSP.theft)/6))} per month | 6-month total: ${fmt(sum(KSP.theft))}`
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.theft[i])}`).join(' | ')
    return `Theft Cases — Jan to Jun 2026\n\n${rows}\n\nTotal: ${fmt(sum(KSP.theft))} | Monthly avg: ${fmt(Math.round(sum(KSP.theft)/6))}\nIncludes house theft, shoplifting, pickpocketing. IPC 379/380/381`
  }

  // ── VEHICLE THEFT / MV THEFT ──────────────────────────────
  if (/vehicle|mv theft|bike|car theft|motor|ವಾಹನ/.test(ql)) {
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.mvTheft[i])}`).join(' | ')
    if (mLabel) return `MV Theft in ${mLabel} 2026: ${fmt(KSP.mvTheft[mi])}\nJan–Jun total: ${fmt(sum(KSP.mvTheft))}`
    return `Motor Vehicle Theft — Jan to Jun 2026\n\n${rows}\n\nTotal: ${fmt(sum(KSP.mvTheft))} | Peak: ${maxMonth(KSP.mvTheft)} (${fmt(Math.max(...KSP.mvTheft))})\nIncludes 2-wheelers, 4-wheelers and commercial vehicles. IPC 379`
  }

  // ── CYBER CRIME ────────────────────────────────────────────
  if (/cyber|online|fraud|scam|hacking|ಸೈಬರ್/.test(ql)) {
    if (/district|top|highest|ಜಿಲ್ಲೆ/.test(ql)) {
      const lines = TOP_DISTRICTS.cyber.map((d,i)=>`${i+1}. ${d.district}: ${fmt(d.value)}`).join('\n')
      if (kn) return `ಸೈಬರ್ ಅಪರಾಧ ಹೆಚ್ಚಿರುವ ಜಿಲ್ಲೆಗಳು (ಜನ–ಜೂನ್ 2026):\n\n${lines}`
      return `Top Districts for Cyber Crime (Jan–Jun 2026):\n\n${lines}\n\nBengaluru City accounts for ~50% of all cyber crimes.`
    }
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.cyber[i])}`).join(' | ')
    if (kn) return `ಸೈಬರ್ ಅಪರಾಧ 2026 ಜನ–ಜೂನ್:\n\n${MONTHS_KN.map((m,i)=>`${m}: ${fmt(KSP.cyber[i])}`).join('\n')}\n\nಒಟ್ಟು: ${fmt(sum(KSP.cyber))} | ಜನವರಿ ತಿಂಗಳಲ್ಲಿ ಅತ್ಯಧಿಕ (${fmt(KSP.cyber[0])})`
    return `Cyber Crimes — Jan to Jun 2026\n\n${rows}\n\nTotal: ${fmt(sum(KSP.cyber))} | Trend: Declining (${KSP.cyber[0]} → ${KSP.cyber[5]})\nCategories: Online fraud, OTP scams, social media abuse, hacking\nKey sections: IT Act 66C, 66D, 67A`
  }

  // ── NDPS / NARCOTICS ────────────────────────────────────────
  if (/ndps|narcotic|drug|ganja|cocaine|ಮಾದಕ|ಡ್ರಗ್/.test(ql)) {
    if (/surge|increase|rise|high|jan|ಜನವರಿ/.test(ql)) {
      return `NDPS Surge Analysis:\n\nJanuary 2026 saw ${fmt(KSP.ndps[0])} NDPS cases — the highest in the first half.\nThis spike coincided with post-New Year law enforcement drives.\n\nFeb drop to ${fmt(KSP.ndps[1])} then stabilised around 940–1017.\nJune saw a resurgence to ${fmt(KSP.ndps[5])} — likely summer festival season.\n\nTop districts: Bengaluru City, Belagavi, Kalaburagi, Vijayapur\nKey sections: NDPS Act Sec 8, 20, 21, 22`
    }
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.ndps[i])}`).join(' | ')
    return `NDPS (Narcotic Drugs) Cases — Jan to Jun 2026\n\n${rows}\n\nTotal: ${fmt(sum(KSP.ndps))} | Peak: ${maxMonth(KSP.ndps)} (${fmt(Math.max(...KSP.ndps))})\nSubstances: Ganja, Heroin, Brown Sugar, Cocaine, Synthetic drugs`
  }

  // ── SC/ST ─────────────────────────────────────────────────
  if (/sc.?st|scheduled|atrocit|dalit|ಪರಿಶಿಷ್ಟ/.test(ql)) {
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.scst[i])}`).join(' | ')
    return `SC/ST (Prevention of Atrocities) Act Cases — Jan to Jun 2026\n\n${rows}\n\nTotal: ${fmt(sum(KSP.scst))} | Trend: Steady increase\nPeak: ${maxMonth(KSP.scst)} (${fmt(Math.max(...KSP.scst))})\n\nKey sections: SC/ST POA Act Sec 3(1), 3(2), 14A`
  }

  // ── ROBBERY / DACOITY ────────────────────────────────────
  if (/robber|chain.?snatch|ದರೋಡೆ/.test(ql)) {
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.robbery[i])} (chain snatch: ${KSP.chainSnatch[i]})`).join('\n')
    return `Robbery Cases — Jan to Jun 2026\n\n${rows}\n\nTotal robbery: ${fmt(sum(KSP.robbery))} | Chain snatch: ${fmt(sum(KSP.chainSnatch))}\nIPC 392/393 (Robbery) | IPC 395/396 (Dacoity)`
  }

  if (/dacoity|dacoit/.test(ql)) {
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.dacoity[i])}`).join(' | ')
    return `Dacoity Cases — Jan to Jun 2026\n\n${rows}\n\nTotal: ${fmt(sum(KSP.dacoity))} | Peak: ${maxMonth(KSP.dacoity)}\nIPC 395 (Dacoity), IPC 396 (Dacoity with murder)`
  }

  // ── BURGLARY ─────────────────────────────────────────────
  if (/burglar|break.?in|ಕಳ್ಳ ಪ್ರವೇಶ/.test(ql)) {
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.burglary[i])}`).join(' | ')
    return `Burglary Cases — Jan to Jun 2026\n\n${rows}\n\nTotal: ${fmt(sum(KSP.burglary))}\nNight burglary typically accounts for ~80% of total burglaries.\nIPC 457/458 (Lurking house-trespass by night)`
  }

  // ── DOWRY / DOMESTIC ─────────────────────────────────────
  if (/dowry|498|domestic|ವರದಕ್ಷಿಣೆ/.test(ql)) {
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.dowryDeath[i])}`).join(' | ')
    return `Dowry Death Cases — Jan to Jun 2026\n\n${rows}\n\nTotal: ${fmt(sum(KSP.dowryDeath))} | Peak: ${maxMonth(KSP.dowryDeath)}\nIPC 304B (Dowry Death) | IPC 498A (Cruelty by husband/relatives)\nBNS 80 (Dowry death)`
  }

  // ── HURT ─────────────────────────────────────────────────
  if (/\bhurt\b|grievous|assault|ಗಾಯ/.test(ql)) {
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.hurt[i])}`).join(' | ')
    return `Hurt/GBH Cases — Jan to Jun 2026\n\n${rows}\n\nTotal: ${fmt(sum(KSP.hurt))} | Peak: ${maxMonth(KSP.hurt)}\nIncludes simple hurt, grievous hurt, assault cases.\nIPC 323, 324, 325, 326 | BNS 115, 117`
  }

  // ── RIOTS ────────────────────────────────────────────────
  if (/riot|unlawful|mob|disturbance|ಗಲಭೆ/.test(ql)) {
    const rows = MONTHS.map((m,i)=>`${m}: ${fmt(KSP.riots[i])}`).join(' | ')
    return `Riots/Public Order Cases — Jan to Jun 2026\n\n${rows}\n\nTotal: ${fmt(sum(KSP.riots))} | Peak: ${maxMonth(KSP.riots)}\nIPC 147, 148, 149 (Riot) | IPC 107/109/110 (Preventive action)`
  }

  // ── OVERALL SUMMARY ──────────────────────────────────────
  if (/summary|overview|total|all crime|overall|ಒಟ್ಟು|ಸಾರಾಂಶ/.test(ql)) {
    if (kn) {
      return `ಕರ್ನಾಟಕ ರಾಜ್ಯ ಪೊಲೀಸ್ — 2026 ಜನ–ಜೂನ್ ಅಪರಾಧ ಸಾರಾಂಶ\n\nಕೊಲೆ: ${fmt(sum(KSP.murder))}\nಬಲಾತ್ಕಾರ: ${fmt(sum(KSP.rape))}\nPOCSO: ${fmt(sum(KSP.pocso))}\nSC/ST: ${fmt(sum(KSP.scst))}\nದರೋಡೆ: ${fmt(sum(KSP.robbery))}\nಕಳ್ಳತನ: ${fmt(sum(KSP.theft))}\nಸೈಬರ್ ಅಪರಾಧ: ${fmt(sum(KSP.cyber))}\nNDPS: ${fmt(sum(KSP.ndps))}\nವಾಹನ ಕಳ್ಳತನ: ${fmt(sum(KSP.mvTheft))}\nಗಾಯ: ${fmt(sum(KSP.hurt))}`
    }
    return `Karnataka Crime Summary — Jan to Jun 2026\n\n` +
      `Murder:       ${fmt(sum(KSP.murder))}\n` +
      `Rape:         ${fmt(sum(KSP.rape))}\n` +
      `POCSO:        ${fmt(sum(KSP.pocso))}\n` +
      `SC/ST:        ${fmt(sum(KSP.scst))}\n` +
      `Robbery:      ${fmt(sum(KSP.robbery))}  (Chain Snatch: ${fmt(sum(KSP.chainSnatch))})\n` +
      `Dacoity:      ${fmt(sum(KSP.dacoity))}\n` +
      `Burglary:     ${fmt(sum(KSP.burglary))}\n` +
      `Theft:        ${fmt(sum(KSP.theft))}\n` +
      `Hurt:         ${fmt(sum(KSP.hurt))}\n` +
      `Dowry Death:  ${fmt(sum(KSP.dowryDeath))}\n` +
      `Cyber:        ${fmt(sum(KSP.cyber))}\n` +
      `NDPS:         ${fmt(sum(KSP.ndps))}\n` +
      `MV Theft:     ${fmt(sum(KSP.mvTheft))}\n` +
      `Riots:        ${fmt(sum(KSP.riots))}\n\n` +
      `Data source: KSP CCTNS Monthly Crime Review (provisional as on report dates)`
  }

  // ── TREND ANALYSIS ────────────────────────────────────────
  if (/trend|increase|decreas|rise|fall|pattern|ಹೆಚ್ಚಳ|ಇಳಿಕೆ/.test(ql)) {
    return `Crime Trend Analysis — Jan to Jun 2026\n\n` +
      `📈 RISING trends:\n` +
      `• Murder: ${KSP.murder[0]} → ${KSP.murder[5]} (+${KSP.murder[5]-KSP.murder[0]})\n` +
      `• Rape: ${KSP.rape[0]} → ${KSP.rape[5]} (+${KSP.rape[5]-KSP.rape[0]}) — alarming 40% rise\n` +
      `• POCSO: ${KSP.pocso[0]} → ${KSP.pocso[5]} (fluctuating but elevated)\n` +
      `• SC/ST: ${KSP.scst[0]} → ${KSP.scst[5]} (steady increase)\n\n` +
      `📉 DECLINING trends:\n` +
      `• Cyber Crime: ${KSP.cyber[0]} → ${KSP.cyber[5]} (−${KSP.cyber[0]-KSP.cyber[5]})\n` +
      `• NDPS: ${KSP.ndps[0]} → ${KSP.ndps[5]} (Feb dip, Jun resurgence)\n\n` +
      `⚠️ HOTSPOT months: March (murder peak), January (NDPS peak), June (murder resurgence)`
  }

  // ── IPC/BNS SECTIONS ─────────────────────────────────────
  if (/ipc|bns|section|sec\.|bnss|ಸೆಕ್ಷನ್/.test(ql)) {
    return `IPC → BNS Section Reference (Key Offences):\n\n` +
      `IPC 302 → BNS 103 : Murder\n` +
      `IPC 307 → BNS 109 : Attempt to murder\n` +
      `IPC 376 → BNS 64  : Rape\n` +
      `IPC 376D → BNS 70 : Gang rape\n` +
      `IPC 304B → BNS 80 : Dowry death\n` +
      `IPC 498A → BNS 85 : Cruelty to wife\n` +
      `IPC 395 → BNS 310 : Dacoity\n` +
      `IPC 379 → BNS 303 : Theft\n` +
      `IPC 420 → BNS 318 : Cheating\n` +
      `POCSO Act 3/4     : Penetrative sexual assault (child)\n` +
      `NDPS Act 20/21    : Cannabis/other narcotic possession\n` +
      `SC/ST POA 3(1)    : Atrocity against SC/ST member\n\n` +
      `Note: BNS (Bharatiya Nyaya Sanhita) replaced IPC from Jul 2024`
  }

  // ── FIR FORMAT ────────────────────────────────────────────
  if (/fir|crime.?no|case.?no|format|ಎಫ್.ಐ.ಆರ್/.test(ql)) {
    return `FIR / Crime Number Format — Karnataka Police\n\n` +
      `Format: CategoryCode(1) + DistrictID(4) + StationID(4) + Year(4) + Serial(5)\n\n` +
      `Examples:\n` +
      `• FIR:      1 0443 0006 2026 00001\n` +
      `• UDR:      3 0443 0006 2026 00001\n` +
      `• PAR:      4 0443 0006 2026 00001\n` +
      `• Zero FIR: 8 0443 0006 2026 00001\n\n` +
      `Case categories: FIR=1, UDR=3 (Unnatural Death), PAR=4 (Preventive Action), Zero FIR=8\n` +
      `Registered under: Sec 154 CrPC / Sec 173 BNSS`
  }

  // ── PREVENTIVE ACTIONS ───────────────────────────────────
  if (/preventive|107|109|110|126|128|129|ತಡೆಗಟ್ಟುವ/.test(ql)) {
    return `Preventive Actions (Sec 107/109/110 CrPC → 126/128/129 BNSS) — 2026\n\n` +
      `Jan: 2,330  |  Feb: 3,155  |  Mar: 5,052\n` +
      `Apr: 3,419  |  May: 5,745  |  Jun: 5,137\n\n` +
      `Total: ${fmt(2330+3155+5052+3419+5745+5137)} preventive actions\n` +
      `Peak: May 2026 (5,745) — summer crime prevention drives\n\n` +
      `Sec 107: Breach of peace | Sec 109: Suspected persons | Sec 110: Habitual offenders`
  }

  // ── BENGALURU / CITY SPECIFIC ────────────────────────────
  if (/bengaluru|bangalore|ಬೆಂಗಳೂರು/.test(ql)) {
    return `Bengaluru City Crime Highlights — Jan to Jun 2026\n\n` +
      `Bengaluru City is the highest-crime district in Karnataka:\n\n` +
      `• Murder: ~89 (16% of state total)\n` +
      `• Cyber Crime: ~3,102 (50% of state total)\n` +
      `• Theft: ~5,241 (52% of state total)\n` +
      `• NDPS: ~1,821 (29% of state total)\n` +
      `• POCSO: ~412 (19% of state total)\n\n` +
      `Bengaluru City is policed by Bengaluru City Commissionerate — separate from Bengaluru District and Bengaluru South.`
  }

  // ── DEFAULT: unknown question ─────────────────────────────
  if (kn) {
    return `ನಿಮ್ಮ ಪ್ರಶ್ನೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಈ ವಿಷಯಗಳ ಬಗ್ಗೆ ಕೇಳಿ:\n\n• ಕೊಲೆ, ಬಲಾತ್ಕಾರ, POCSO ಅಂಕಿಅಂಶ\n• ಸೈಬರ್ ಅಪರಾಧ, NDPS ಪ್ರಕರಣಗಳು\n• ಕಳ್ಳತನ, ದರೋಡೆ ಮಾಹಿತಿ\n• ಜಿಲ್ಲಾ ಅಪರಾಧ ವಿಶ್ಲೇಷಣೆ\n• IPC/BNS ಸೆಕ್ಷನ್ ಮಾಹಿತಿ`
  }
  return `I can answer questions about:\n\n• Murder, rape, POCSO, robbery, theft, cyber crime, NDPS statistics (Jan–Jun 2026)\n• Monthly trends and district breakdowns\n• Murder motives and weapons analysis\n• IPC → BNS section reference\n• FIR number format\n• Preventive actions data\n\nTry asking: "How many murders in March 2026?" or "Which district has highest cyber crime?"`
}

// ═══════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function AIAssistantPage() {
  const [messages, setMessages] = useState<Message[]>([{
    role: 'assistant',
    content: 'ನಮಸ್ಕಾರ! I am the VigilanteVanguard AI Assistant for Karnataka State Police.\n\nI can help you with:\n• Crime statistics (Jan–Jun 2026)\n• Murder motives & weapon analysis\n• District-wise breakdowns\n• IPC/BNS section guidance\n• Trend analysis & intelligence briefings\n\nAsk me anything in English or ಕನ್ನಡ.',
    timestamp: new Date(),
    language: 'en',
    source: 'local',
  }])
  const [input, setInput] = useState('')
  const [language, setLanguage] = useState<'en' | 'kn'>('en')
  const [isRecording, setIsRecording] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [micPermission, setMicPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const bottomRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setMicPermission('denied'); return }
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => { stream.getTracks().forEach(t => t.stop()); setMicPermission('granted') })
      .catch(() => setMicPermission('denied'))
  }, [])

  const startVoice = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Voice input requires Chrome or Edge.'); return }
    if (micPermission === 'denied') { alert('Allow microphone access in the browser address bar, then refresh.'); return }
    const rec = new SR()
    rec.lang = language === 'kn' ? 'kn-IN' : 'en-IN'
    rec.interimResults = false
    rec.onresult = (e: any) => { setInput(e.results[0][0].transcript); setIsRecording(false) }
    rec.onerror = (e: any) => { if (e.error === 'not-allowed') setMicPermission('denied'); setIsRecording(false) }
    rec.onend = () => setIsRecording(false)
    recognitionRef.current = rec
    rec.start()
    setIsRecording(true)
  }, [language, micPermission])

  const stopVoice = useCallback(() => { recognitionRef.current?.stop(); setIsRecording(false) }, [])

  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text.slice(0, 500))
    u.lang = language === 'kn' ? 'kn-IN' : 'en-IN'
    u.rate = 0.9
    u.onstart = () => setIsSpeaking(true)
    u.onend = () => setIsSpeaking(false)
    u.onerror = () => setIsSpeaking(false)
    window.speechSynthesis.speak(u)
  }

  const stopSpeaking = () => { window.speechSynthesis?.cancel(); setIsSpeaking(false) }

  const sendMessage = async () => {
    const trimmed = input.trim()
    if (!trimmed || isThinking) return
    const userMsg: Message = { role: 'user', content: trimmed, timestamp: new Date(), language }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsThinking(true)
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)

    // ── Try local engine first (instant, no network) ──────────
    const localReply = localAnswer(trimmed, language)

    // ── Try backend (Ollama/Gemini) if available ─────────────
    let finalReply = localReply
    let source: 'local' | 'backend' = 'local'
    try {
      const { apiClient } = await import('@/lib/api')
      const r = await apiClient.post('/ai/chat', { message: trimmed, session_id: `session_${Date.now()}`, language }, { timeout: 25000 })
      if (r.data?.answer) { finalReply = r.data.answer; source = 'backend' }
    } catch {
      // Backend unavailable — local answer is already set
    }

    setIsThinking(false)
    const reply: Message = { role: 'assistant', content: finalReply, timestamp: new Date(), language, source }
    setMessages(prev => [...prev, reply])
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    speak(finalReply)
  }

  const QUICK_PROMPTS = [
    'How many murder cases in January 2026?',
    'What weapons were used in murders?',
    'Which district has highest cyber crime?',
    'Explain NDPS surge in Jan 2026',
    'POCSO cases Jan vs Feb 2026',
    'Crime trend analysis 2026',
    'ಜನವರಿ 2026 ರಲ್ಲಿ ಕೊಲೆ ಪ್ರಕರಣಗಳು ಎಷ್ಟು?',
    'ಸೈಬರ್ ಅಪರಾಧ ಯಾವ ಜಿಲ್ಲೆಯಲ್ಲಿ ಹೆಚ್ಚು?',
    'ಒಟ್ಟು ಅಪರಾಧ ಸಾರಾಂಶ',
  ]

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg"><Bot className="h-5 w-5 text-white" /></div>
          <div>
            <h2 className="text-sm font-semibold text-white">AI Crime Intelligence Assistant</h2>
            <p className="text-xs text-gray-400 flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-yellow-400" />
              <span className="text-yellow-400">Instant AI</span>
              <span className="text-gray-600">•</span>
              English & ಕನ್ನಡ
              <span className="text-gray-600">•</span>
              {micPermission === 'granted' && <span className="text-green-400">Mic ready</span>}
              {micPermission === 'denied'  && <span className="text-red-400">Mic blocked</span>}
              {micPermission === 'unknown' && <span className="text-yellow-400">Requesting mic...</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSpeaking && (
            <button onClick={stopSpeaking} className="flex items-center gap-1.5 text-xs bg-blue-600/20 border border-blue-500/50 text-blue-300 px-3 py-1.5 rounded-full">
              <VolumeX className="h-3.5 w-3.5" /> Stop
            </button>
          )}
          {(['en','kn'] as const).map(lang => (
            <button key={lang} onClick={() => setLanguage(lang)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${language===lang?'bg-blue-600 text-white':'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
              {lang==='en'?'English':'ಕನ್ನಡ'}
            </button>
          ))}
        </div>
      </div>

      {micPermission === 'denied' && (
        <div className="bg-red-950 border-b border-red-800 px-6 py-2 flex items-center gap-2 flex-shrink-0">
          <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300">Microphone blocked. Click the lock icon in the address bar → Allow microphone → Refresh.</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role==='user'?'flex-row-reverse':''}`}>
            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${msg.role==='assistant'?'bg-blue-600':'bg-gray-700'}`}>
              {msg.role==='assistant' ? <Bot className="h-4 w-4 text-white" /> : <User className="h-4 w-4 text-white" />}
            </div>
            <div className={`max-w-2xl rounded-2xl px-4 py-3 text-sm ${msg.role==='assistant'?'bg-gray-900 text-gray-100 border border-gray-800':'bg-blue-600 text-white'}`}>
              <pre className="whitespace-pre-wrap font-sans leading-relaxed">{msg.content}</pre>
              <div className="flex items-center justify-between mt-2 gap-4">
                <p className="text-xs opacity-40">{msg.timestamp.toLocaleTimeString('en-IN')}</p>
                {msg.role==='assistant' && (
                  <div className="flex items-center gap-2">
                    {msg.source==='local' && <span className="text-xs opacity-30 flex items-center gap-1"><Zap className="h-2.5 w-2.5" />instant</span>}
                    <button onClick={() => speak(msg.content)} className="text-xs opacity-40 hover:opacity-80 flex items-center gap-1">
                      <Volume2 className="h-3 w-3" /> Speak
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {isThinking && (
          <div className="flex gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
              <span className="text-sm text-gray-400">Analysing KSP crime data...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      <div className="px-6 pb-3 flex gap-2 flex-wrap flex-shrink-0">
        {QUICK_PROMPTS.map(p => (
          <button key={p} onClick={() => setInput(p)}
            className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-full transition-colors border border-gray-700 max-w-xs truncate">
            {p}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="bg-gray-900 border-t border-gray-800 px-6 py-4 flex-shrink-0">
        <div className="flex gap-3 items-end">
          <button onClick={isRecording ? stopVoice : startVoice}
            className={`flex-shrink-0 p-2.5 rounded-xl transition-colors ${isRecording?'bg-red-600 text-white animate-pulse':'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'}`}>
            {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder={language==='kn'?'ನಿಮ್ಮ ಪ್ರಶ್ನೆ ಟೈಪ್ ಮಾಡಿ...':'Type or press mic to ask about crimes, FIRs, suspects, hotspots...'}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500"
            rows={1} />
          <button onClick={sendMessage} disabled={!input.trim() || isThinking}
            className="flex-shrink-0 p-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl transition-colors">
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-2 text-center">
          ⚡ Instant AI (KSP Data 2026) • Ollama/Gemini when backend is live • Catalyst QuickML in production
        </p>
      </div>
    </div>
  )
}
