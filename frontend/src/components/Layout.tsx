import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { useDemoStore } from '@/store/demo'
import { useLiveFeed } from '@/hooks/useLiveFeed'
import { useCCTVStore } from '@/store/cctv'
import {
  LayoutDashboard, FileText, Map, Bot, BarChart3, FileBarChart,
  LogOut, Shield, Bell, UserX, GitCompare, Flame, Phone,
  Building2, GitBranch, Calendar, FolderOpen, BookOpen, Languages,
  Radio, Video, BrainCircuit, BarChart2, Camera, Film, Cpu,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLangStore } from '@/store/lang'
import type { Lang } from '@/i18n'

const LANG_OPTIONS: { code: Lang; label: string; short: string }[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'kn', label: 'ಕನ್ನಡ',  short: 'KN' },
  { code: 'hi', label: 'हिंदी',   short: 'HI' },
]

// Two groups for visual separation
const NAV_PRIMARY = [
  { to: '/',               label: 'Dashboard',            icon: LayoutDashboard },
  { to: '/fir',            label: 'FIR Management',       icon: FileText },
  { to: '/casefile',       label: 'Case Files',           icon: FolderOpen },
  { to: '/map',            label: 'Crime Map',            icon: Map },
  { to: '/hotspot',        label: 'Hotspot Predictor',    icon: Flame },
  { to: '/sos',            label: 'Emergency SOS',        icon: Phone },
  { to: '/cctv',           label: 'AI CCTV Surveillance', icon: Video },
  { to: '/cameras',        label: 'Camera Management',    icon: Camera },
  { to: '/footage',        label: 'Evidence Footage',     icon: Film },
  { to: '/rpi5',           label: 'RPi5 Live View',       icon: Cpu },
  { to: '/notifications',  label: 'Police Alerts',        icon: Bell },
  { to: '/training',       label: 'AI Training Studio',   icon: BrainCircuit },
  { to: '/heatmap',        label: 'Incident Heatmap',     icon: BarChart2 },
]

const NAV_SECONDARY = [
  { to: '/stations',   label: 'Police Stations',  icon: Building2 },
  { to: '/scheduler',  label: 'Patrol Scheduler', icon: Calendar },
  { to: '/ai',         label: 'AI Assistant',     icon: Bot },
  { to: '/analytics',  label: 'Analytics',        icon: BarChart3 },
  { to: '/wanted',     label: 'Wanted Persons',   icon: UserX },
  { to: '/comparison', label: 'Dist. Compare',    icon: GitCompare },
  { to: '/correlation',label: 'Correlation',      icon: GitBranch },
  { to: '/report',     label: 'Monthly Report',   icon: BookOpen },
  { to: '/reports',    label: 'Reports',          icon: FileBarChart },
]

export default function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const { lang, setLang } = useLangStore()
  const { unreadCount, markAllRead, selectedStation } = useDemoStore()
  const { lastEvent, events } = useLiveFeed()
  const { alertCount, clearAlerts, notifUnread, criticalUnread } = useCCTVStore()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // Track last seen count so bell pulses on new events
  const lastEventId = lastEvent?.id

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col overflow-hidden">
        {/* Logo */}
        <div className="p-5 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg flex-shrink-0">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-white leading-tight">VigilanteVanguard</h1>
              <p className="text-xs text-gray-400">Karnataka State Police</p>
            </div>
          </div>
        </div>

        {/* Navigation — scrollable */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {/* Primary group */}
          <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider px-2 pt-1 pb-1">Core</p>
          {NAV_PRIMARY.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white font-medium'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                )
              }
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="truncate flex-1">{label}</span>
              {/* Notification badge on Police Alerts */}
              {to === '/notifications' && notifUnread > 0 && (
                <span className={cn(
                  'text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0',
                  criticalUnread > 0
                    ? 'bg-red-500 text-white animate-pulse'
                    : 'bg-orange-500 text-white'
                )}>
                  {notifUnread > 9 ? '9+' : notifUnread}
                </span>
              )}
            </NavLink>
          ))}

          {/* Secondary group */}
          <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider px-2 pt-3 pb-1">Intelligence</p>
          {NAV_SECONDARY.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white font-medium'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                )
              }
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Language + User */}
        <div className="p-3 border-t border-gray-800 flex-shrink-0 space-y-3">
          {/* Language switcher */}
          <div className="flex items-center gap-1.5">
            <Languages className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
            <div className="flex gap-1">
              {LANG_OPTIONS.map(opt => (
                <button
                  key={opt.code}
                  onClick={() => setLang(opt.code)}
                  title={opt.label}
                  className={cn(
                    'text-[10px] font-bold px-2 py-0.5 rounded transition-colors',
                    lang === opt.code
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-500 hover:text-white hover:bg-gray-800'
                  )}
                >
                  {opt.short}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-gray-600 ml-1">{LANG_OPTIONS.find(o => o.code === lang)?.label}</span>
          </div>

          {/* User */}
          <div className="flex items-center gap-2">
            <div className="bg-blue-700 rounded-full h-7 w-7 flex-shrink-0 flex items-center justify-center text-xs font-bold">
              {user?.display_name?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white truncate">{user?.display_name ?? 'Officer'}</p>
              <p className="text-[10px] text-gray-400 truncate">{user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-gray-500 hover:text-white transition-colors flex-shrink-0"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6 py-2.5 flex-shrink-0 gap-3">
        {/* Left: title + selected station breadcrumb */}
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm font-medium text-gray-300 whitespace-nowrap">
            Karnataka State Police — Crime Intelligence Platform
          </h2>
          {selectedStation && (
            <span className="hidden md:flex items-center gap-1.5 text-xs text-blue-400 bg-blue-950/30 border border-blue-700/30 rounded-full px-2.5 py-0.5 truncate">
              <Building2 className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{selectedStation.name}</span>
            </span>
          )}
        </div>

        {/* Right: demo badge + last event + bell */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Demo sync status */}
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-amber-400 bg-amber-950/20 border border-amber-700/30 rounded-full px-2.5 py-1">
            <Radio className="h-3 w-3" />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="font-medium">DEMO</span>
            <span className="text-amber-600">·</span>
            <span className="text-amber-600">{events.length} events</span>
          </span>

          {/* Last event ticker */}
          {lastEvent && (
            <span className="hidden lg:block text-[11px] text-gray-500 max-w-[260px] truncate" key={lastEventId}>
              <span className="text-gray-600">Latest:</span>{' '}
              <span className="text-gray-400">
                {(lastEvent.payload as any).message
                  ?? (lastEvent.payload as any).brief_facts
                  ?? lastEvent.type}
              </span>
            </span>
          )}

          <span className="text-xs text-gray-500 hidden sm:block">
            Powered by <span className="text-blue-400">Zoho Catalyst</span>
          </span>

          <button
            className="relative text-gray-400 hover:text-white transition-colors"
            onClick={() => { markAllRead(); clearAlerts(); navigate('/notifications') }}
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
            {(unreadCount + alertCount + notifUnread) > 0 && (
              <span className={cn(
                'absolute -top-1 -right-1 rounded-full h-3.5 w-3.5 text-[9px] flex items-center justify-center font-bold',
                criticalUnread > 0 ? 'bg-red-500 animate-pulse' : 'bg-red-500'
              )}>
                {(unreadCount + alertCount + notifUnread) > 9 ? '9+' : (unreadCount + alertCount + notifUnread)}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-auto bg-gray-950">
        <Outlet />
      </main>
    </div>
  </div>
  )
}
