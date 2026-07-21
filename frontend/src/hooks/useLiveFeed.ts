/**
 * useLiveFeed — pure demo feed hook
 *
 * Generates a realistic, station-aware event stream entirely on the client.
 * No WebSocket, no REST polling — this is intentional demo mode.
 *
 * All connected pages share the same Zustand demo store so every tab /
 * device that has the app open sees the same rotating events in sync.
 */
import { useEffect, useRef, useCallback } from 'react'
import { useDemoStore, type DemoEvent } from '@/store/demo'

export type { DemoEvent as LiveEvent }

export interface UseLiveFeedResult {
  events:         DemoEvent[]
  connected:      boolean   // always false in demo — no real connection
  connectedUsers: number    // simulated user count
  lastEvent:      DemoEvent | null
  sendEvent:      (type: string, payload: Record<string, unknown>) => void
}

// ─── Curated demo events referencing real Karnataka stations ─────
const DEMO_TEMPLATES: Array<{
  type: DemoEvent['type']
  zone: string
  district: string
  stationName: string
  stationId: number
  mk: () => Record<string, unknown>
}> = [
  {
    type: 'FIR_REGISTERED', zone: 'Bengaluru', district: 'Bengaluru City',
    stationName: 'MG Road Police Station', stationId: 2,
    mk: () => ({ crime_no: `KA2026-${4800 + Math.floor(Math.random()*200)}`, brief_facts: 'Cyber fraud via UPI — complainant reports ₹2.4L deducted' }),
  },
  {
    type: 'ALERT', zone: 'Bengaluru', district: 'Bengaluru City',
    stationName: 'Koramangala Police Station', stationId: 3,
    mk: () => ({ message: 'Hotspot Alert: Chain snatching cluster — 3 cases in 2 hrs near Forum Mall', priority: 'Urgent' }),
  },
  {
    type: 'FIR_REGISTERED', zone: 'Bengaluru', district: 'Bengaluru City',
    stationName: 'Whitefield Police Station', stationId: 4,
    mk: () => ({ crime_no: `KA2026-${4900 + Math.floor(Math.random()*100)}`, brief_facts: 'Vehicle theft — two-wheeler taken from ITPL parking lot' }),
  },
  {
    type: 'BROADCAST', zone: 'Kalaburagi', district: 'Kalaburagi',
    stationName: 'Kalaburagi Central Police Station', stationId: 21,
    mk: () => ({ message: 'NDPS seizure: 1.8 kg contraband recovered — NH-50 checkpoint', priority: 'Urgent', zone: 'Kalaburagi' }),
  },
  {
    type: 'MISSING', zone: 'Mysuru', district: 'Mysuru City',
    stationName: 'Mysuru North Police Station', stationId: 17,
    mk: () => ({ message: 'Missing child alert — age 8, last seen near Devaraja Market', priority: 'Critical' }),
  },
  {
    type: 'DEPLOY', zone: 'Belagavi', district: 'Belagavi',
    stationName: 'Belagavi City Police Station', stationId: 24,
    mk: () => ({ message: 'Riot prevention deployment — 35 officers mobilised near Khade Bazar', priority: 'Normal' }),
  },
  {
    type: 'FIR_REGISTERED', zone: 'Bengaluru', district: 'Bengaluru City',
    stationName: 'Cubbon Park Police Station', stationId: 1,
    mk: () => ({ crime_no: `KA2026-${4830 + Math.floor(Math.random()*70)}`, brief_facts: 'POCSO case registered — immediate action initiated' }),
  },
  {
    type: 'WANTED', zone: 'Shivamogga', district: 'Shivamogga',
    stationName: 'Shivamogga Rural Police Station', stationId: 35,
    mk: () => ({ message: 'Wanted person sighted — Alert Level HIGH, Shivamogga bus terminal', priority: 'Critical' }),
  },
  {
    type: 'ALERT', zone: 'Bengaluru', district: 'Bengaluru City',
    stationName: 'Indiranagar Police Station', stationId: 5,
    mk: () => ({ message: 'Burglary alert: 3 houses broken into — 100ft Road stretch, night patrol reinforced', priority: 'Urgent' }),
  },
  {
    type: 'FIR_REGISTERED', zone: 'Dakshina', district: 'Dakshina Kannada',
    stationName: 'Mangaluru South Police Station', stationId: 37,
    mk: () => ({ crime_no: `KA2026-${4750 + Math.floor(Math.random()*50)}`, brief_facts: 'Domestic violence FIR — survivor at district hospital' }),
  },
  {
    type: 'BROADCAST', zone: 'Kalaburagi', district: 'Raichur',
    stationName: 'Raichur SP Office', stationId: 30,
    mk: () => ({ message: 'NDPS trend +18% above monthly average — additional nakas deployed', priority: 'Urgent', zone: 'Kalaburagi' }),
  },
  {
    type: 'DEPLOY', zone: 'Bengaluru', district: 'Bengaluru City',
    stationName: 'Bengaluru South Traffic Station', stationId: 14,
    mk: () => ({ message: 'Patrol reinforcement — Hosur Road flyover stretch, NH-44 night ops', priority: 'Normal' }),
  },
  {
    type: 'FIR_REGISTERED', zone: 'Coastal', district: 'Udupi',
    stationName: 'Udupi Town Police Station', stationId: 39,
    mk: () => ({ crime_no: `KA2026-${4780 + Math.floor(Math.random()*60)}`, brief_facts: 'SC/ST atrocity FIR — Udupi district, immediate legal aid deployed' }),
  },
  {
    type: 'ALERT', zone: 'Mysuru', district: 'Mysuru City',
    stationName: 'Mysuru South Police Station', stationId: 18,
    mk: () => ({ message: 'Road accident cluster — 2 fatal, 5 non-fatal on Mysuru-Bengaluru highway stretch', priority: 'Critical' }),
  },
  {
    type: 'FIR_REGISTERED', zone: 'Belagavi', district: 'Belagavi',
    stationName: 'Belagavi Rural Police Station', stationId: 25,
    mk: () => ({ crime_no: `KA2026-${4860 + Math.floor(Math.random()*40)}`, brief_facts: 'Dacoity on highway — NH-48, two armed assailants, FIR registered' }),
  },
]

