/**
 * useCCTVSocket.ts — WebSocket hook for CCTV live feed
 *
 * Connects to /api/v1/cctv/ws and pipes events into the CCTV store.
 * Automatically reconnects on disconnect with exponential back-off.
 *
 * v6.0 additions:
 *  • Distinct synthesised alert sounds for every incident type and severity level
 *  • Persistent AudioContext (single instance, never recreated)
 *  • Sound mute toggle exported from hook
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { useAuthStore } from '@/store/auth'
import {
  useCCTVStore,
  type CCTVIncident,
  type CCTVCamera,
} from '@/store/cctv'
import { useQueryClient } from '@tanstack/react-query'

// ═══════════════════════════════════════════════════════════════
//  ALERT SOUND ENGINE
//  All sounds are synthesised via Web Audio API — no audio files
//  needed.  Each incident type and severity has a distinct timbre
//  so an officer can identify the type without looking at the screen.
// ═══════════════════════════════════════════════════════════════

let _audioCtx: AudioContext | null = null

function _getAudioCtx(): AudioContext | null {
  try {
    if (!_audioCtx || _audioCtx.state === 'closed') {
      _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    // Resume if suspended by browser autoplay policy
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume()
    }
    return _audioCtx
  } catch {
    return null
  }
}

function _tone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.35,
  rampUp = 0.01,
  rampDown = 0.04,
) {
  const osc  = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)
  gain.gain.setValueAtTime(0, startTime)
  gain.gain.linearRampToValueAtTime(volume, startTime + rampUp)
  gain.gain.linearRampToValueAtTime(volume * 0.8, startTime + duration - rampDown)
  gain.gain.linearRampToValueAtTime(0, startTime + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.01)
}

function _sweepTone(
  ctx: AudioContext,
  freqStart: number,
  freqEnd: number,
  startTime: number,
  duration: number,
  type: OscillatorType = 'sawtooth',
  volume = 0.3,
) {
  const osc  = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freqStart, startTime)
  osc.frequency.exponentialRampToValueAtTime(freqEnd, startTime + duration)
  gain.gain.setValueAtTime(0, startTime)
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.01)
  gain.gain.linearRampToValueAtTime(0, startTime + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.01)
}

// ── 8 distinct alert sounds ───────────────────────────────────────────────────

/**
 * CRITICAL — 3-pulse emergency siren (high-low-high, sawtooth + sine blend)
 * Hear it and your heart rate goes up.
 */
function _soundCritical(ctx: AudioContext) {
  const t = ctx.currentTime
  const pulses = [1400, 800, 1400, 800]
  pulses.forEach((freq, i) => {
    _sweepTone(ctx, freq, freq * 0.85, t + i * 0.20, 0.17, 'sawtooth', 0.45)
    _tone(ctx, freq * 0.5, t + i * 0.20, 0.17, 'square', 0.15)
  })
}

/**
 * WEAPON DETECTED — sharp metallic ping + descending alarm
 * Quick and piercing — demands immediate attention.
 */
function _soundWeapon(ctx: AudioContext) {
  const t = ctx.currentTime
  _tone(ctx, 2200, t,       0.06, 'triangle', 0.50, 0.005, 0.055)
  _tone(ctx, 1800, t + 0.08, 0.06, 'triangle', 0.40, 0.005, 0.055)
  _sweepTone(ctx, 1200, 600, t + 0.18, 0.35, 'sawtooth', 0.35)
}

/**
 * FIRE / SMOKE — rapid crackling oscillation (fire-like flutter)
 */
function _soundFire(ctx: AudioContext) {
  const t = ctx.currentTime
  for (let i = 0; i < 6; i++) {
    _sweepTone(ctx, 900 + i * 60, 600 - i * 20, t + i * 0.09, 0.07, 'sawtooth', 0.30)
  }
  _tone(ctx, 440, t + 0.55, 0.30, 'sine', 0.20)
}

/**
 * ROAD ACCIDENT / VEHICLE COLLISION — two-tone impact + sustained alert
 * "Thud" feeling with a follow-up klaxon.
 */
function _soundAccident(ctx: AudioContext) {
  const t = ctx.currentTime
  // Impact thud (low rumble)
  _sweepTone(ctx, 120, 50, t, 0.15, 'sawtooth', 0.50)
  // Klaxon follow-up
  _tone(ctx, 880, t + 0.20, 0.20, 'square', 0.35)
  _tone(ctx, 660, t + 0.44, 0.20, 'square', 0.30)
  _tone(ctx, 880, t + 0.68, 0.20, 'square', 0.30)
}

/**
 * PHYSICAL FIGHT — aggressive pulsing buzz
 */
function _soundFight(ctx: AudioContext) {
  const t = ctx.currentTime
  for (let i = 0; i < 5; i++) {
    _tone(ctx, 600 + i * 40, t + i * 0.12, 0.09, 'square', 0.30)
  }
}

/**
 * THEFT / ROBBERY — rising alarm (2 sweeps up)
 */
function _soundTheft(ctx: AudioContext) {
  const t = ctx.currentTime
  _sweepTone(ctx, 600, 1200, t, 0.30, 'triangle', 0.35)
  _sweepTone(ctx, 600, 1400, t + 0.35, 0.35, 'triangle', 0.40)
}

/**
 * PERSON UNCONSCIOUS — low two-tone distress signal (ambulance-like)
 */
function _soundUnconscious(ctx: AudioContext) {
  const t = ctx.currentTime
  _sweepTone(ctx, 700, 900, t,       0.30, 'sine', 0.30)
  _sweepTone(ctx, 900, 700, t + 0.32, 0.30, 'sine', 0.30)
  _sweepTone(ctx, 700, 900, t + 0.64, 0.30, 'sine', 0.25)
}

