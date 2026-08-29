/**
 * cctv.ts — Zustand store for AI Smart CCTV Surveillance module
 *
 * Manages:
 *  • Incident list (real-time, populated via WebSocket)
 *  • Camera registry
 *  • WebSocket connection lifecycle
 *  • Alert notification count
 */
import { create } from 'zustand'

// ─── Types ─────────────────────────────────────────────────────

export interface CCTVCamera {
  camera_id:   string
  name:        string
  location:    string
  lat:         number
  lng:         number
  source_type: 'demo' | 'webcam' | 'ipcam' | 'rtsp' | 'upload'
  source_url:  string
  district:    string
  zone:        string
  status:      'active' | 'offline' | 'maintenance'
}

export interface IncidentSeverity {
  level:                'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  score:                number
  colour:               string
  description:          string
  response_eta_minutes: number
}

export interface IncidentLocation {
  lat:        number
  lng:        number
  address:    string
  district:   string
  zone:       string
  maps_url:   string
  maps_embed: string
  what3words: string
}

export interface CCTVIncident {
  incident_id:             string
  incident_type:           string
  confidence:              number
  camera_id:               string
  camera_name:             string
  camera_location:         string
  video_path:              string
  snapshot:                string   // base64 data URL
  ai_summary:              string
  latitude:                number
  longitude:               number
  timestamp:               string
  status:                  'PENDING' | 'CONFIRMED' | 'FALSE_ALARM' | 'DISPATCHED'
  assigned_station:        string
  assigned_station_id:     number | null
  assigned_station_phone?: string
  dispatch_recommended:    boolean
  confirmed_by:            string | null
  confirmed_at:            string | null
  district:                string
  zone:                    string
  notes?:                  string
  severity?:               IncidentSeverity
  location?:               IncidentLocation
}

export interface PoliceStation {
  id:       number
  name:     string
  lat:      number
  lng:      number
  district: string
  phone:    string
}

interface CCTVStore {
  // ── Data ────────────────────────────────────────────────────
  incidents:        CCTVIncident[]
  cameras:          CCTVCamera[]
  stations:         PoliceStation[]
  selectedIncident: CCTVIncident | null

  // ── WebSocket state ────────────────────────────────────────
  wsConnected:      boolean
  connectedUsers:   number
  alertCount:       number

  // ── Notification counts ────────────────────────────────────
  notifUnread:      number
  criticalUnread:   number

  // ── UI filters ─────────────────────────────────────────────
  filterStatus:     string   // '' | 'PENDING' | 'CONFIRMED' | etc.
  filterType:       string

  // ── Actions ────────────────────────────────────────────────
  setIncidents:        (list: CCTVIncident[]) => void
  upsertIncident:      (inc: CCTVIncident) => void
  setCameras:          (list: CCTVCamera[]) => void
  setStations:         (list: PoliceStation[]) => void
  selectIncident:      (inc: CCTVIncident | null) => void
  setWsConnected:      (v: boolean) => void
  setConnectedUsers:   (n: number) => void
  incrementAlertCount: () => void
  clearAlerts:         () => void
  setFilterStatus:     (s: string) => void
  setFilterType:       (t: string) => void
  setNotifCounts:      (unread: number, critical: number) => void
}

export const useCCTVStore = create<CCTVStore>((set) => ({
  incidents:        [],
  cameras:          [],
  stations:         [],
  selectedIncident: null,
  wsConnected:      false,
  connectedUsers:   0,
  alertCount:       0,
  notifUnread:      0,
  criticalUnread:   0,
  filterStatus:     '',
  filterType:       '',

  setIncidents: (list) => set({ incidents: list }),

  upsertIncident: (inc) =>
    set((state) => {
      const idx = state.incidents.findIndex(i => i.incident_id === inc.incident_id)
      if (idx >= 0) {
        const updated = [...state.incidents]
        updated[idx]  = inc
        return { incidents: updated }
      }
      return { incidents: [inc, ...state.incidents].slice(0, 200) }
    }),

  setCameras:          (list) => set({ cameras: list }),
  setStations:         (list) => set({ stations: list }),
  selectIncident:      (inc)  => set({ selectedIncident: inc }),
  setWsConnected:      (v)    => set({ wsConnected: v }),
  setConnectedUsers:   (n)    => set({ connectedUsers: n }),
  incrementAlertCount: ()     => set((s) => ({ alertCount: s.alertCount + 1 })),
  clearAlerts:         ()     => set({ alertCount: 0 }),
  setFilterStatus:     (s)    => set({ filterStatus: s }),
  setFilterType:       (t)    => set({ filterType: t }),
  setNotifCounts:      (unread, critical) => set({ notifUnread: unread, criticalUnread: critical }),
}))
