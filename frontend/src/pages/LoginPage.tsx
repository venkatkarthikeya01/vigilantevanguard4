import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { Shield, Eye, EyeOff } from 'lucide-react'

// ─── Demo accounts — works fully offline / on Slate with no backend ───────────
const DEMO_USERS: Record<string, { password: string; role: string; display_name: string; district_id: number }> = {
  // ── Simple username logins ──
  'admin':                         { password: '12345',          role: 'ADMINISTRATOR', display_name: 'Admin',            district_id: 5 },
  // ── Email logins ──
  'admin@ksp.gov.in':              { password: 'admin123',       role: 'ADMINISTRATOR', display_name: 'Admin Officer',    district_id: 5 },
  'venkat.25cse@cambridge.edu.in': { password: 'Karthi@007',     role: 'ADMINISTRATOR', display_name: 'Venkat (Admin)',   district_id: 5 },
  'raj.kumar@ksp.gov.in':          { password: 'Inspector@123',  role: 'INVESTIGATOR',  display_name: 'Insp. Raj Kumar',  district_id: 5 },
  'priya.sharma@ksp.gov.in':       { password: 'Analyst@123',    role: 'ANALYST',       display_name: 'Priya Sharma',     district_id: 1 },
  'suresh.babu@ksp.gov.in':        { password: 'Supervisor@123', role: 'SUPERVISOR',    display_name: 'DSP Suresh Babu',  district_id: 5 },
}

async function makeLocalToken(email: string, role: string, displayName: string, districtId: number): Promise<string> {
  const payloadObj = {
    user_id: String(Object.keys(DEMO_USERS).indexOf(email) + 1),
    email,
    role,
    display_name: displayName,
    district_id: districtId,
    type: 'vv_demo',
    iat: Date.now(),
  }
  const payloadB64 = btoa(JSON.stringify(payloadObj))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const secret = 'vv_ksp_demo_2026'
  // HMAC-SHA256 via SubtleCrypto (available in all modern browsers)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64))
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  return `${payloadB64}.${sigHex}`
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuthStore()
  const navigate = useNavigate()

  const handleLogin = async () => {
    setError('')
    setLoading(true)
    const key = email.toLowerCase().trim()
    const user = DEMO_USERS[key]

    // ── Local demo auth (always works, no backend needed) ──
    if (user && user.password === password) {
      const token = await makeLocalToken(key, user.role, user.display_name, user.district_id)
      login({
        user_id: String(Object.keys(DEMO_USERS).indexOf(key) + 1),
        email: key,
        role: user.role,
        display_name: user.display_name,
        district_id: user.district_id,
        branch_id: 'HQ',
        branch_name: 'State HQ',
        station_code: null,
      }, token)
      navigate('/')
      return
    }

    // ── Fallback: try backend (for when AppSail is healthy) ──
    try {
      const { apiClient } = await import('@/lib/api')
      const r = await apiClient.post('/auth/login', { email: key, password })
      login(r.data.user, r.data.token)
      navigate('/')
    } catch {
      setError('Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex bg-blue-600 p-4 rounded-2xl mb-4">
            <Shield className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">VigilanteVanguard</h1>
          <p className="text-gray-400 text-sm mt-1">Karnataka State Police</p>
          <p className="text-gray-500 text-xs mt-1">Crime Intelligence Platform</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-400 mb-1.5 block">
                Username / Email / KGID
              </label>
              <input
                type="text"
                value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                placeholder="admin  or  officer@ksp.gov.in"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-400 mb-1.5 block">
              Password
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="••••••••"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pr-11 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-xs bg-red-950/50 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleLogin}
            disabled={!email || !password || loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {loading
              ? <><span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> Signing in...</>
              : 'Sign In'}
          </button>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          Powered by <span className="text-blue-500">Zoho Catalyst</span> · Karnataka State Police Datathon 2026
        </p>
      </div>
    </div>
  )
}