/**
 * SUSPICIOUS ACTIVITY — gentle double-beep (low urgency)
 */
function _soundSuspicious(ctx: AudioContext) {
  const t = ctx.currentTime
  _tone(ctx, 880, t,       0.12, 'sine', 0.22)
  _tone(ctx, 880, t + 0.18, 0.12, 'sine', 0.22)
}

/**
 * CONFIRMED / ACTION TAKEN — positive double chime (soft, reassuring)
 */
function _soundConfirm(ctx: AudioContext) {
  const t = ctx.currentTime
  _tone(ctx, 660, t,       0.14, 'sine', 0.20)
  _tone(ctx, 880, t + 0.17, 0.18, 'sine', 0.18)
}

// ── Public dispatcher ─────────────────────────────────────────────────────────

export function playAlertSound(
  incidentType: string,
  severityLevel: string,
  muted = false,
) {
  if (muted) return
  const ctx = _getAudioCtx()
  if (!ctx) return

  // CRITICAL severity always overrides incident type with the loudest sound
  if (severityLevel === 'CRITICAL') { _soundCritical(ctx); return }

  const t = incidentType.toLowerCase()
  if (t.includes('weapon'))       { _soundWeapon(ctx);     return }
  if (t.includes('fire') || t.includes('smoke')) { _soundFire(ctx); return }
  if (t.includes('accident') || t.includes('collision')) { _soundAccident(ctx); return }
  if (t.includes('fight'))        { _soundFight(ctx);      return }
  if (t.includes('theft') || t.includes('robbery')) { _soundTheft(ctx); return }
  if (t.includes('unconscious'))  { _soundUnconscious(ctx); return }
  if (t.includes('suspicious'))   { _soundSuspicious(ctx); return }

  // HIGH severity fallback — generic double-beep
  if (severityLevel === 'HIGH') {
    const now = ctx.currentTime
    _tone(ctx, 1000, now,       0.15, 'sine', 0.30)
    _tone(ctx, 1000, now + 0.20, 0.15, 'sine', 0.25)
    return
  }

  // MEDIUM / LOW — soft single beep
  _tone(ctx, 660, ctx.currentTime, 0.12, 'sine', 0.18)
}

export function playConfirmSound() {
  const ctx = _getAudioCtx()
  if (ctx) _soundConfirm(ctx)
}

// ═══════════════════════════════════════════════════════════════
//  WEBSOCKET HOOK
// ═══════════════════════════════════════════════════════════════

const WS_BASE =
  import.meta.env.VITE_WS_URL ||
  (window.location.protocol === 'https:' ? 'wss://' : 'ws://') +
  window.location.host

const WS_URL  = `${WS_BASE}/api/v1/cctv/ws`
const PING_MS = 30_000

export function useCCTVSocket() {
  const wsRef      = useRef<WebSocket | null>(null)
  const retryRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelay = useRef(2_000)
  const pingRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const [muted, setMuted] = useState(false)
  const mutedRef   = useRef(false)

  const toggleMute = useCallback(() => {
    setMuted(m => {
      mutedRef.current = !m
      return !m
    })
  }, [])

  const qc = useQueryClient()
  const token = useAuthStore.getState().token ?? ''
  const {
    setIncidents,
    upsertIncident,
    setCameras,
    setWsConnected,
    setConnectedUsers,
    incrementAlertCount,
    setNotifCounts,
  } = useCCTVStore.getState()

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    const url = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL
    const ws  = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      retryDelay.current = 2_000
      setWsConnected(true)
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        }
      }, PING_MS)
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        switch (msg.event) {
          case 'CONNECTED':
            if (msg.incidents) setIncidents(msg.incidents as CCTVIncident[])
            if (msg.cameras)   setCameras(msg.cameras as CCTVCamera[])
            if (msg.connected_users != null) setConnectedUsers(msg.connected_users)
            if (msg.unread_count != null) setNotifCounts(msg.unread_count, 0)
            qc.invalidateQueries({ queryKey: ['notifications'] })
            qc.invalidateQueries({ queryKey: ['notif-summary'] })
            break
          case 'NEW_INCIDENT': {
            const inc = msg.incident as CCTVIncident
            if (inc) {
              upsertIncident(inc)
              incrementAlertCount()
              playAlertSound(
                inc.incident_type ?? '',
                inc.severity?.level ?? 'HIGH',
                mutedRef.current,
              )
            }
            qc.invalidateQueries({ queryKey: ['notifications'] })
            qc.invalidateQueries({ queryKey: ['notif-summary'] })
            break
          }
          case 'INCIDENT_UPDATED':
            if (msg.incident) upsertIncident(msg.incident as CCTVIncident)
            break
          case 'pong':
            if (msg.connected_users != null) setConnectedUsers(msg.connected_users)
            break
        }
      } catch {
        // ignore malformed message
      }
    }

    ws.onerror = () => { /* onclose handles reconnect */ }

    ws.onclose = () => {
      setWsConnected(false)
      if (pingRef.current) clearInterval(pingRef.current)
      if (!mountedRef.current) return
      retryDelay.current = Math.min(retryDelay.current * 1.5, 30_000)
      retryRef.current = setTimeout(connect, retryDelay.current)
    }
  }, [token, setIncidents, setCameras, setWsConnected,
      setConnectedUsers, upsertIncident, incrementAlertCount])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (retryRef.current) clearTimeout(retryRef.current)
      if (pingRef.current)  clearInterval(pingRef.current)
      wsRef.current?.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { wsRef, muted, toggleMute }
}
