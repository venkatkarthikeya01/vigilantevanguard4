/**
 * demo.ts — Global shared demo state
 *
 * This store acts as the in-browser "real-time" backbone for the entire
 * VigilanteVanguard demo. All pages subscribe to the same event stream
 * and share selected station / zone context — creating the illusion of
 * a fully-connected, multi-device police intelligence platform.
 *
 * Nothing here touches the network. It is 100% client-side demo state.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ─── Station snapshot (mirrors StationsPage Station type) ────────
export interface DemoStation {
  id:       number
  name:     string
  district: string
  zone:     string
  type:     string
}

// ─── Live event (same shape as LiveEvent in useLiveFeed) ─────────
export interface DemoEvent {
  id:      string
  type:    'FIR_REGISTERED' | 'BROADCAST' | 'ALERT' | 'DEPLOY' | 'MISSING' | 'WANTED' | string
  payload: Record<string, unknown>
  ts:      string
  stationId?: number
  stationName?: string
  zone?:   string
  district?: string
}

interface DemoStore {
  // ── Selected station (from Stations page → propagates to FIR, Map, etc.) ──
  selectedStation: DemoStation | null
  setSelectedStation: (s: DemoStation | null) => void

  // ── Active zone filter (shared across pages) ──────────────────
  activeZone: string
  setActiveZone: (z: string) => void

  // ── Active district filter (shared across pages) ──────────────
  activeDistrict: string
  setActiveDistrict: (d: string) => void

  // ── Demo event stream ─────────────────────────────────────────
  events:   DemoEvent[]
  pushEvent: (e: DemoEvent) => void
  clearEvents: () => void

  // ── Notification badge count for Layout header ────────────────
  unreadCount: number
  markAllRead: () => void
  incrementUnread: () => void
}

export const useDemoStore = create<DemoStore>()(
  persist(
    (set) => ({
      selectedStation: null,
      setSelectedStation: (s) => set({ selectedStation: s }),

      activeZone: 'All',
      setActiveZone: (z) => set({ activeZone: z }),

      activeDistrict: 'All',
      setActiveDistrict: (d) => set({ activeDistrict: d }),

      events: [],
      pushEvent: (e) =>
        set((state) => ({
          events: [e, ...state.events].slice(0, 50),
          unreadCount: state.unreadCount + 1,
        })),
      clearEvents: () => set({ events: [] }),

      unreadCount: 0,
      markAllRead: () => set({ unreadCount: 0 }),
      incrementUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),
    }),
    {
      name: 'vv-demo',
      // Only persist selection state, not the event stream
      partialize: (state) => ({
        selectedStation: state.selectedStation,
        activeZone:      state.activeZone,
        activeDistrict:  state.activeDistrict,
      }),
    }
  )
)
