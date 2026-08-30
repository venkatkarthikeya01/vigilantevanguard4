/**
 * AITrainingPage.tsx — AI Model Training Studio  (v4)
 * VigilanteVanguard — Karnataka State Police
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BrainCircuit, Upload, Play, Square, CheckCircle, XCircle,
  Trash2, RefreshCw, Info, Video, Image, TrendingDown,
  Award, Database, Cpu, ChevronRight, AlertTriangle, Eye,
  FileVideo, BookOpen, FolderOpen, Layers, HardDrive, X,
  Zap, BarChart2, Shield, FlaskConical, Film,
  Camera, Wifi, WifiOff, Crosshair, PackageOpen, CloudUpload, CloudDownload,
  Bot, Sparkles,
} from 'lucide-react'
import {
  fetchTrainingLabels, fetchTrainingDataset,
  uploadTrainingSample, uploadTrainingSampleBatch, scanDisk, verifySample, deleteSample,
  fetchTrainingSessions, startTraining, cancelTraining,
  fetchCurrentModel, extractVideoFrames, triggerRetrainNow,
  uploadYoloModel, stratusSync,
  fetchAccidentLabels, fetchAccidentStatus, uploadAccidentImages,
  type TrainingSample, type TrainingSession, type DatasetStats,
} from '@/lib/cctvApi'
import { cn } from '@/lib/utils'

// ─── Constants ─────────────────────────────────────────────────
const LABEL_COLOURS: Record<string, string> = {
  'Road Accident':        '#ef4444',
  'Physical Fight':       '#f97316',
  'Weapon Detected':      '#a855f7',
  'Fire / Smoke':         '#f59e0b',
  'Theft / Robbery':      '#06b6d4',
  'Person Unconscious':   '#64748b',
  'Suspicious Activity':  '#14b8a6',
  'Vehicle Collision':    '#ec4899',
  'Normal / No Incident': '#22c55e',
}
const labelColour = (l: string) => LABEL_COLOURS[l] ?? '#6b7280'

function fmtTs(ts: string) {
  try { return new Date(ts).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) }
  catch { return ts }
}

// ═══════════════════════════════════════════════════════════════
//  MODEL STATUS BANNER  — top of left sidebar
// ═══════════════════════════════════════════════════════════════

function ModelStatusBanner() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ['training-status'],
    queryFn: () => fetch('/api/v1/training/status').then(r => r.json()),
    refetchInterval: 8000,
  })

  if (isLoading || !data) return null

  const ready         = data.model_ready
  const size          = data.hist_index_size ?? 0
  const labels        = data.total_labels ?? 0
  const yoloReady     = data.yolo_ready ?? false
  const rfReady       = data.rf_ready   ?? false
  const svmReady      = data.svm_ready  ?? false
  const autoRetrain   = data.auto_retrain_pending ?? false
  const retrainQueued = data.auto_retrain_queued  ?? 0
  const stratusBucket = data.stratus_bucket ?? 'vv-training-data'
  const feedbackImgs  = data.yolo_feedback_imgs ?? 0
  const yoloFinetuneAt = data.yolo_finetune_at ?? 20

  return (
    <div className={cn(
      'rounded-xl px-3 py-2.5 border flex items-start gap-2.5',
      ready
        ? 'bg-green-950/30 border-green-700/50'
        : 'bg-yellow-950/30 border-yellow-700/50'
    )}>
      <Shield className={cn('h-4 w-4 flex-shrink-0 mt-0.5', ready ? 'text-green-400' : 'text-yellow-400')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={cn('text-xs font-semibold', ready ? 'text-green-300' : 'text-yellow-300')}>
            {ready ? 'Model Active' : 'Model Not Ready'}
          </p>
          {yoloReady && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-900/50 border border-yellow-600/50 text-yellow-300 font-semibold">
              ⚡ YOLO PRIMARY
            </span>
          )}
          {autoRetrain && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-900/50 border border-blue-600/50 text-blue-300 animate-pulse">
              ⟳ auto-retrain in 30s ({retrainQueued} feedback)
            </span>
          )}
        </div>
        {ready ? (
          <div className="mt-0.5 space-y-0.5">
            {yoloReady ? (
              <p className="text-[10px] text-yellow-400 font-medium">
                ⚡ YOLO Cloud model active (27-class custom accident-detection model)
              </p>
            ) : (
              <p className="text-[10px] text-gray-500">Upload best.pt / best.onnx to activate YOLO PRIMARY detector</p>
            )}
            <p className="text-[10px] text-green-500">
              {size} vectors · {labels} labels · threshold 0.35
            </p>
            <p className="text-[9px] text-gray-400">
              RF: <span className={rfReady ? 'text-emerald-400' : 'text-gray-500'}>{rfReady ? '✓' : '—'}</span>
              {' · '}
              SVM: <span className={svmReady ? 'text-purple-400' : 'text-gray-500'}>{svmReady ? '✓' : '—'}</span>
              {' · '}
              Stratus: <span className="text-gray-400">{stratusBucket}</span>
            </p>
            {feedbackImgs > 0 && (
              <div className="mt-1">
                <div className="flex items-center justify-between text-[9px] text-gray-500 mb-0.5">
                  <span>YOLO fine-tune progress</span>
                  <span>{feedbackImgs}/{yoloFinetuneAt}</span>
                </div>
                <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-yellow-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (feedbackImgs / yoloFinetuneAt) * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[10px] text-yellow-500 mt-0.5">
            Upload a YOLO model (.pt) or scan disk + start training to activate detection
          </p>
        )}
        {ready && data.hist_by_label && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {Object.entries(data.hist_by_label as Record<string, number>)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .map(([lbl, cnt]) => (
                <span key={lbl}
                  className="text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{ background: labelColour(lbl) + '33', color: labelColour(lbl), border: `1px solid ${labelColour(lbl)}55` }}>
                  {lbl.split(' ')[0]} {cnt}
                </span>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  YOLO MODEL CARD  — upload new model + Stratus sync
// ═══════════════════════════════════════════════════════════════

function YoloModelCard({ onModelChanged }: { onModelChanged: () => void }) {
  const [uploading,  setUploading]  = useState(false)
  const [uploadPct,  setUploadPct]  = useState<number | null>(null)
  const [syncing,    setSyncing]    = useState(false)
  const [msg,        setMsg]        = useState<{ ok: boolean; text: string } | null>(null)
  const modelRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const { data: status } = useQuery<any>({
    queryKey: ['training-status'],
    queryFn:  () => fetch('/api/v1/training/status').then(r => r.json()),
    refetchInterval: 8000,
  })

  const yoloReady   = status?.yolo_ready ?? false
  const yoloPath    = status?.yolo_model_path ?? null
  const feedbackN   = status?.yolo_feedback_imgs ?? 0
  const finetuneAt  = status?.yolo_finetune_at ?? 20

  const handleUpload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pt', 'onnx'].includes(ext ?? '')) {
      setMsg({ ok: false, text: 'Only .pt or .onnx files accepted' }); return
    }
    setUploading(true); setMsg(null)
    try {
      const res = await uploadYoloModel(file, p => setUploadPct(p))
      setMsg({ ok: true, text: res.message })
      setUploadPct(null)
      qc.invalidateQueries({ queryKey: ['training-status'] })
      onModelChanged()
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.detail || e?.message || 'Upload failed' })
      setUploadPct(null)
    }
    setUploading(false)
  }

  const handleSync = async () => {
    setSyncing(true); setMsg(null)
    try {
      const res = await stratusSync()
      setMsg({ ok: true, text: res.message })
      qc.invalidateQueries({ queryKey: ['training-status'] })
      onModelChanged()
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.detail || e?.message || 'Sync failed' })
    }
    setSyncing(false)
  }

  return (
    <div className="rounded-xl border border-yellow-700/40 bg-yellow-950/10 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-yellow-800/30">
        <Bot className="h-3.5 w-3.5 text-yellow-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-white">YOLO Model</span>
        {yoloReady
          ? <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-900/60 border border-yellow-600/50 text-yellow-300 font-bold">⚡ ACTIVE PRIMARY</span>
          : <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-gray-800 border border-gray-600 text-gray-400">not loaded</span>
        }
      </div>
      <div className="p-3 space-y-2">
        {/* Current model */}
        <div className="bg-gray-800/40 rounded-lg p-2 text-[10px] space-y-1">
          {yoloReady ? (
            <>
              <p className="text-yellow-300 font-semibold flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" />
                Accident Signals v2 — YOLOv11n Custom
              </p>
              <p className="text-gray-500 font-mono truncate">{yoloPath?.split('/').pop() ?? 'best.pt'}</p>
              <p className="text-gray-600">10 classes: damaged_vehicle, vehicle_fire, road_debris, car, truck, bus, motorcycle…</p>
            </>
          ) : (
            <>
              <p className="text-gray-400">No custom YOLO model loaded</p>
              <p className="text-gray-600">Upload best.pt from RPi5 training to enable YOLO PRIMARY detection</p>
            </>
          )}
        </div>

        {/* Fine-tune progress bar */}
        {feedbackN > 0 && (
          <div>
            <div className="flex justify-between text-[9px] text-gray-500 mb-0.5">
              <span>Auto fine-tune progress</span>
              <span>{feedbackN}/{finetuneAt} feedback imgs</span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-yellow-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (feedbackN / finetuneAt) * 100)}%` }} />
            </div>
            {feedbackN >= finetuneAt && (
              <p className="text-[9px] text-yellow-400 mt-0.5">
                ✓ Threshold reached — YOLO fine-tune will run on next approve/reject
              </p>
            )}
          </div>
        )}

        {/* Upload model */}
        <input ref={modelRef} type="file" accept=".pt,.onnx" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) { handleUpload(f); e.target.value = '' } }} />
        <button onClick={() => modelRef.current?.click()} disabled={uploading}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all',
            uploading
              ? 'bg-yellow-900/50 text-yellow-300 cursor-wait'
              : 'bg-yellow-600 hover:bg-yellow-500 text-black active:scale-95'
          )}>
          {uploading
            ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Uploading…</>
            : <><Upload className="h-3.5 w-3.5" />Upload New Model (.pt / .onnx)</>}
        </button>
        {uploadPct !== null && (
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-yellow-500 rounded-full transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
        )}

        {/* Stratus sync */}
        <button onClick={handleSync} disabled={syncing}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all',
            syncing
              ? 'bg-blue-900/50 text-blue-300 cursor-wait'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300 active:scale-95 border border-gray-600'
          )}>
          {syncing
            ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Syncing from Stratus…</>
            : <><Database className="h-3.5 w-3.5" />Restore from Catalyst Stratus</>}
        </button>

        {/* Result message */}
        {msg && (
          <p className={cn('text-[10px] flex items-start gap-1.5',
            msg.ok ? 'text-green-400' : 'text-red-400')}>
            {msg.ok ? <CheckCircle className="h-3 w-3 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />}
            {msg.text}
          </p>
        )}

        {/* Info hint */}
        <p className="text-[9px] text-gray-600 bg-gray-800/30 rounded px-2 py-1.5">
          Upload <code className="text-gray-400">best.pt</code> from{' '}
          <code className="text-gray-400">vigilante_vanguard_rpi/training/</code> or any YOLOv8/v11 model.
          Model auto-retrains after {finetuneAt} officer feedback images.
        </p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  SCAN DISK CARD
// ═══════════════════════════════════════════════════════════════

function ScanDiskCard({ onScanned }: { onScanned: (count: number) => void }) {
  const [scanning, setScanning] = useState(false)
  const [result,   setResult]   = useState<{ ok: boolean; msg: string; registered: number; skipped: number } | null>(null)

  const handleScan = async () => {
    setScanning(true)
    setResult(null)
    try {
      const res = await scanDisk()
      setResult({ ok: true, msg: res.message, registered: res.registered, skipped: res.skipped })
      onScanned(res.registered + res.skipped)   // total known files
    } catch (e: any) {
      setResult({ ok: false, msg: e?.response?.data?.detail || e?.message || 'Scan failed', registered: 0, skipped: 0 })
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="rounded-xl border border-green-800/50 bg-green-950/10 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-green-800/30">
        <HardDrive className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-white">Scan Disk</span>
        <span className="ml-auto text-[10px] text-green-500/70">register files from training_data/</span>
      </div>
      <div className="p-3 space-y-2">
        {/* Folder map */}
        <div className="bg-gray-800/40 rounded-lg p-2 text-[10px] space-y-0.5">
          {[
            ['road_accident/',        'Road Accident'],
            ['physical_fight/',       'Physical Fight'],
            ['weapon_detected/',      'Weapon Detected'],
            ['fire___smoke/',         'Fire / Smoke'],
            ['theft___robbery/',      'Theft / Robbery'],
            ['vehicle_collision/',    'Vehicle Collision'],
            ['person_unconscious/',   'Person Unconscious'],
            ['suspicious_activity/',  'Suspicious Activity'],
            ['normal___no_incident/', 'Normal / No Incident'],
          ].map(([folder, label]) => (
            <div key={folder} className="flex items-center gap-1.5">
              <code className="text-blue-300 font-mono">{folder}</code>
              <span className="text-gray-600">→</span>
              <span style={{ color: labelColour(label) }}>{label}</span>
            </div>
          ))}
          <p className="text-gray-600 pt-1 border-t border-gray-700 mt-1">
            backend/training_data/
          </p>
        </div>

        <button
          onClick={handleScan}
          disabled={scanning}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all',
            scanning
              ? 'bg-green-800/50 text-green-300 cursor-wait'
              : 'bg-green-600 hover:bg-green-500 text-white active:scale-95'
          )}
        >
          {scanning
            ? <><RefreshCw className="h-4 w-4 animate-spin" />Scanning…</>
            : <><HardDrive className="h-4 w-4" />Scan &amp; Register Files</>}
        </button>

        {result && (
          <div className={cn(
            'rounded-lg px-3 py-2 text-[11px] border',
            result.ok
              ? result.registered > 0 ? 'bg-green-950/40 border-green-700 text-green-300'
                                      : 'bg-gray-800 border-gray-700 text-gray-400'
              : 'bg-red-950/40 border-red-700 text-red-300'
          )}>
            <p className="flex items-center gap-1.5 font-medium">
              {result.ok
                ? <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" />
                : <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />}
              {result.ok
                ? result.registered > 0
                  ? `${result.registered} new files registered!`
                  : `All ${result.skipped} files already registered`
                : result.msg}
            </p>
            {result.ok && (
              <p className="text-[10px] text-gray-500 mt-0.5 pl-5">
                {result.registered} new · {result.skipped} known
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  UPLOAD PANEL
// ═══════════════════════════════════════════════════════════════

type FileStatus = { file: File; status: 'pending' | 'uploading' | 'ok' | 'error'; msg: string }

function UploadPanel({ labels, onUploaded }: { labels: string[]; onUploaded: () => void }) {
  const [selectedLabel, setSelectedLabel] = useState(labels[0] ?? '')
  const [notes,         setNotes]         = useState('')
  const [uploadPct,     setUploadPct]     = useState<number | null>(null)
  const [fileList,      setFileList]      = useState<FileStatus[]>([])
  const [uploading,     setUploading]     = useState(false)
  const [batchResult,   setBatchResult]   = useState<string | null>(null)

  const fileRef   = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return
    const entries: FileStatus[] = Array.from(incoming)
      .filter(f => /\.(jpe?g|png|mp4|avi|mov|mkv|webm)$/i.test(f.name))
      .map(f => ({ file: f, status: 'pending', msg: '' }))
    setFileList(prev => [...prev, ...entries])
    setBatchResult(null)
  }, [])

  const handleUpload = useCallback(async () => {
    if (!selectedLabel || fileList.length === 0) return
    setUploading(true)
    setBatchResult(null)
    const pending = fileList.filter(f => f.status === 'pending').map(f => f.file)
    if (!pending.length) { setUploading(false); return }
    setFileList(prev => prev.map(f => f.status === 'pending' ? { ...f, status: 'uploading' } : f))
    try {
      const res = await uploadTrainingSampleBatch(pending, selectedLabel, notes, 'CAM-TRAINING', p => setUploadPct(p))
      setUploadPct(null)
      setFileList(prev => prev.map(fs => {
        const r = res.results.find((r: any) => r.filename === fs.file.name)
        return r ? { ...fs, status: r.ok ? 'ok' : 'error', msg: r.ok ? (r.indexed ? 'indexed' : 'saved') : (r.error ?? 'failed') } : fs
      }))
      setBatchResult(`${res.message}${res.failed > 0 ? ` · ${res.failed} failed` : ''}`)
      setNotes('')
      onUploaded()
    } catch (e: any) {
      setUploadPct(null)
      setFileList(prev => prev.map(f => f.status === 'uploading' ? { ...f, status: 'error', msg: 'failed' } : f))
      setBatchResult(`Error: ${e?.response?.data?.detail || e?.message || 'Upload failed'}`)
    }
    setUploading(false)
  }, [selectedLabel, notes, fileList, onUploaded])

  const pendingCount = fileList.filter(f => f.status === 'pending').length

  return (
    <div className="space-y-3">
      {/* Label picker */}
      <div>
        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-1.5">1. Pick Label</p>
        <div className="grid grid-cols-3 gap-1">
          {labels.map(lbl => (
            <button key={lbl} onClick={() => setSelectedLabel(lbl)}
              className={cn(
                'text-[9px] py-1 px-1.5 rounded border text-left transition-colors leading-tight',
                selectedLabel === lbl
                  ? 'border-blue-500 bg-blue-950/40 text-white'
                  : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-500'
              )}>
              <span className="w-1.5 h-1.5 rounded-full inline-block mr-0.5 align-middle"
                style={{ background: labelColour(lbl) }} />
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* File pickers */}
      <div>
        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-1.5">2. Add Files</p>
        <input ref={fileRef} type="file" multiple accept=".mp4,.avi,.mov,.mkv,.webm,.jpg,.jpeg,.png"
          className="hidden" onChange={e => addFiles(e.target.files)} />
        <input ref={folderRef} type="file"
          // @ts-ignore
          webkitdirectory="true" multiple className="hidden"
          onChange={e => addFiles(e.target.files)} />
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => fileRef.current?.click()} disabled={!selectedLabel}
            className="flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg
                       bg-blue-800/40 hover:bg-blue-700 border border-blue-700 text-blue-300 disabled:opacity-40 transition-colors">
            <Upload className="h-3.5 w-3.5" />Pick Files
          </button>
          <button onClick={() => folderRef.current?.click()} disabled={!selectedLabel}
            className="flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg
                       bg-purple-800/40 hover:bg-purple-700 border border-purple-700 text-purple-300 disabled:opacity-40 transition-colors">
            <FolderOpen className="h-3.5 w-3.5" />Pick Folder
          </button>
        </div>
      </div>

      {/* Optional notes */}
      <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5
                   text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500" />

      {/* File queue */}
      {fileList.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-gray-400 font-medium">{fileList.length} files</span>
            <button onClick={() => { setFileList([]); setBatchResult(null) }}
              className="ml-auto text-[10px] text-gray-600 hover:text-red-400 transition-colors">Clear</button>
          </div>
          <div className="max-h-28 overflow-y-auto space-y-0.5">
            {fileList.map((fs, i) => (
              <div key={i} className={cn(
                'flex items-center gap-1.5 rounded px-2 py-1 text-[10px]',
                fs.status === 'ok' ? 'bg-green-950/30 border border-green-800/40' :
                fs.status === 'error' ? 'bg-red-950/30 border border-red-800/40' :
                'bg-gray-800/50 border border-gray-700'
              )}>
                {fs.file.type.startsWith('image') ? <Image className="h-3 w-3 text-gray-500 flex-shrink-0" /> : <FileVideo className="h-3 w-3 text-gray-500 flex-shrink-0" />}
                <span className="flex-1 text-gray-300 truncate">{fs.file.name}</span>
                {fs.status === 'ok' && <CheckCircle className="h-3 w-3 text-green-400 flex-shrink-0" />}
                {fs.status === 'error' && <AlertTriangle className="h-3 w-3 text-red-400 flex-shrink-0" />}
                {fs.status === 'uploading' && <RefreshCw className="h-3 w-3 text-blue-400 animate-spin flex-shrink-0" />}
                {fs.status === 'pending' && <button onClick={() => setFileList(p => p.filter((_, j) => j !== i))}><X className="h-3 w-3 text-gray-600 hover:text-red-400" /></button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadPct !== null && (
        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${uploadPct}%` }} />
        </div>
      )}

      {pendingCount > 0 && (
        <button onClick={handleUpload} disabled={uploading || !selectedLabel}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-bold
                     bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg transition-colors">
          {uploading
            ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Uploading…</>
            : <><Upload className="h-3.5 w-3.5" />Upload {pendingCount} file{pendingCount > 1 ? 's' : ''}</>}
        </button>
      )}

      {batchResult && (
        <p className={cn('text-[11px] flex items-start gap-1.5',
          batchResult.startsWith('Error') ? 'text-red-400' : 'text-green-400')}>
          {batchResult.startsWith('Error') ? <AlertTriangle className="h-3 w-3 mt-0.5" /> : <CheckCircle className="h-3 w-3 mt-0.5" />}
          {batchResult}
        </p>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  TRAINING PANEL
// ═══════════════════════════════════════════════════════════════

function TrainingPanel({ onStarted }: { onStarted: () => void }) {
  const [epochs,       setEpochs]       = useState(30)
  const [modelBase,    setModelBase]    = useState('yolov8n')
  const [desc,         setDesc]         = useState('')
  const [verifiedOnly, setVerifiedOnly] = useState(true)
  const [msg,          setMsg]          = useState<{ ok: boolean; text: string } | null>(null)
  const qc = useQueryClient()

  const startMut = useMutation({
    mutationFn: () => startTraining({ epochs, model_base: modelBase, description: desc, use_verified_only: verifiedOnly }),
    onSuccess: (data: any) => {
      setMsg({ ok: true, text: `Session ${data.session.session_id} started!` })
      qc.invalidateQueries({ queryKey: ['training-sessions'] })
      onStarted()
    },
    onError: (e: any) => {
      setMsg({ ok: false, text: e?.response?.data?.detail || e?.message || 'Failed to start' })
    },
  })

  return (
    <div className="space-y-3">
      {/* Model base */}
      <div>
        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-1.5">Base Model</p>
        <div className="grid grid-cols-3 gap-1.5">
          {['yolov8n', 'yolov8s', 'yolov8m'].map(m => (
            <button key={m} onClick={() => setModelBase(m)}
              className={cn(
                'py-1.5 text-[11px] rounded border transition-colors',
                modelBase === m ? 'bg-purple-900/50 border-purple-600 text-purple-300' : 'border-gray-700 text-gray-400 hover:border-gray-500'
              )}>
              {m}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-gray-600 mt-1">n = nano (fast)  ·  s = small  ·  m = accurate</p>
      </div>

      {/* Epochs slider */}
      <div>
        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-1">Epochs: {epochs}</p>
        <input type="range" min={5} max={100} value={epochs} onChange={e => setEpochs(+e.target.value)}
          className="w-full accent-purple-500" />
        <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
          <span>5 (quick)</span><span>100 (full)</span>
        </div>
      </div>

      {/* Description */}
      <input type="text" value={desc} onChange={e => setDesc(e.target.value)}
        placeholder="Description (optional)"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5
                   text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500" />

      {/* Verified only */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={verifiedOnly} onChange={e => setVerifiedOnly(e.target.checked)} className="accent-purple-500" />
        <span className="text-xs text-gray-300">Use verified samples only</span>
      </label>

      <button onClick={() => startMut.mutate()} disabled={startMut.isPending}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-bold
                   bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg transition-colors">
        {startMut.isPending
          ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Starting…</>
          : <><Play className="h-3.5 w-3.5" />Start Training Session</>}
      </button>

      {msg && (
        <p className={cn('text-[11px] flex items-center gap-1', msg.ok ? 'text-green-400' : 'text-red-400')}>
          {msg.ok ? <CheckCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {msg.text}
        </p>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  TEST DETECTION PANEL
// ═══════════════════════════════════════════════════════════════

function TestDetectionPanel() {
  const [loading,  setLoading]  = useState(false)
  const [preview,  setPreview]  = useState<string | null>(null)
  const [filename, setFilename] = useState('')
  const [result,   setResult]   = useState<any | null>(null)
  const [error,    setError]    = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const runTest = async (file: File) => {
    const ok = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name)
    if (!ok) { setError('Please pick a JPG or PNG image'); return }
    setLoading(true); setResult(null); setError(''); setFilename(file.name)

    const reader = new FileReader()
    reader.onload = e => setPreview(e.target?.result as string)
    reader.readAsDataURL(file)

    try {
      const form = new FormData()
      form.append('file', file)
      const resp = await fetch('/api/v1/training/debug/detect', { method: 'POST', body: form })
      if (!resp.ok) throw new Error(`Server ${resp.status}: ${await resp.text()}`)
      const data = await resp.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (e: any) {
      setError(e.message || 'Detection failed')
    } finally {
      setLoading(false)
    }
  }

  // Paste from clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'))
      if (item) { const f = item.getAsFile(); if (f) runTest(f) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const COLS = LABEL_COLOURS

  return (
    <div className="space-y-3">
      {/* Preview */}
      {preview && (
        <div className="relative rounded-lg overflow-hidden bg-black border border-gray-700">
          <img src={preview} alt="test" className="w-full max-h-40 object-contain" />
          {loading && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="h-7 w-7 text-purple-400 animate-spin" />
              <p className="text-xs text-purple-300">Analysing…</p>
            </div>
          )}
        </div>
      )}

      {/* Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => fileRef.current?.click()} disabled={loading}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg
                     bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-xs font-bold transition-colors">
          <Upload className="h-3.5 w-3.5" />Browse Image
        </button>
        <button
          onClick={() => { setPreview(null); setResult(null); setError(''); setFilename('') }}
          disabled={loading || (!preview && !result)}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg
                     bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 text-xs font-bold transition-colors">
          <X className="h-3.5 w-3.5" />Clear
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) { runTest(f); e.target.value = '' } }} />

      <p className="text-[10px] text-gray-500 text-center">
        or press <kbd className="bg-gray-800 border border-gray-700 rounded px-1 text-gray-300">Ctrl+V</kbd> to paste from clipboard
      </p>

      {/* Error */}
      {error && (
        <div className="bg-red-950/40 border border-red-700/50 rounded-lg px-3 py-2">
          <p className="text-[11px] text-red-300 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            {error}
          </p>
          {error.includes('empty') && (
            <p className="text-[10px] text-red-400/70 mt-1 pl-5">
              Click "Scan &amp; Register" tab first, then "Start Training"
            </p>
          )}
        </div>
      )}

      {/* Results */}
      {result && !loading && !error && (
        <div className="space-y-2">
          {/* Result banner */}
          <div className={cn(
            'rounded-lg px-3 py-2.5 border',
            result.triggered ? 'bg-red-950/40 border-red-700/60' : 'bg-gray-800/60 border-gray-700'
          )}>
            <div className="flex items-center gap-2 mb-1">
              {result.triggered
                ? <><AlertTriangle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" /><span className="text-xs font-bold text-red-300">INCIDENT DETECTED</span></>
                : <><CheckCircle className="h-3.5 w-3.5 text-green-400 flex-shrink-0" /><span className="text-xs font-bold text-gray-300">NO INCIDENT</span></>}
              <span className="ml-auto text-[10px] text-gray-500 font-mono truncate max-w-[90px]">{filename}</span>
            </div>
            <p className="text-sm font-bold" style={{ color: COLS[result.best_match] ?? '#e5e7eb' }}>
              {result.best_match}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Confidence: <span className="text-white font-semibold">{Math.round(result.best_confidence * 100)}%</span>
              &nbsp;·&nbsp;dist: <span className="font-mono">{result.best_distance?.toFixed(3)}</span>
            </p>
          </div>

          {/* Per-label bars */}
          <div className="space-y-1">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">All labels — nearest distance</p>
            {(result.all_labels_ranked ?? []).map(({ label, nearest_dist, would_trigger, samples }: any) => {
              const pct = Math.max(0, Math.min(100, (1 - nearest_dist / 0.5) * 100))
              const col = COLS[label] ?? '#6b7280'
              return (
                <div key={label} className={cn('rounded px-2 py-1 border', would_trigger ? 'border-red-800/50 bg-red-950/20' : 'border-gray-800 bg-gray-800/30')}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col }} />
                    <span className="text-[10px] text-gray-300 flex-1 truncate">{label}</span>
                    {would_trigger && <span className="text-[9px] text-red-400 font-bold">TRIGGERS</span>}
                    <span className="text-[10px] font-mono text-gray-500">{nearest_dist.toFixed(3)}</span>
                    <span className="text-[10px] text-gray-600">({samples})</span>
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col, opacity: would_trigger ? 1 : 0.4 }} />
                  </div>
                </div>
              )
            })}
          </div>

          {!result.triggered && (
            <p className="text-[10px] text-yellow-400/80 bg-yellow-950/20 border border-yellow-800/40 rounded px-2 py-1.5">
              {result.hint}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  SESSION CARD
// ═══════════════════════════════════════════════════════════════

function SessionCard({ session, onCancel }: { session: TrainingSession; onCancel: (id: string) => void }) {
  const STATUS_STYLE: Record<string, string> = {
    QUEUED:    'bg-gray-800 text-gray-400 border-gray-600',
    RUNNING:   'bg-blue-900/50 text-blue-300 border-blue-700',
    COMPLETED: 'bg-green-900/50 text-green-300 border-green-700',
    FAILED:    'bg-red-900/50 text-red-300 border-red-700',
    CANCELLED: 'bg-gray-800 text-gray-500 border-gray-700',
  }
  const isRunning = session.status === 'RUNNING'
  const metrics   = session.latest_metrics

  return (
    <div className={cn('rounded-xl p-3 border space-y-2', isRunning ? 'border-blue-700/50 bg-blue-950/10' : 'border-gray-700 bg-gray-800/40')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-white">{session.session_id}</p>
          <p className="text-[10px] text-gray-400">{session.model_base} · {session.epochs} epochs · {session.dataset_size} samples</p>
          {session.description && <p className="text-[10px] text-gray-500 truncate">{session.description}</p>}
        </div>
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium flex-shrink-0', STATUS_STYLE[session.status])}>
          {session.status}
        </span>
      </div>

      {isRunning && (
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-1">
            <span>Epoch {session.current_epoch}/{session.epochs}</span>
            <span>{session.progress_pct}%</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${session.progress_pct}%` }} />
          </div>
        </div>
      )}

      {isRunning && metrics && Object.keys(metrics).length > 0 && (
        <div className="grid grid-cols-3 gap-1">
          {[['loss', 'Loss', (v: number) => v.toFixed(3)], ['mAP50', 'mAP50', (v: number) => `${(v*100).toFixed(1)}%`], ['precision', 'Prec', (v: number) => `${(v*100).toFixed(1)}%`]].map(([k, lbl, fmt]: any) => (
            <div key={k} className="bg-gray-700/40 rounded p-1 text-center">
              <p className="text-xs font-bold text-white">{metrics[k] != null ? fmt(metrics[k]) : '—'}</p>
              <p className="text-[9px] text-gray-500">{lbl}</p>
            </div>
          ))}
        </div>
      )}

      {session.status === 'COMPLETED' && session.final_metrics && (
        <div className="bg-green-950/30 border border-green-800/40 rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Award className="h-3.5 w-3.5 text-green-400" />
            <span className="text-[11px] font-semibold text-green-400">Training Complete</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {[['mAP50','mAP50'],['mAP95','mAP95'],['precision','Precision'],['recall','Recall']].map(([k,lbl]) => (
              <div key={k} className="text-center">
                <p className="text-xs font-bold text-white">{session.final_metrics[k] != null ? `${(session.final_metrics[k]*100).toFixed(1)}%` : '—'}</p>
                <p className="text-[10px] text-gray-500">{lbl}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {session.status === 'FAILED' && session.error && (
        <p className="text-[10px] text-red-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{session.error}</p>
      )}

      <p className="text-[10px] text-gray-600">
        {fmtTs(session.created_at)}{session.completed_at ? ` · done ${fmtTs(session.completed_at)}` : ''}
      </p>

      {isRunning && (
        <button onClick={() => onCancel(session.session_id)}
          className="w-full flex items-center justify-center gap-1 py-1.5 text-xs
                     bg-red-900/30 hover:bg-red-900/50 border border-red-800/40 text-red-400 rounded-lg transition-colors">
          <Square className="h-3 w-3" />Cancel
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  SAMPLE CARD (centre grid)
// ═══════════════════════════════════════════════════════════════

function SampleCard({ sample, labels, onVerify, onDelete }: {
  sample: TrainingSample; labels: string[]
  onVerify: (id: string, label: string, verified: boolean) => void
  onDelete: (id: string) => void
}) {
  const [editing,  setEditing]  = useState(false)
  const [newLabel, setNewLabel] = useState(sample.label)

  return (
    <div className={cn(
      'bg-gray-800/60 border rounded-lg p-2.5 space-y-1.5 transition-colors',
      sample.verified ? 'border-green-800/50' : 'border-gray-700'
    )}>
      {sample.thumbnail && (
        <div className="rounded overflow-hidden bg-gray-950" style={{ height: 68 }}>
          <img src={sample.thumbnail} alt={sample.label} className="w-full h-full object-cover" />
        </div>
      )}

      <div className="flex items-center gap-1">
        {sample.file_type === 'video'
          ? <FileVideo className="h-3 w-3 text-gray-500 flex-shrink-0" />
          : <Image className="h-3 w-3 text-gray-500 flex-shrink-0" />}
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: labelColour(sample.label) }} />
        <span className="text-[10px] text-white font-medium flex-1 truncate">{sample.label}</span>
        {sample.verified
          ? <CheckCircle className="h-3 w-3 text-green-400 flex-shrink-0" />
          : <span className="text-[8px] px-1 py-0.5 rounded bg-yellow-900/40 text-yellow-400 border border-yellow-700/40 flex-shrink-0">unverified</span>}
      </div>

      <p className="text-[9px] text-gray-500 truncate">{sample.filename} · {sample.file_size_kb}KB</p>

      {editing && (
        <select value={newLabel} onChange={e => setNewLabel(e.target.value)}
          className="w-full bg-gray-700 border border-gray-600 rounded px-1.5 py-1 text-[10px] text-white focus:outline-none">
          {labels.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      )}

      <div className="flex gap-1">
        {!sample.verified ? (
          <button onClick={() => { if (editing) { onVerify(sample.sample_id, newLabel, true); setEditing(false) } else setEditing(true) }}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[9px] rounded
                       bg-green-800/40 hover:bg-green-700/60 border border-green-700/50 text-green-400 transition-colors">
            <CheckCircle className="h-3 w-3" />{editing ? 'Save & Verify' : 'Verify'}
          </button>
        ) : (
          <button onClick={() => setEditing(e => !e)}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[9px] rounded
                       bg-gray-700/40 hover:bg-gray-600 border border-gray-600 text-gray-300 transition-colors">
            <Eye className="h-3 w-3" />{editing ? 'Cancel' : 'Re-label'}
          </button>
        )}
        <button onClick={() => onDelete(sample.sample_id)}
          className="px-1.5 py-1 bg-red-900/30 hover:bg-red-900/60 border border-red-800/50 text-red-400 rounded transition-colors">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {sample.used_in_training && (
        <p className="text-[9px] text-blue-400 text-center">used in training</p>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  DATASET STATS ROW
// ═══════════════════════════════════════════════════════════════

function DatasetStatsRow({ stats, indexStats }: { stats: DatasetStats | undefined; indexStats: any }) {
  if (!stats && !indexStats) return null

  const total    = stats?.total ?? indexStats?.hist_index_size ?? 0
  const verified = stats?.verified ?? total
  const pct      = total > 0 ? Math.round(verified / total * 100) : 0

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-800 flex-shrink-0">
      <Database className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
      <span className="text-[11px] text-gray-400">{total} total</span>
      <span className="text-[11px] text-green-400">{verified} verified</span>
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden mx-1">
        <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-gray-500">{pct}%</span>
      {indexStats?.model_ready && (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-950/40 border border-green-700/40 text-green-400 font-medium">
          Model active · {indexStats.hist_index_size} vectors
        </span>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  ALGO BENCHMARK PANEL  — live from /training/benchmark
// ═══════════════════════════════════════════════════════════════

const ALGO_COLOURS: Record<string, string> = {
  'Random Forest':        '#10b981',
  'SVM (RBF)':           '#a855f7',
  'Cosine NN (baseline)': '#06b6d4',
  'MLP (256,128)':        '#6366f1',
  'Gradient Boosting':    '#f97316',
  'KNN (k=5)':            '#f59e0b',
  'Decision Tree':        '#84cc16',
  'Logistic Regression':  '#38bdf8',
  'Naive Bayes':          '#f472b6',
  'KMeans':               '#6b7280',
}

// ─── Radar SVG chart (pure SVG, no external libs) ──────────────────────────
function RadarChart({ algos, metric }: {
  algos: { name: string; acc: number; f1: number | null; prec: number | null; rec: number | null }[]
  metric: 'acc' | 'f1' | 'prec' | 'rec'
}) {
  const supervised = algos.filter(a => {
    if (metric === 'f1')   return a.f1   !== null
    if (metric === 'prec') return a.prec !== null
    if (metric === 'rec')  return a.rec  !== null
    return true
  }).slice(0, 8)

  if (supervised.length === 0) return null

  const cx = 80, cy = 80, r = 62
  const getVal = (a: typeof supervised[0]) => {
    if (metric === 'f1')   return a.f1   ?? a.acc
    if (metric === 'prec') return a.prec ?? a.acc
    if (metric === 'rec')  return a.rec  ?? a.acc
    return a.acc
  }

  const minVal = 0.65  // axis baseline

  const toXY = (idx: number, val: number) => {
    const angle = (idx / supervised.length) * Math.PI * 2 - Math.PI / 2
    const scaled = (val - minVal) / (1.0 - minVal)
    const rr = Math.max(0, Math.min(1, scaled)) * r
    return { x: cx + Math.cos(angle) * rr, y: cy + Math.sin(angle) * rr }
  }
  const toAxisEnd = (idx: number) => {
    const angle = (idx / supervised.length) * Math.PI * 2 - Math.PI / 2
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }
  }
  const toLabelXY = (idx: number) => {
    const angle = (idx / supervised.length) * Math.PI * 2 - Math.PI / 2
    return { x: cx + Math.cos(angle) * (r + 16), y: cy + Math.sin(angle) * (r + 16) }
  }

  const points = supervised.map((a, i) => toXY(i, getVal(a)))
  const polyPoints = points.map(p => `${p.x},${p.y}`).join(' ')

  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1.0]

  return (
    <svg viewBox="0 0 160 160" className="w-full h-full">
      {/* Grid rings */}
      {rings.map(frac => {
        const ringPoints = supervised.map((_, i) => {
          const angle = (i / supervised.length) * Math.PI * 2 - Math.PI / 2
          return `${cx + Math.cos(angle) * r * frac},${cy + Math.sin(angle) * r * frac}`
        }).join(' ')
        return (
          <polygon key={frac} points={ringPoints}
            fill="none" stroke="#374151" strokeWidth="0.5" />
        )
      })}

      {/* Axes */}
      {supervised.map((_, i) => {
        const end = toAxisEnd(i)
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#374151" strokeWidth="0.5" />
      })}

      {/* Data polygon */}
      <polygon points={polyPoints}
        fill={ALGO_COLOURS[supervised[0].name] + '33'}
        stroke={ALGO_COLOURS[supervised[0].name]}
        strokeWidth="1.2" />

      {/* Data dots */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5"
          fill={ALGO_COLOURS[supervised[i].name]}
          stroke="#111827" strokeWidth="0.5" />
      ))}

      {/* Labels */}
      {supervised.map((a, i) => {
        const lp = toLabelXY(i)
        return (
          <text key={i} x={lp.x} y={lp.y}
            textAnchor="middle" dominantBaseline="middle"
            fontSize="6" fill={ALGO_COLOURS[a.name] ?? '#9ca3af'}>
            {a.name.split(' ')[0].substring(0, 5)}
          </text>
        )
      })}

      {/* Center label */}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="5.5" fill="#6b7280">
        {metric === 'acc' ? 'Accuracy' : metric === 'f1' ? 'F1 Score' : metric === 'prec' ? 'Precision' : 'Recall'}
      </text>
    </svg>
  )
}

// ─── Full performance report panel ─────────────────────────────────────────
function AlgoBenchmarkPanel() {
  const qc = useQueryClient()
  const [selectedAlgo, setSelectedAlgo] = useState<string | null>(null)
  const [radarMetric, setRadarMetric] = useState<'acc' | 'f1' | 'prec' | 'rec'>('acc')
  const [viewMode, setViewMode] = useState<'bars' | 'table' | 'radar'>('bars')

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ['training-benchmark'],
    queryFn:  () => fetch('/api/v1/training/benchmark').then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const runMut = useMutation({
    mutationFn: triggerRetrainNow,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['training-benchmark'] })
      qc.invalidateQueries({ queryKey: ['training-status'] })
    },
  })

  const algos = data?.algorithms && data?.ranking
    ? (data.ranking as string[]).map((name: string) => {
        const a = data.algorithms[name] ?? {}
        return {
          name,
          acc:    a.accuracy          ?? null,
          accStd: a.accuracy_std      ?? null,
          f1:     a.f1_macro          ?? null,
          f1Std:  a.f1_macro_std      ?? null,
          prec:   a.precision_macro   ?? null,
          rec:    a.recall_macro      ?? null,
          time:   a.total_time_s      ?? null,
          fitT:   a.fit_time_s        ?? null,
          note:   a.note,
          cm:     a.confusion_matrix  ?? [],
          perCls: a.per_class         ?? {},
          status: a.status,
        }
      })
    : []

  const prodAlgo: string  = data?.production_algo ?? data?.best_algorithm ?? ''
  const bestAlgo: string  = data?.best_algorithm  ?? ''
  const nSamples: number  = data?.n_samples ?? 0
  const nClasses: number  = data?.n_classes ?? 0
  const cvFolds:  number  = data?.cv_folds  ?? 5
  const ts: string        = data?.timestamp ?? ''

  const maxAcc = algos.length ? Math.max(...algos.map(a => a.acc ?? 0)) : 1

  const detail = selectedAlgo ? algos.find(a => a.name === selectedAlgo) : null

  return (
    <div className="rounded-xl border border-purple-700/40 bg-purple-950/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-purple-800/30">
        <BarChart2 className="h-3.5 w-3.5 text-purple-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-white">Algorithm Performance Report</span>
        {isLoading && <RefreshCw className="h-3 w-3 text-gray-500 animate-spin ml-1" />}
        <div className="ml-auto flex items-center gap-1.5">
          {/* View mode toggle */}
          {['bars', 'table', 'radar'].map(v => (
            <button key={v} onClick={() => setViewMode(v as any)}
              className={cn('text-[9px] px-1.5 py-0.5 rounded border transition-colors',
                viewMode === v
                  ? 'bg-purple-800 border-purple-600 text-purple-200'
                  : 'border-gray-700 text-gray-500 hover:border-gray-500')}>
              {v}
            </button>
          ))}
          <button
            onClick={() => refetch()}
            className="text-gray-600 hover:text-gray-300 transition-colors"
            title="Refresh benchmark"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded
                       bg-purple-800/50 hover:bg-purple-700 border border-purple-700/50
                       text-purple-300 disabled:opacity-50 transition-colors"
          >
            {runMut.isPending
              ? <><RefreshCw className="h-2.5 w-2.5 animate-spin" />Running…</>
              : <><Play className="h-2.5 w-2.5" />Re-run</>}
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2.5">
        {/* No data yet */}
        {!isLoading && algos.length === 0 && (
          <p className="text-[11px] text-gray-500 text-center py-3">
            No benchmark results yet.{' '}
            <button onClick={() => runMut.mutate()} className="text-purple-400 underline">Run benchmark</button>
          </p>
        )}

        {/* Meta row */}
        {nSamples > 0 && (
          <div className="flex items-center gap-2 text-[10px] text-gray-500 flex-wrap">
            <span className="text-white font-medium">{nSamples} samples</span>
            <span>·</span>
            <span>{nClasses} classes</span>
            <span>·</span>
            <span>{cvFolds}-fold stratified CV</span>
            {ts && <><span>·</span><span className="text-gray-600">{ts.replace('T', ' ').replace('Z', ' UTC')}</span></>}
          </div>
        )}

        {/* Production badge */}
        {prodAlgo && (
          <div className="flex items-center gap-2 text-[10px] bg-green-950/30 border border-green-700/40 rounded px-2 py-1.5">
            <Award className="h-3 w-3 text-green-400 flex-shrink-0" />
            <span className="text-green-300 font-medium">Production: <span style={{ color: ALGO_COLOURS[prodAlgo] ?? '#10b981' }}>{prodAlgo}</span></span>
            {bestAlgo !== prodAlgo && <span className="text-gray-600 ml-1">(best CV: {bestAlgo})</span>}
          </div>
        )}

        {/* ── BARS VIEW ───────────────────────────── */}
        {viewMode === 'bars' && algos.map((algo, i) => {
          const colour  = ALGO_COLOURS[algo.name] ?? '#6b7280'
          const isProd  = algo.name === prodAlgo
          const accPct  = algo.acc !== null ? Math.round(algo.acc * 100) : null
          const f1Pct   = algo.f1  !== null ? Math.round(algo.f1  * 100) : null
          const precPct = algo.prec !== null ? Math.round(algo.prec * 100) : null
          const recPct  = algo.rec  !== null ? Math.round(algo.rec  * 100) : null
          const barW    = algo.acc !== null ? Math.round((algo.acc / maxAcc) * 100) : 0
          const isSelected = selectedAlgo === algo.name

          return (
            <div key={algo.name}
              onClick={() => setSelectedAlgo(isSelected ? null : algo.name)}
              className={cn('rounded-lg p-2.5 border cursor-pointer transition-all',
                isProd  ? 'border-green-600/50 bg-green-950/20' :
                isSelected ? 'border-blue-600/50 bg-blue-950/20' :
                'border-gray-700/50 bg-gray-800/40 hover:border-gray-600')}>

              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colour }} />
                <span className={cn('text-[11px] font-semibold flex-1 truncate',
                  isProd ? 'text-green-300' : 'text-gray-300')}>
                  {i + 1}. {algo.name}
                </span>
                {isProd && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-green-700 text-green-200 flex-shrink-0">
                    ★ PRIMARY
                  </span>
                )}
                {algo.name === 'SVM (RBF)' && !isProd && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-purple-900/60 text-purple-300 flex-shrink-0">
                    SECONDARY
                  </span>
                )}
              </div>

              {/* Accuracy bar */}
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${barW}%`, background: colour }} />
                </div>
                <span className="text-[11px] font-bold w-9 text-right" style={{ color: colour }}>
                  {accPct !== null ? `${accPct}%` : '—'}
                </span>
              </div>

              {/* F1/P/R chips */}
              {(f1Pct !== null || precPct !== null || recPct !== null) && (
                <div className="flex gap-2 mt-1">
                  {f1Pct   !== null && <span className="text-[9px] text-gray-500">F1 <b className="text-gray-300">{f1Pct}%</b></span>}
                  {precPct !== null && <span className="text-[9px] text-gray-500">P <b className="text-gray-300">{precPct}%</b></span>}
                  {recPct  !== null && <span className="text-[9px] text-gray-500">R <b className="text-gray-300">{recPct}%</b></span>}
                  {algo.time !== null && <span className="text-[9px] text-gray-600 ml-auto">{algo.time}s</span>}
                </div>
              )}

              {algo.note && (
                <p className="text-[9px] text-gray-600 mt-0.5 truncate">{algo.note}</p>
              )}

              {/* Expanded detail */}
              {isSelected && (
                <div className="mt-2 pt-2 border-t border-gray-700 space-y-1.5">
                  <p className="text-[10px] text-gray-400 font-medium">5-Fold Cross-Validation Detail</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      ['Accuracy',  algo.acc,  algo.accStd],
                      ['F1 Macro',  algo.f1,   algo.f1Std],
                      ['Precision', algo.prec, null],
                      ['Recall',    algo.rec,  null],
                    ].map(([lbl, val, std]) => val !== null && (
                      <div key={String(lbl)} className="bg-gray-800/60 rounded px-2 py-1 text-center">
                        <p className="text-[9px] text-gray-500">{lbl}</p>
                        <p className="text-[12px] font-bold" style={{ color: colour }}>
                          {(Number(val) * 100).toFixed(1)}%
                          {std !== null && <span className="text-[9px] text-gray-600 font-normal"> ±{(Number(std) * 100).toFixed(1)}</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                  {algo.fitT !== null && (
                    <p className="text-[9px] text-gray-600">Avg fit time: {algo.fitT}s · Total: {algo.time}s</p>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* ── TABLE VIEW ──────────────────────────── */}
        {viewMode === 'table' && algos.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-gray-700">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-gray-800 text-gray-400">
                  <th className="text-left px-2 py-1.5 font-medium">Algorithm</th>
                  <th className="text-right px-2 py-1.5 font-medium">Acc</th>
                  <th className="text-right px-2 py-1.5 font-medium">F1</th>
                  <th className="text-right px-2 py-1.5 font-medium">Prec</th>
                  <th className="text-right px-2 py-1.5 font-medium">Rec</th>
                  <th className="text-right px-2 py-1.5 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {algos.map((algo, i) => {
                  const colour = ALGO_COLOURS[algo.name] ?? '#6b7280'
                  const isProd = algo.name === prodAlgo
                  return (
                    <tr key={algo.name}
                      className={cn('border-t border-gray-800/60',
                        isProd ? 'bg-green-950/20' : i % 2 === 0 ? 'bg-gray-900/30' : '')}>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: colour }} />
                          <span className={isProd ? 'text-green-300 font-semibold' : 'text-gray-300'}>{algo.name}</span>
                          {isProd && <span className="text-[8px] text-green-400">★</span>}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono" style={{ color: colour }}>
                        {algo.acc !== null ? `${(algo.acc * 100).toFixed(1)}` : '—'}
                        {algo.accStd !== null && <span className="text-gray-600 text-[8px]"> ±{(algo.accStd! * 100).toFixed(1)}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-300">
                        {algo.f1 !== null ? `${(algo.f1 * 100).toFixed(1)}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-300">
                        {algo.prec !== null ? `${(algo.prec * 100).toFixed(1)}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-300">
                        {algo.rec !== null ? `${(algo.rec * 100).toFixed(1)}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-600">
                        {algo.time !== null ? `${algo.time}s` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── RADAR VIEW ──────────────────────────── */}
        {viewMode === 'radar' && algos.length > 0 && (
          <div className="space-y-2">
            {/* Metric selector for radar */}
            <div className="flex gap-1">
              {(['acc', 'f1', 'prec', 'rec'] as const).map(m => (
                <button key={m} onClick={() => setRadarMetric(m)}
                  className={cn('text-[9px] px-2 py-0.5 rounded border transition-colors flex-1',
                    radarMetric === m
                      ? 'bg-purple-800 border-purple-600 text-white'
                      : 'border-gray-700 text-gray-500 hover:border-gray-500')}>
                  {m === 'acc' ? 'Accuracy' : m === 'f1' ? 'F1' : m === 'prec' ? 'Precision' : 'Recall'}
                </button>
              ))}
            </div>
            {/* Individual radar per algorithm */}
            <div className="grid grid-cols-2 gap-2">
              {algos.filter(a => a.acc !== null).map(algo => (
                <div key={algo.name}
                  className={cn('bg-gray-800/40 rounded-lg p-1.5 border',
                    algo.name === prodAlgo ? 'border-green-700/50' : 'border-gray-700/40')}>
                  <div className="h-20">
                    <RadarChart algos={[algo]} metric={radarMetric} />
                  </div>
                  <p className="text-[8px] text-center truncate mt-0.5"
                    style={{ color: ALGO_COLOURS[algo.name] ?? '#9ca3af' }}>
                    {algo.name}
                    {algo.name === prodAlgo && ' ★'}
                  </p>
                  <p className="text-[9px] text-center text-white font-bold">
                    {radarMetric === 'acc' && algo.acc !== null  && `${(algo.acc  * 100).toFixed(1)}%`}
                    {radarMetric === 'f1'  && algo.f1  !== null  && `${(algo.f1   * 100).toFixed(1)}%`}
                    {radarMetric === 'prec'&& algo.prec !== null && `${(algo.prec * 100).toFixed(1)}%`}
                    {radarMetric === 'rec' && algo.rec  !== null && `${(algo.rec  * 100).toFixed(1)}%`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status messages */}
        {runMut.isSuccess && (
          <p className="text-[10px] text-green-400 flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />Benchmark complete — Random Forest (PRIMARY) + SVM (SECONDARY) retrained
          </p>
        )}
        {runMut.isError && (
          <p className="text-[10px] text-red-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />Run failed — check server logs
          </p>
        )}

        {/* Legend: algorithm roles */}
        {algos.length > 0 && (
          <div className="rounded-lg bg-gray-800/40 border border-gray-700/40 p-2 space-y-1">
            <p className="text-[9px] text-gray-500 font-medium uppercase tracking-wide">Detection Priority Chain</p>
            {[
              { role: '1 · PRIMARY',   name: 'YOLO Cloud',           colour: '#eab308', desc: 'Custom YOLOv11n — Accident Signals v2 (10 classes)' },
              { role: '2 · SECONDARY', name: 'Random Forest',        colour: '#10b981', desc: 'Highest sklearn accuracy (93.6%) — 200 trees' },
              { role: '3 · TERTIARY',  name: 'SVM (RBF)',            colour: '#a855f7', desc: 'Best precision (94.7%) — calibrated probs' },
              { role: '4 · FALLBACK',  name: 'Cosine NN (baseline)', colour: '#06b6d4', desc: 'Histogram nearest-neighbour — no sklearn needed' },
            ].map(({ role, name, colour, desc }) => (
              <div key={role} className="flex items-start gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ background: colour }} />
                <div>
                  <span className="text-[9px] text-gray-500">{role}: </span>
                  <span className="text-[9px] text-white font-medium">{name}</span>
                  <span className="text-[9px] text-gray-600"> — {desc}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  VIDEO EXTRACT PANEL  — upload video, auto-extract frames
// ═══════════════════════════════════════════════════════════════

function VideoExtractPanel({ labels, onExtracted }: { labels: string[]; onExtracted: () => void }) {
  const [selectedLabel, setSelectedLabel] = useState(labels[0] ?? '')
  const [fps,           setFps]           = useState(1.0)
  const [maxFrames,     setMaxFrames]     = useState(200)
  const [uploading,     setUploading]     = useState(false)
  const [uploadPct,     setUploadPct]     = useState<number | null>(null)
  const [result,        setResult]        = useState<any | null>(null)
  const [error,         setError]         = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleExtract = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(ext)) {
      setError('Please pick a video file (MP4, AVI, MOV, MKV, WEBM)'); return
    }
    if (!selectedLabel) { setError('Pick a label first'); return }
    setUploading(true); setResult(null); setError('')
    try {
      const res = await extractVideoFrames(file, selectedLabel, fps, maxFrames, 'CAM-VIDEO', '', p => setUploadPct(p))
      setResult(res)
      setUploadPct(null)
      onExtracted()
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Extraction failed')
      setUploadPct(null)
    }
    setUploading(false)
  }

  return (
    <div className="space-y-3">
      {/* Label picker */}
      <div>
        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-1.5">1. Pick Incident Label</p>
        <div className="grid grid-cols-3 gap-1">
          {labels.map(lbl => (
            <button key={lbl} onClick={() => setSelectedLabel(lbl)}
              className={cn(
                'text-[9px] py-1 px-1.5 rounded border text-left transition-colors leading-tight',
                selectedLabel === lbl
                  ? 'border-orange-500 bg-orange-950/40 text-white'
                  : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-500'
              )}>
              <span className="w-1.5 h-1.5 rounded-full inline-block mr-0.5 align-middle"
                style={{ background: labelColour(lbl) }} />
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* FPS + max frames */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] text-gray-400 mb-1">Extract {fps} FPS</p>
          <input type="range" min={0.2} max={5} step={0.2} value={fps}
            onChange={e => setFps(parseFloat(e.target.value))}
            className="w-full accent-orange-500" />
          <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
            <span>0.2</span><span>5.0</span>
          </div>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 mb-1">Max {maxFrames} frames</p>
          <input type="range" min={20} max={500} step={10} value={maxFrames}
            onChange={e => setMaxFrames(parseInt(e.target.value))}
            className="w-full accent-orange-500" />
          <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
            <span>20</span><span>500</span>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-gray-600 bg-gray-800/50 rounded px-2 py-1.5">
        Each extracted frame is saved as a training image and indexed into the AI detector immediately — no training session needed.
      </p>

      {/* Upload button */}
      <input ref={fileRef} type="file" accept=".mp4,.avi,.mov,.mkv,.webm" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) { handleExtract(f); e.target.value = '' } }} />
      <button onClick={() => fileRef.current?.click()} disabled={uploading || !selectedLabel}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-bold
                   bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg transition-colors">
        {uploading
          ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Uploading &amp; Extracting…</>
          : <><Film className="h-3.5 w-3.5" />Upload Video &amp; Extract Frames</>}
      </button>

      {/* Progress bar */}
      {uploadPct !== null && (
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-1">
            <span>Uploading video…</span><span>{uploadPct}%</span>
          </div>
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-950/40 border border-red-700/50 rounded-lg px-3 py-2">
          <p className="text-[11px] text-red-300 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />{error}
          </p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-green-950/30 border border-green-700/50 rounded-lg p-3 space-y-1.5">
          <p className="text-[11px] font-semibold text-green-400 flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5" />{result.message}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Extracted', result.extracted, '#f59e0b'],
              ['Indexed',   result.indexed,   '#10b981'],
              ['Skipped',   result.skipped,   '#6b7280'],
            ].map(([lbl, val, col]) => (
              <div key={String(lbl)} className="text-center bg-gray-800/40 rounded p-2">
                <p className="text-sm font-bold" style={{ color: String(col) }}>{val}</p>
                <p className="text-[10px] text-gray-500">{lbl}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500">Label: <span className="text-white">{result.label}</span></p>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// IP CAM CAPTURE — grab frames from live IP cam → training dataset
// ══════════════════════════════════════════════════════════════════
function IPCamCapturePanel({ labels, onCaptured }: { labels: string[]; onCaptured: () => void }) {
  const [url,       setUrl]       = useState(() => localStorage.getItem('vv_ipcam_url') || 'http://192.168.1.9:8081/video')
  const [label,     setLabel]     = useState(labels[0] ?? 'Road Accident')
  const [count,     setCount]     = useState(5)
  const [interval,  setInterval2] = useState(1)
  const [capturing, setCapturing] = useState(false)
  const [done,      setDone]      = useState(0)
  const [error,     setError]     = useState('')
  const [preview,   setPreview]   = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  // Live preview via MJPEG img tag
  const mjpegUrl = url.trim()

  async function doCapture() {
    if (!url.trim() || !label) { setError('Set URL and label first'); return }
    setCapturing(true); setDone(0); setError('')
    try {
      // Grab frames one by one by calling grabIPCamFrame repeatedly
      const { grabIPCamFrame } = await import('@/lib/cctvApi')
      const snapshots: string[] = []
      for (let i = 0; i < count; i++) {
        try {
          const result = await grabIPCamFrame(url.trim(), `CAM-IPCAM-${i}`)
          if (result?.snapshot) snapshots.push(result.snapshot)
          if (interval > 0 && i < count - 1) await new Promise(r => setTimeout(r, interval * 1000))
        } catch { /* skip failed frame */ }
      }
      if (!snapshots.length) { setError('No frames received — check IP cam URL'); return }

      // Convert base64 frames to File objects and upload as training samples
      const files: File[] = snapshots.map((b64: string, i: number) => {
        const byteStr = atob(b64.replace(/^data:image\/\w+;base64,/, ''))
        const ab = new Uint8Array(byteStr.length)
        for (let j = 0; j < byteStr.length; j++) ab[j] = byteStr.charCodeAt(j)
        return new File([ab], `ipcam_${Date.now()}_${i}.jpg`, { type: 'image/jpeg' })
      })
      setPreview(snapshots[0])

      let ok = 0
      for (const f of files) {
        try {
          const fd = new FormData(); fd.append('file', f); fd.append('label', label)
          await fetch('/api/v1/training/upload', { method: 'POST', body: fd })
          ok++; setDone(ok)
        } catch { /* skip */ }
      }
      if (ok > 0) { onCaptured(); setError('') }
      else setError('Upload failed — check backend')
    } catch (e: any) {
      setError(e?.message ?? 'Capture error')
    } finally {
      setCapturing(false)
    }
  }

  useEffect(() => { labels[0] && setLabel(l => l || labels[0]) }, [labels])

  return (
    <div className="space-y-3">
      {/* Live preview */}
      <div className="rounded-lg overflow-hidden bg-black border border-gray-700 aspect-video relative">
        {mjpegUrl ? (
          <img
            ref={imgRef}
            src={mjpegUrl}
            alt="IP cam preview"
            className="w-full h-full object-contain"
            onError={() => setPreview(null)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs">
            <WifiOff className="h-6 w-6 mr-2" /> No URL set
          </div>
        )}
        {capturing && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <div className="text-center">
              <Crosshair className="h-8 w-8 text-green-400 animate-spin mx-auto mb-1" />
              <p className="text-xs text-green-400">Capturing {done}/{count}</p>
            </div>
          </div>
        )}
        {done > 0 && !capturing && (
          <div className="absolute top-2 right-2 bg-green-500/90 text-white text-[10px] px-2 py-0.5 rounded-full">
            ✓ {done} saved
          </div>
        )}
      </div>

      {/* URL */}
      <div>
        <label className="block text-[10px] text-gray-400 mb-1">IP Camera URL</label>
        <input
          value={url}
          onChange={e => { setUrl(e.target.value); localStorage.setItem('vv_ipcam_url', e.target.value) }}
          placeholder="http://192.168.1.9:8081/video"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Label */}
      <div>
        <label className="block text-[10px] text-gray-400 mb-1">Training Label</label>
        <select value={label} onChange={e => setLabel(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none">
          {labels.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {/* Count + Interval */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-gray-400 mb-1">Frames to capture</label>
          <input type="number" min={1} max={50} value={count}
            onChange={e => setCount(Math.max(1, Math.min(50, +e.target.value)))}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-400 mb-1">Interval (sec)</label>
          <input type="number" min={0.5} max={10} step={0.5} value={interval}
            onChange={e => setInterval2(+e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none" />
        </div>
      </div>

      {error && <p className="text-[10px] text-red-400 bg-red-950/30 rounded px-2 py-1">{error}</p>}

      <button onClick={doCapture} disabled={capturing}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-semibold transition-colors">
        <Camera className="h-3.5 w-3.5" />
        {capturing ? `Capturing ${done}/${count}…` : `Capture ${count} frames → Dataset`}
      </button>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// MODEL UPLOAD — upload .hef / .pt / .onnx to the Pi or Catalyst
// ══════════════════════════════════════════════════════════════════
function ModelUploadPanel() {
  const [file,     setFile]     = useState<File | null>(null)
   const [piIp,     setPiIp]     = useState(() => localStorage.getItem('vv_rpi_ip') || '192.168.137.186')
  const [status,   setStatus]   = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [msg,      setMsg]      = useState('')
  const [progress, setProgress] = useState(0)

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) { setFile(f); setStatus('idle'); setMsg('') }
    e.target.value = ''
  }

  async function upload() {
    if (!file) return
    setStatus('uploading'); setProgress(0); setMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('pi_ip', piIp)
      fd.append('filename', file.name)

      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100))
      }
      xhr.onload = () => {
        if (xhr.status === 200) {
          setStatus('done')
          setMsg(`✓ ${file.name} uploaded (${(file.size / 1024 / 1024).toFixed(1)} MB)`)
        } else {
          setStatus('error')
          setMsg(`Upload failed: HTTP ${xhr.status}`)
        }
      }
      xhr.onerror = () => { setStatus('error'); setMsg('Network error') }
      xhr.open('POST', '/api/v1/training/upload-model')
      xhr.send(fd)
    } catch (e: any) {
      setStatus('error'); setMsg(e?.message ?? 'Upload failed')
    }
  }

  const ext = file?.name.split('.').pop()?.toLowerCase() ?? ''
  const extColour = ext === 'hef' ? 'text-purple-400' : ext === 'pt' ? 'text-blue-400' : ext === 'onnx' ? 'text-green-400' : 'text-gray-400'

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-purple-800/40 bg-purple-950/10 px-3 py-2 text-[10px] text-purple-300">
        <p className="font-semibold mb-0.5 flex items-center gap-1.5">
          <PackageOpen className="h-3.5 w-3.5" /> Upload Trained Model
        </p>
        <p className="text-purple-400/70">
          Upload a <span className="text-purple-300 font-semibold">.hef</span> (Hailo), <span className="text-blue-300 font-semibold">.pt</span> (PyTorch), or <span className="text-green-300 font-semibold">.onnx</span> model.
          It will be sent to the Pi at the IP below and saved as <code className="bg-black/30 px-1 rounded">~/yolov11n.hef</code>.
        </p>
      </div>

      {/* Pi IP */}
      <div>
        <label className="block text-[10px] text-gray-400 mb-1">Raspberry Pi IP</label>
        <input value={piIp} onChange={e => { setPiIp(e.target.value); localStorage.setItem('vv_rpi_ip', e.target.value) }}
          placeholder="192.168.1.8"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500" />
      </div>

      {/* File picker */}
      <label className="flex flex-col items-center gap-2 border-2 border-dashed border-gray-700 hover:border-purple-500 rounded-xl p-4 cursor-pointer transition-colors">
        <PackageOpen className="h-8 w-8 text-gray-600" />
        <span className="text-xs text-gray-400">Click to pick model file</span>
        <span className="text-[10px] text-gray-600">.hef · .pt · .onnx · .tflite</span>
        <input type="file" accept=".hef,.pt,.onnx,.tflite,.weights" onChange={onPick} className="hidden" />
      </label>

      {file && (
        <div className="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-2 flex items-center gap-2">
          <PackageOpen className={`h-4 w-4 flex-shrink-0 ${extColour}`} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-white truncate font-medium">{file.name}</p>
            <p className="text-[10px] text-gray-400">{(file.size / 1024 / 1024).toFixed(1)} MB · .{ext}</p>
          </div>
        </div>
      )}

      {status === 'uploading' && (
        <div>
          <div className="flex justify-between text-[10px] text-gray-400 mb-1">
            <span>Uploading…</span><span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div className="bg-purple-500 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {msg && (
        <p className={`text-[10px] px-2 py-1 rounded ${status === 'done' ? 'text-green-400 bg-green-950/30' : 'text-red-400 bg-red-950/30'}`}>
          {msg}
        </p>
      )}

      <button onClick={upload} disabled={!file || status === 'uploading'}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-xs font-semibold transition-colors">
        <Upload className="h-3.5 w-3.5" />
        {status === 'uploading' ? `Uploading ${progress}%…` : 'Upload Model to Pi'}
      </button>

      {status === 'done' && (
        <div className="rounded-xl border border-green-700/40 bg-green-950/20 px-3 py-2 text-[10px] text-green-300">
          <p className="font-semibold mb-0.5">Next steps</p>
          <ol className="list-decimal list-inside space-y-0.5 text-green-400/80">
            <li>SSH into the Pi: <code className="bg-black/30 px-1 rounded">ssh karthikeya@{piIp}</code></li>
            <li>Restart the service: <code className="bg-black/30 px-1 rounded">sudo systemctl restart vigilante</code></li>
            <li>Open the live view to verify the new model is running</li>
          </ol>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  ACCIDENT MODEL PANEL — 27-class image upload + retrain status
// ═══════════════════════════════════════════════════════════════

const ACC_CLASS_COLOURS: Record<string, string> = {
  accident: '#ef4444', ambulance: '#22c55e', auto_rickshaw: '#f97316',
  bus: '#3b82f6', car: '#6366f1', damaged_vehicle: '#f59e0b',
  fallen_injured_person: '#ec4899', firetruck: '#dc2626', license_plate: '#94a3b8',
  motorcycle: '#8b5cf6', person: '#06b6d4', police_vehicle: '#2563eb',
  road_debris: '#a16207', tipped_over: '#b45309', truck: '#0891b2',
  vehicle_fire: '#e11d48', damaged_head_light: '#78716c', damaged_hood: '#71717a',
  damaged_trunk: '#6b7280', damaged_window: '#64748b', damaged_windscreen: '#475569',
  damaged_bumper: '#7c3aed', damaged_door: '#a855f7', damaged_fender: '#9333ea',
  damaged_mirror_glass: '#c026d3', dent_or_scratch: '#db2777', missing_grille: '#be185d',
}

function AccidentModelPanel() {
  const qc = useQueryClient()
  const [selectedClass, setSelectedClass] = useState<string>('')
  const [files,         setFiles]         = useState<File[]>([])
  const [uploading,     setUploading]     = useState(false)
  const [progress,      setProgress]      = useState(0)
  const [msg,           setMsg]           = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const labelsQ  = useQuery({ queryKey: ['accident-labels'],  queryFn: fetchAccidentLabels,  refetchInterval: 15_000 })
  const statusQ  = useQuery({ queryKey: ['accident-status'],  queryFn: fetchAccidentStatus,  refetchInterval: 10_000 })

  const counts  = labelsQ.data?.image_counts ?? {}
  const total   = statusQ.data?.total_images ?? 0
  const pending = statusQ.data?.retrain_pending ?? false
  const queued  = statusQ.data?.retrain_queued ?? 0
  const labels  = labelsQ.data?.labels ?? []

  async function doUpload() {
    if (!selectedClass || files.length === 0) return
    setUploading(true); setProgress(0); setMsg(null)
    try {
      const result = await uploadAccidentImages(files, selectedClass, p => setProgress(p))
      if (result.errors.length > 0) {
        setMsg({ type: 'err', text: `${result.saved} saved, ${result.errors.length} error(s): ${result.errors[0]}` })
      } else {
        setMsg({ type: 'ok', text: `✓ ${result.saved} image${result.saved !== 1 ? 's' : ''} uploaded for "${selectedClass}". Auto-retrain scheduled.` })
      }
      setFiles([])
      qc.invalidateQueries({ queryKey: ['accident-labels'] })
      qc.invalidateQueries({ queryKey: ['accident-status'] })
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.response?.data?.detail ?? e?.message ?? 'Upload failed' })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3 text-xs">
      {/* Header card */}
      <div className="rounded-xl border border-orange-800/40 bg-orange-950/10 px-3 py-2 text-[10px] text-orange-300">
        <p className="font-semibold mb-0.5 flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5" /> 27-Class Accident Model Training
        </p>
        <p className="text-orange-400/70">
          Upload labelled images for each class. Images go to <span className="font-semibold text-orange-200">Catalyst Stratus</span> and the model
          <span className="text-orange-200 font-semibold"> auto-retrains</span> after every upload or officer approve/reject.
        </p>
      </div>

      {/* Auto-retrain indicator */}
      {(pending || queued > 0) && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-blue-950/30 border border-blue-700/30 text-[10px] text-blue-300">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
          Auto-retrain queued ({queued} pending) — runs in ~30 s
        </div>
      )}

      {/* Total count */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-gray-400">{total} images across {labels.length} classes</span>
        <button onClick={() => { qc.invalidateQueries({ queryKey: ['accident-labels'] }); qc.invalidateQueries({ queryKey: ['accident-status'] }) }}
          className="text-gray-500 hover:text-white p-0.5 rounded"><RefreshCw className="h-3 w-3" /></button>
      </div>

      {/* Class grid */}
      <div className="grid grid-cols-2 gap-1 max-h-52 overflow-y-auto pr-1">
        {labels.map((cls: string) => {
          const n = counts[cls] ?? 0
          const col = ACC_CLASS_COLOURS[cls] ?? '#6b7280'
          return (
            <button key={cls} onClick={() => setSelectedClass(c => c === cls ? '' : cls)}
              className={cn(
                'flex items-center justify-between px-2 py-1.5 rounded-lg border text-left transition-colors',
                selectedClass === cls
                  ? 'border-orange-500 bg-orange-950/30 text-white'
                  : 'border-gray-700/60 bg-gray-800/30 text-gray-300 hover:border-gray-600 hover:bg-gray-800/50'
              )}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col }} />
                <span className="text-[9px] truncate font-medium leading-tight">{cls.replace(/_/g, ' ')}</span>
              </div>
              <span className={cn(
                'text-[9px] font-bold flex-shrink-0 ml-1',
                n === 0 ? 'text-red-400' : n < 10 ? 'text-yellow-400' : 'text-green-400'
              )}>{n}</span>
            </button>
          )
        })}
      </div>

      {/* Upload section */}
      <div className="border-t border-gray-800 pt-3 space-y-2">
        <p className="text-[10px] text-gray-400 font-medium">
          {selectedClass
            ? <span>Uploading for: <span className="text-orange-300 font-bold">{selectedClass.replace(/_/g, ' ')}</span> ({counts[selectedClass] ?? 0} images)</span>
            : 'Select a class above to upload images'}
        </p>

        {/* Drop zone */}
        <label className={cn(
          'flex flex-col items-center gap-1.5 border-2 border-dashed rounded-xl p-3 cursor-pointer transition-colors',
          selectedClass ? 'border-gray-700 hover:border-orange-500' : 'border-gray-800 opacity-50 cursor-not-allowed'
        )}>
          <CloudUpload className="h-6 w-6 text-gray-500" />
          <span className="text-[10px] text-gray-400">
            {files.length > 0 ? `${files.length} file${files.length !== 1 ? 's' : ''} selected` : 'Click to pick images'}
          </span>
          <span className="text-[9px] text-gray-600">.jpg · .jpeg · .png · multiple allowed</span>
          <input ref={fileRef} type="file" accept="image/*" multiple disabled={!selectedClass}
            onChange={e => { if (e.target.files) setFiles(Array.from(e.target.files)); e.target.value = '' }}
            className="hidden" />
        </label>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {files.slice(0, 8).map((f, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded bg-gray-800 text-[9px] text-gray-300 border border-gray-700 truncate max-w-[120px]">{f.name}</span>
            ))}
            {files.length > 8 && <span className="px-1.5 py-0.5 rounded bg-gray-700 text-[9px] text-gray-400">+{files.length - 8} more</span>}
          </div>
        )}

        {uploading && (
          <div>
            <div className="flex justify-between text-[10px] text-gray-400 mb-1">
              <span>Uploading to Stratus…</span><span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-1"><div className="bg-orange-500 h-1 rounded-full transition-all" style={{ width: `${progress}%` }} /></div>
          </div>
        )}

        {msg && (
          <p className={cn('text-[10px] px-2 py-1 rounded', msg.type === 'ok' ? 'text-green-400 bg-green-950/30' : 'text-red-400 bg-red-950/30')}>
            {msg.text}
          </p>
        )}

        <button onClick={doUpload}
          disabled={!selectedClass || files.length === 0 || uploading}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-semibold transition-colors">
          <CloudUpload className="h-3.5 w-3.5" />
          {uploading ? `Uploading ${progress}%…` : `Upload ${files.length > 0 ? files.length + ' image' + (files.length !== 1 ? 's' : '') : 'Images'}`}
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[9px] text-gray-500 pt-1">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />0 images</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" />1–9</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" />10+</span>
        <span className="ml-auto">Recommended: 50+ per class</span>
      </div>
    </div>
  )
}

type LeftTab = 'scan' | 'upload' | 'video' | 'ipcam' | 'train' | 'test' | 'model' | 'hef' | 'accident'

export default function AITrainingPage() {
  const qc = useQueryClient()
  const [leftTab,       setLeftTab]       = useState<LeftTab>('scan')
  const [filterLabel,   setFilterLabel]   = useState('')
  const [filterVerified,setFilterVerified]= useState<'' | 'true' | 'false'>('')

  // ── Labels ──────────────────────────────────────────────────
  const labelsQ = useQuery({ queryKey: ['training-labels'], queryFn: fetchTrainingLabels })
  const labels = labelsQ.data?.labels ?? []

  // ── Dataset (grid) ──────────────────────────────────────────
  const datasetQ = useQuery({
    queryKey: ['training-dataset', filterLabel, filterVerified],
    queryFn: () => fetchTrainingDataset({
      label:    filterLabel || undefined,
      verified: filterVerified === '' ? undefined : filterVerified === 'true',
    }),
    refetchInterval: 10_000,
  })
  const samples = datasetQ.data?.samples ?? []
  const stats   = datasetQ.data?.stats

  // ── Status (model index) ────────────────────────────────────
  const statusQ = useQuery<any>({
    queryKey: ['training-status'],
    queryFn: () => fetch('/api/v1/training/status').then(r => r.json()),
    refetchInterval: 8_000,
  })

  // ── Sessions ────────────────────────────────────────────────
  const sessionsQ = useQuery({
    queryKey: ['training-sessions'],
    queryFn: fetchTrainingSessions,
    refetchInterval: 3_000,
  })
  const sessions = sessionsQ.data?.sessions ?? []

  // ── Current model ───────────────────────────────────────────
  const modelQ = useQuery({ queryKey: ['training-current-model'], queryFn: fetchCurrentModel, refetchInterval: 10_000 })

  // ── Mutations ───────────────────────────────────────────────
  const verifyMut = useMutation({
    mutationFn: ({ id, label, verified }: { id: string; label: string; verified: boolean }) =>
      verifySample(id, label, verified),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training-dataset'] }),
  })
  const deleteMut = useMutation({
    mutationFn: deleteSample,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training-dataset'] }),
  })
  const cancelMut = useMutation({
    mutationFn: cancelTraining,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training-sessions'] }),
  })

  const hasRunning = sessions.some(s => s.status === 'RUNNING' || s.status === 'QUEUED')

  // ── Sidebar tabs ────────────────────────────────────────────
  const tabs: { id: LeftTab; icon: React.ReactNode; label: string; badge?: number; colour?: string }[] = [
    { id: 'scan',   icon: <HardDrive className="h-3.5 w-3.5" />,    label: 'Scan Disk' },
    { id: 'upload', icon: <Upload className="h-3.5 w-3.5" />,       label: 'Upload' },
    { id: 'video',  icon: <Film className="h-3.5 w-3.5" />,         label: 'Video',   colour: '#f97316' },
    { id: 'ipcam',  icon: <Camera className="h-3.5 w-3.5" />,       label: 'IP Cam',  colour: '#22c55e' },
    { id: 'train',  icon: <Play className="h-3.5 w-3.5" />,         label: 'Train',   badge: sessions.filter(s => s.status === 'RUNNING').length },
    { id: 'test',   icon: <FlaskConical className="h-3.5 w-3.5" />, label: 'Test AI' },
    { id: 'model',    icon: <Cpu className="h-3.5 w-3.5" />,          label: 'Model' },
    { id: 'hef',      icon: <PackageOpen className="h-3.5 w-3.5" />,  label: 'Upload Model', colour: '#a855f7' },
    { id: 'accident', icon: <Zap className="h-3.5 w-3.5" />,          label: '27-Class', colour: '#f97316' },
  ]

  return (
    <div className="h-full flex flex-col bg-gray-950">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 bg-gray-900 flex-shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-purple-700 p-2 rounded-lg">
            <BrainCircuit className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">AI Model Training Studio</h1>
            <p className="text-[11px] text-gray-400">
              Scan disk → verify samples → train → test detection
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasRunning && (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-blue-950/40 text-blue-400 border border-blue-700/40">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Training…
            </span>
          )}
          {statusQ.data?.model_ready && (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-950/40 text-green-400 border border-green-700/40">
              <Shield className="h-3 w-3" />
              {statusQ.data.hist_index_size} vectors · {statusQ.data.total_labels} labels
            </span>
          )}
          <button
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['training-dataset'] })
              qc.invalidateQueries({ queryKey: ['training-sessions'] })
              qc.invalidateQueries({ queryKey: ['training-status'] })
              qc.invalidateQueries({ queryKey: ['training-current-model'] })
            }}
            className="text-gray-500 hover:text-white p-1 rounded transition-colors" title="Refresh all">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── How it works ── */}
      <div className="flex items-center gap-2 px-5 py-1.5 bg-blue-950/20 border-b border-blue-900/30 text-[10px] text-blue-300 flex-shrink-0 overflow-x-auto">
        <BookOpen className="h-3 w-3 flex-shrink-0" />
        {['① Scan Disk to load images', '② Start Training', '③ Use Test AI tab to verify', '④ Model auto-activates on CCTV page'].map((step, i) => (
          <span key={i} className="flex items-center gap-1 whitespace-nowrap">
            {i > 0 && <ChevronRight className="h-2.5 w-2.5 text-blue-700" />}
            {step}
          </span>
        ))}
      </div>

      {/* ── Dataset stats bar ── */}
      <DatasetStatsRow stats={stats} indexStats={statusQ.data} />

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden flex">

        {/* ── Left sidebar with tabs ── */}
        <div className="w-72 flex-shrink-0 border-r border-gray-800 flex flex-col bg-gray-900/50">

          {/* Tab buttons */}
          <div className="flex border-b border-gray-800 bg-gray-900 flex-shrink-0">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setLeftTab(tab.id)}
                className={cn(
                  'flex-1 flex flex-col items-center gap-0.5 py-2 text-[9px] font-medium transition-colors relative',
                  leftTab === tab.id
                    ? 'text-white bg-gray-800/60 border-b-2 border-purple-500'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'
                )}>
                {tab.icon}
                <span className="leading-none">{tab.label}</span>
                {(tab.badge ?? 0) > 0 && (
                  <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-blue-500 rounded-full text-[8px] text-white flex items-center justify-center">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content — independently scrollable */}
          <div className="flex-1 overflow-y-auto p-3">

            {leftTab === 'scan' && (
              <div className="space-y-3">
                <ModelStatusBanner />
                <YoloModelCard onModelChanged={() => {
                  qc.invalidateQueries({ queryKey: ['training-dataset'] })
                  qc.invalidateQueries({ queryKey: ['training-status'] })
                }} />
                <ScanDiskCard onScanned={() => {
                  qc.invalidateQueries({ queryKey: ['training-dataset'] })
                  qc.invalidateQueries({ queryKey: ['training-status'] })
                }} />
              </div>
            )}

            {leftTab === 'upload' && (
              <div className="space-y-3">
                <div className="rounded-xl border border-blue-800/40 bg-blue-950/10 px-3 py-2 text-[10px] text-blue-300">
                  <p className="font-semibold mb-0.5">Upload new images / videos</p>
                  <p className="text-blue-400/70">Pick a label, then add files. They will be saved and indexed for training.</p>
                </div>
                <UploadPanel labels={labels} onUploaded={() => {
                  qc.invalidateQueries({ queryKey: ['training-dataset'] })
                  qc.invalidateQueries({ queryKey: ['training-status'] })
                }} />
              </div>
            )}

            {leftTab === 'video' && (
              <div className="space-y-3">
                <div className="rounded-xl border border-orange-800/40 bg-orange-950/10 px-3 py-2 text-[10px] text-orange-300">
                  <p className="font-semibold mb-0.5 flex items-center gap-1.5">
                    <Film className="h-3.5 w-3.5" />Video Frame Extraction
                  </p>
                  <p className="text-orange-400/70">
                    Upload any incident video. Frames are extracted at your chosen FPS, saved as training images,
                    and indexed into the AI detector immediately — model improves before you even click Train.
                  </p>
                </div>
                <VideoExtractPanel labels={labels} onExtracted={() => {
                  qc.invalidateQueries({ queryKey: ['training-dataset'] })
                  qc.invalidateQueries({ queryKey: ['training-status'] })
                }} />
              </div>
            )}

            {leftTab === 'train' && (
              <div className="space-y-3">
                {hasRunning ? (
                  <div className="rounded-xl border border-blue-800/40 bg-blue-950/10 p-4 text-center space-y-2">
                    <RefreshCw className="h-6 w-6 mx-auto text-blue-400 animate-spin" />
                    <p className="text-xs text-blue-300 font-semibold">Training in progress</p>
                    <p className="text-[10px] text-blue-400">Live metrics shown in sessions panel →</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border border-purple-800/40 bg-purple-950/10 px-3 py-2 text-[10px] text-purple-300">
                      <p className="font-semibold mb-0.5">Train on {stats?.verified ?? statusQ.data?.hist_index_size ?? 0} verified images</p>
                      <p className="text-purple-400/70">Training indexes all images into the AI feature store. Takes ~30s for 243 images.</p>
                    </div>
                    <TrainingPanel onStarted={() => qc.invalidateQueries({ queryKey: ['training-sessions'] })} />
                  </>
                )}
              </div>
            )}

            {leftTab === 'test' && (
              <div className="space-y-3">
                <div className="rounded-xl border border-purple-800/40 bg-purple-950/10 px-3 py-2 text-[10px] text-purple-300">
                  <p className="font-semibold mb-0.5">Test AI Detection</p>
                  <p className="text-purple-400/70">Browse or paste any image to see what the trained model detects — with per-label confidence bars.</p>
                </div>
                <TestDetectionPanel />
              </div>
            )}

            {leftTab === 'ipcam' && (
              <div className="space-y-3">
                <div className="rounded-xl border border-green-800/40 bg-green-950/10 px-3 py-2 text-[10px] text-green-300">
                  <p className="font-semibold mb-0.5 flex items-center gap-1.5">
                    <Camera className="h-3.5 w-3.5" /> Capture from IP Camera
                  </p>
                  <p className="text-green-400/70">
                    Point your phone IP camera at a scene, choose a label, and capture frames directly into the training dataset.
                  </p>
                </div>
                <IPCamCapturePanel labels={labels} onCaptured={() => {
                  qc.invalidateQueries({ queryKey: ['training-dataset'] })
                  qc.invalidateQueries({ queryKey: ['training-status'] })
                }} />
              </div>
            )}

            {leftTab === 'hef' && (
              <div className="space-y-3">
                <ModelUploadPanel />
              </div>
            )}

            {leftTab === 'accident' && (
              <div className="space-y-3">
                <AccidentModelPanel />
              </div>
            )}

            {leftTab === 'model' && (
              <div className="space-y-3">
                <ModelStatusBanner />
                <YoloModelCard onModelChanged={() => {
                  qc.invalidateQueries({ queryKey: ['training-status'] })
                  qc.invalidateQueries({ queryKey: ['training-dataset'] })
                }} />
                {modelQ.data && (
                  <div className={cn('rounded-xl p-3.5 border space-y-2',
                    modelQ.data.using_base_model ? 'bg-gray-800 border-gray-700' : 'bg-purple-950/30 border-purple-700/50')}>
                    <div className="flex items-center gap-2">
                      <Cpu className={cn('h-4 w-4', modelQ.data.using_base_model ? 'text-gray-400' : 'text-purple-400')} />
                      <span className="text-sm font-semibold text-white">Active Model</span>
                    </div>
                    {modelQ.data.using_base_model ? (
                      <div>
                        <p className="text-xs text-gray-400">{modelQ.data.base_model ?? 'Histogram cosine (demo)'}</p>
                        <p className="text-[10px] text-gray-600 mt-1">
                          Run a training session to activate a fine-tuned model.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs text-purple-300 font-medium">{modelQ.data.session}</p>
                        <p className="text-[10px] text-gray-400">Trained: {modelQ.data.trained_at ? fmtTs(modelQ.data.trained_at) : '—'}</p>
                        {modelQ.data.metrics && (
                          <div className="flex gap-3 mt-1">
                            <span className="text-[10px] text-green-400">mAP50: {modelQ.data.metrics.mAP50 != null ? `${(modelQ.data.metrics.mAP50 * 100).toFixed(1)}%` : '—'}</span>
                            <span className="text-[10px] text-blue-400">Prec: {modelQ.data.metrics.precision != null ? `${(modelQ.data.metrics.precision * 100).toFixed(1)}%` : '—'}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Algorithm Benchmark Panel ── */}
                <AlgoBenchmarkPanel />

                {/* All sessions summary */}
                {sessions.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium mb-1.5">Recent Sessions</p>
                    <div className="space-y-2">
                      {sessions.slice(0, 5).map(s => (
                        <SessionCard key={s.session_id} session={s} onCancel={id => cancelMut.mutate(id)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        {/* ── Centre: dataset grid ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Filter bar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-900 flex-shrink-0">
            <Database className="h-3.5 w-3.5 text-gray-500" />
            <span className="text-xs text-gray-400 font-medium">
              {samples.length} sample{samples.length !== 1 ? 's' : ''}
              {stats?.verified != null && samples.length > 0 && (
                <span className="text-gray-600"> · {stats.verified} verified</span>
              )}
            </span>
            <select value={filterLabel} onChange={e => setFilterLabel(e.target.value)}
              className="ml-auto bg-gray-800 border border-gray-700 text-xs text-white rounded px-2 py-1 focus:outline-none">
              <option value="">All Labels</option>
              {labels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <select value={filterVerified} onChange={e => setFilterVerified(e.target.value as '' | 'true' | 'false')}
              className="bg-gray-800 border border-gray-700 text-xs text-white rounded px-2 py-1 focus:outline-none">
              <option value="">All</option>
              <option value="true">Verified</option>
              <option value="false">Unverified</option>
            </select>
            <button onClick={() => qc.invalidateQueries({ queryKey: ['training-dataset'] })}
              className="p-1 text-gray-500 hover:text-white transition-colors" title="Refresh samples">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {samples.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-4">
                <Video className="h-14 w-14 opacity-10" />
                <div className="text-center space-y-1.5">
                  <p className="text-sm text-gray-500">No samples loaded</p>
                  <p className="text-xs text-gray-700 max-w-xs">
                    Click <span className="text-gray-400 font-medium">Scan Disk</span> in the left panel to register the {statusQ.data?.hist_index_size ?? 243} images already in the training folders.
                  </p>
                </div>
                <button
                  onClick={() => setLeftTab('scan')}
                  className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-sm font-semibold rounded-lg transition-colors">
                  <HardDrive className="h-4 w-4" />Go to Scan Disk
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {samples.map(sample => (
                  <SampleCard
                    key={sample.sample_id}
                    sample={sample}
                    labels={labels}
                    onVerify={(id, label, verified) => verifyMut.mutate({ id, label, verified })}
                    onDelete={id => deleteMut.mutate(id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: sessions ── */}
        <div className="w-72 flex-shrink-0 border-l border-gray-800 flex flex-col overflow-hidden bg-gray-900/30">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2 flex-shrink-0">
            <TrendingDown className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs font-semibold text-gray-300">Training Sessions</span>
            <span className="ml-auto text-[10px] text-gray-600">{sessions.length} total</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 p-4">
                <Cpu className="h-8 w-8 opacity-20" />
                <p className="text-xs text-center">No training sessions yet.<br />Use the Train tab on the left.</p>
              </div>
            ) : (
              sessions.map(s => (
                <SessionCard key={s.session_id} session={s} onCancel={id => cancelMut.mutate(id)} />
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
