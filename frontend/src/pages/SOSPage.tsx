import { useState, useEffect } from "react";
import { useLiveFeed } from "@/hooks/useLiveFeed";
import {
  Shield,
  Phone,
  Heart,
  Activity,
  Globe,
  Users,
  Flame,
  AlertTriangle,
  User,
  Radio,
  Send,
  CheckCircle2,
  Clock,
  Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "Normal" | "Urgent" | "Critical";

interface BroadcastLog {
  id: number;
  zone: string;
  message: string;
  priority: Priority;
  timestamp: string;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const HELPLINES = [
  {
    name: "Police Control Room",
    number: "100",
    icon: Shield,
    ring: "border-blue-500",
    glow: "shadow-blue-500/30",
    bg: "bg-blue-500/10",
    iconColor: "text-blue-400",
    badge: "bg-blue-500/20 text-blue-300",
  },
  {
    name: "Women Helpline",
    number: "1091",
    icon: Heart,
    ring: "border-pink-500",
    glow: "shadow-pink-500/30",
    bg: "bg-pink-500/10",
    iconColor: "text-pink-400",
    badge: "bg-pink-500/20 text-pink-300",
  },
  {
    name: "Ambulance",
    number: "108",
    icon: Activity,
    ring: "border-green-500",
    glow: "shadow-green-500/30",
    bg: "bg-green-500/10",
    iconColor: "text-green-400",
    badge: "bg-green-500/20 text-green-300",
  },
  {
    name: "Cyber Crime",
    number: "1930",
    icon: Globe,
    ring: "border-purple-500",
    glow: "shadow-purple-500/30",
    bg: "bg-purple-500/10",
    iconColor: "text-purple-400",
    badge: "bg-purple-500/20 text-purple-300",
  },
  {
    name: "Child Helpline",
    number: "1098",
    icon: Users,
    ring: "border-orange-500",
    glow: "shadow-orange-500/30",
    bg: "bg-orange-500/10",
    iconColor: "text-orange-400",
    badge: "bg-orange-500/20 text-orange-300",
  },
  {
    name: "Fire & Rescue",
    number: "101",
    icon: Flame,
    ring: "border-red-500",
    glow: "shadow-red-500/30",
    bg: "bg-red-500/10",
    iconColor: "text-red-400",
    badge: "bg-red-500/20 text-red-300",
  },
  {
    name: "Disaster Relief",
    number: "1070",
    icon: AlertTriangle,
    ring: "border-yellow-500",
    glow: "shadow-yellow-500/30",
    bg: "bg-yellow-500/10",
    iconColor: "text-yellow-400",
    badge: "bg-yellow-500/20 text-yellow-300",
  },
  {
    name: "Senior Citizen",
    number: "14567",
    icon: User,
    ring: "border-sky-500",
    glow: "shadow-sky-500/30",
    bg: "bg-sky-500/10",
    iconColor: "text-sky-400",
    badge: "bg-sky-500/20 text-sky-300",
  },
];

const ALERTS = [
  "FIR #KA2026-4821 registered — Cyber Fraud, Bengaluru City",
  "Hotspot Alert: Raichur NDPS trend +18% above monthly average",
  "Missing Person report filed — Tumakuru District",
  "Chain snatching incident reported — MG Road, Bengaluru",
  "Wanted person sighted — Ballari, Alert Level: HIGH",
  "POCSO case registered — Shivamogga, immediate action required",
  "Vehicle theft cluster detected — Bengaluru South (3 cases in 2hrs)",
  "Riot prevention deployment — Belagavi, 40 officers mobilised",
];

const ZONES = [
  "All Districts",
  "North Zone",
  "South Zone",
  "Bengaluru Zone",
  "Mysuru Zone",
];

const PRIORITY_STYLES: Record<Priority, string> = {
  Normal: "bg-gray-700 text-gray-200 border border-gray-600",
  Urgent: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/50",
  Critical: "bg-red-500/20 text-red-300 border border-red-500/50",
};

const STATUS_CARDS = [
  {
    label: "Officers on Duty",
    value: "12,847",
    icon: Shield,
    accent: "text-blue-400",
    bg: "bg-blue-500/10",
  },
  {
    label: "Active Patrols",
    value: "2,341",
    icon: Zap,
    accent: "text-green-400",
    bg: "bg-green-500/10",
  },
  {
    label: "Open Emergencies",
    value: "7",
    icon: AlertTriangle,
    accent: "text-red-400",
    bg: "bg-red-500/10",
  },
  {
    label: "Response Avg",
    value: "8.3 min",
    icon: Clock,
    accent: "text-yellow-400",
    bg: "bg-yellow-500/10",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function SOSPage() {
  // Demo feed — shared with all pages via the demo store
  const { events: liveEvents, sendEvent } = useLiveFeed({ maxEvents: 10 })

  // Alerts ticker: pull BROADCAST/ALERT events from demo store + static fallbacks
  const [alertIndex, setAlertIndex] = useState(0);
  const liveAlerts = liveEvents
    .filter(e => e.type === 'BROADCAST' || e.type === 'ALERT')
    .map(e => {
      const p = e.payload as any
      const station = (e as any).stationName ? ` · ${(e as any).stationName}` : ''
      return `${p.message ?? ''}${station}`
    })

  const displayAlerts = [...liveAlerts, ...ALERTS].slice(0, 12)

  // Broadcast form
  const [zone, setZone] = useState(ZONES[0]);
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<Priority>("Normal");
  const [broadcastLog, setBroadcastLog] = useState<BroadcastLog[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Cycle alerts every 3 s
  useEffect(() => {
    const id = setInterval(() => {
      setAlertIndex((prev) => (prev + 1) % (displayAlerts.length || 1));
    }, 3000);
    return () => clearInterval(id);
  }, [displayAlerts.length]);

  // Auto-clear success toast
  useEffect(() => {
    if (!successMsg) return;
    const id = setTimeout(() => setSuccessMsg(null), 4000);
    return () => clearTimeout(id);
  }, [successMsg]);

  function handleBroadcast() {
    if (!message.trim()) return;
    const now = new Date();
    const timestamp = now.toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const entry: BroadcastLog = {
      id: Date.now(), zone, message: message.trim(), priority, timestamp,
    };
    setBroadcastLog((prev) => [entry, ...prev].slice(0, 3));
    setSuccessMsg(`✓ Broadcast sent to ${zone} — ${timestamp}`);
    // Broadcast to ALL connected users via WebSocket / REST
    sendEvent('BROADCAST', { zone, message: message.trim(), priority });
    setMessage("");
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white px-4 py-8 space-y-10">
      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2 rounded-lg bg-red-500/15 border border-red-500/30">
          <Phone className="w-6 h-6 text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            SOS &amp; Emergency Command Panel
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Karnataka Police · Crime Intelligence Platform
          </p>
        </div>
        {/* Demo mode badge */}
        <div className="ml-auto flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border bg-amber-900/30 border-amber-700/50 text-amber-300">
          <span className="w-2 h-2 rounded-full animate-pulse bg-amber-400" />
          Demo Mode · All zones synced
        </div>
      </div>

      {/* ── Quick Status Cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STATUS_CARDS.map(({ label, value, icon: Icon, accent, bg }) => (
          <div
            key={label}
            className="rounded-xl bg-gray-900 border border-gray-800 p-4 flex items-center gap-4"
          >
            <div className={`p-2.5 rounded-lg ${bg}`}>
              <Icon className={`w-5 h-5 ${accent}`} />
            </div>
            <div>
              <p className="text-xs text-gray-400 leading-none">{label}</p>
              <p className={`text-xl font-bold mt-1 ${accent}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Emergency Helplines ───────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
          <Phone className="w-4 h-4 text-red-400" />
          Emergency Helplines
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {HELPLINES.map(
            ({ name, number, icon: Icon, ring, glow, bg, iconColor, badge }) => (
              <div
                key={number}
                className={`
                  relative rounded-2xl bg-gray-900 border-2 ${ring}
                  shadow-lg ${glow} ${bg}
                  p-5 flex flex-col items-center gap-3
                  hover:scale-[1.03] transition-transform duration-200 cursor-pointer
                `}
              >
                <div
                  className={`w-14 h-14 rounded-full flex items-center justify-center ${bg} ring-2 ${ring}`}
                >
                  <Icon className={`w-7 h-7 ${iconColor}`} />
                </div>
                <span className="text-3xl font-extrabold tracking-tight text-white">
                  {number}
                </span>
                <span
                  className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${badge} text-center leading-snug`}
                >
                  {name}
                </span>
              </div>
            )
          )}
        </div>
      </section>

      {/* ── Active Alerts Ticker ──────────────────────────────────────────── */}
      <section>
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
          {/* Header */}
          <div className="flex items-center gap-2 mb-5">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
            </span>
            <h2 className="text-base font-semibold text-gray-100">
              Active Alerts
            </h2>
            <span className="text-[10px] font-bold text-amber-400 bg-amber-950/40 border border-amber-700/50 px-2 py-0.5 rounded-full ml-1">DEMO</span>
          </div>

          {/* Cycling alert — uses live demo events + static fallbacks */}
          <div className="relative overflow-hidden rounded-lg bg-gray-800/60 border border-gray-700 px-5 py-4 min-h-[56px] flex items-center">
            {displayAlerts.map((alert, i) => (
              <p
                key={i}
                className={`
                  absolute inset-0 flex items-center px-5
                  text-sm font-medium text-gray-100 leading-snug
                  transition-all duration-700
                  ${i === alertIndex ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}
                `}
              >
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mr-3" />
                {alert}
              </p>
            ))}
          </div>

          {/* Dot indicators */}
          <div className="flex gap-1.5 mt-4 justify-center">
            {displayAlerts.map((_, i) => (
              <button
                key={i}
                onClick={() => setAlertIndex(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === alertIndex
                    ? "w-5 bg-amber-400"
                    : "w-1.5 bg-gray-600 hover:bg-gray-500"
                }`}
                aria-label={`Alert ${i + 1}`}
              />
            ))}
          </div>

          {/* All alerts list */}
          <ul className="mt-5 space-y-2">
            {displayAlerts.map((alert, i) => (
              <li
                key={i}
                className={`
                  flex items-start gap-3 text-xs rounded-lg px-3 py-2
                  transition-colors duration-300
                  ${i === alertIndex
                    ? "bg-amber-500/10 border border-amber-500/25 text-amber-200"
                    : "text-gray-400 hover:bg-gray-800/50"}
                `}
              >
                <span className="mt-0.5 shrink-0 text-gray-500 font-mono">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {alert}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Officer Broadcast Form ────────────────────────────────────────── */}
      <section>
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
          <div className="flex items-center gap-2 mb-5">
            <Radio className="w-4 h-4 text-purple-400" />
            <h2 className="text-base font-semibold text-gray-100">
              Officer Broadcast
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Broadcast To */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">
                Broadcast To
              </label>
              <select
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">
                Priority
              </label>
              <div className="flex gap-2">
                {(["Normal", "Urgent", "Critical"] as Priority[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={`
                      flex-1 px-3 py-2 rounded-lg text-xs font-semibold
                      transition-all duration-150
                      ${PRIORITY_STYLES[p]}
                      ${priority === p ? "ring-2 ring-offset-1 ring-offset-gray-900 ring-white/20 scale-105" : "opacity-60 hover:opacity-90"}
                    `}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Message */}
          <div className="mt-4">
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Type your broadcast message here…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </div>

          {/* Broadcast button + success toast */}
          <div className="mt-3 flex items-center gap-4">
            <button
              onClick={handleBroadcast}
              disabled={!message.trim()}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors duration-150"
            >
              <Send className="w-4 h-4" />
              Broadcast
            </button>

            {successMsg && (
              <p className="flex items-center gap-1.5 text-sm text-green-400 animate-pulse">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {successMsg}
              </p>
            )}
          </div>

          {/* Broadcast log */}
          {broadcastLog.length > 0 && (
            <div className="mt-5 border-t border-gray-800 pt-4 space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
                Recent Broadcasts
              </p>
              {broadcastLog.map((log) => (
                <div
                  key={log.id}
                  className="rounded-lg bg-gray-800/60 border border-gray-700 px-4 py-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${PRIORITY_STYLES[log.priority]}`}
                    >
                      {log.priority}
                    </span>
                    <span className="text-xs text-gray-400">→ {log.zone}</span>
                    <span className="ml-auto text-xs text-gray-500 font-mono">
                      {log.timestamp}
                    </span>
                  </div>
                  <p className="text-sm text-gray-200">{log.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
