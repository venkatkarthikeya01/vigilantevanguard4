import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface User {
  user_id:      string
  email:        string
  role:         string
  display_name: string
  // Branch / data isolation fields — set by login API
  branch_id:    string | null   // e.g. "BLR_SOUTH", "MYS_CITY", "HQ"
  branch_name:  string | null   // e.g. "Bengaluru South Division"
  station_code: string | null   // e.g. "BLR_S_01"
  district_id?: number
  is_admin?:    boolean          // true if role=ADMINISTRATOR or branch_id=HQ
}

interface AuthState {
  user:            User | null
  token:           string | null
  isAuthenticated: boolean
  login:  (user: User, token: string) => void
  logout: () => void
  /** True when the logged-in user has unrestricted cross-branch access */
  isAdmin: () => boolean
  /** Current branch label for display in the UI header */
  branchLabel: () => string
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user:            null,
      token:           null,
      isAuthenticated: false,
      login:  (user, token) => set({ user, token, isAuthenticated: true }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
      isAdmin: () => {
        const u = get().user
        if (!u) return false
        return u.role === 'ADMINISTRATOR' || u.branch_id === 'HQ' || u.branch_id === null
      },
      branchLabel: () => {
        const u = get().user
        if (!u) return ''
        if (u.branch_name) return u.branch_name
        if (u.branch_id === 'HQ' || !u.branch_id) return 'State HQ'
        return u.branch_id
      },
    }),
    { name: 'vv-auth' }
  )
)