let _seq = 0
function nextId(): string {
  return `demo-${Date.now()}-${++_seq}`
}

export function useLiveFeed(_opts?: { maxEvents?: number; enabled?: boolean }): UseLiveFeedResult {
  const { events, pushEvent } = useDemoStore()
  const indexRef     = useRef(0)
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null)

  // Simulate 3–6 connected users that drift slowly
  const userCountRef = useRef(3 + Math.floor(Math.random() * 4))
  useEffect(() => {
    const drift = setInterval(() => {
      const delta = Math.random() < 0.4 ? (Math.random() < 0.5 ? 1 : -1) : 0
      userCountRef.current = Math.max(2, Math.min(12, userCountRef.current + delta))
    }, 15_000)
    return () => clearInterval(drift)
  }, [])

  // Seed initial events on first mount (only if store is empty)
  useEffect(() => {
    if (events.length > 0) return
    const now = Date.now()
    const seed = DEMO_TEMPLATES.slice(0, 6).map((tpl, i) => {
      const payload = tpl.mk()
      return {
        id:          `demo-seed-${i}`,
        type:        tpl.type,
        payload:     { ...payload, zone: tpl.zone, district: tpl.district, station: tpl.stationName },
        ts:          new Date(now - (6 - i) * 18_000).toISOString(),
        stationId:   tpl.stationId,
        stationName: tpl.stationName,
        zone:        tpl.zone,
        district:    tpl.district,
      } satisfies DemoEvent
    })
    seed.forEach(e => pushEvent(e))
    indexRef.current = 6
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Rotate a new event every 7–11 seconds
  useEffect(() => {
    function emit() {
      const tpl = DEMO_TEMPLATES[indexRef.current % DEMO_TEMPLATES.length]
      indexRef.current++
      const payload = tpl.mk()
      const evt: DemoEvent = {
        id:          nextId(),
        type:        tpl.type,
        payload:     { ...payload, zone: tpl.zone, district: tpl.district, station: tpl.stationName },
        ts:          new Date().toISOString(),
        stationId:   tpl.stationId,
        stationName: tpl.stationName,
        zone:        tpl.zone,
        district:    tpl.district,
      }
      pushEvent(evt)
    }

    function scheduleNext() {
      const delay = 7_000 + Math.random() * 4_000
      timerRef.current = setTimeout(() => {
        emit()
        scheduleNext()
      }, delay)
    }

    scheduleNext()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendEvent = useCallback((type: string, payload: Record<string, unknown>) => {
    const evt: DemoEvent = {
      id:      nextId(),
      type,
      payload: { ...payload, _manual: true },
      ts:      new Date().toISOString(),
    }
    pushEvent(evt)
  }, [pushEvent])

  return {
    events,
    connected:      false,   // demo — never a real socket
    connectedUsers: userCountRef.current,
    lastEvent:      events[0] ?? null,
    sendEvent,
  }
}
