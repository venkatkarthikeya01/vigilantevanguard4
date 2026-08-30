/**
 * cctvApi.ts — Typed API wrappers for the CCTV + Training modules
 */
import { apiClient } from '@/lib/api'
import type { CCTVIncident, CCTVCamera, PoliceStation } from '@/store/cctv'
export type { CCTVCamera }

const BASE = '/cctv'

// ── Cameras ────────────────────────────────────────────────────

export async function fetchCameras(): Promise<CCTVCamera[]> {
  const r = await apiClient.get<{ cameras: CCTVCamera[] }>(`${BASE}/cameras`)
  return r.data.cameras
}

export async function fetchCamera(cameraId: string): Promise<CCTVCamera> {
  const r = await apiClient.get<CCTVCamera>(`${BASE}/cameras/${cameraId}`)
  return r.data
}

export async function registerCamera(data: Partial<CCTVCamera>): Promise<CCTVCamera> {
  const r = await apiClient.post<{ camera: CCTVCamera }>(`${BASE}/cameras`, data)
  return r.data.camera
}

// ── Incidents ──────────────────────────────────────────────────

export interface IncidentsResponse {
  incidents: CCTVIncident[]
  total:     number
  pending:   number
}

export async function fetchIncidents(params?: {
  status?:        string
  incident_type?: string
  camera_id?:     string
  limit?:         number
  offset?:        number
}): Promise<IncidentsResponse> {
  const r = await apiClient.get<IncidentsResponse>(`${BASE}/incidents`, { params })
  return r.data
}

export async function fetchIncident(incidentId: string): Promise<CCTVIncident> {
  const r = await apiClient.get<CCTVIncident>(`${BASE}/incidents/${incidentId}`)
  return r.data
}

export async function updateIncident(
  incidentId: string,
  action: 'CONFIRM' | 'FALSE_ALARM' | 'DISPATCH',
  notes?: string
): Promise<{ incident: CCTVIncident; message: string }> {
  const r = await apiClient.patch<{ incident: CCTVIncident; message: string }>(
    `${BASE}/incidents/${incidentId}`,
    { action, notes }
  )
  return r.data
}

// ── Stations ───────────────────────────────────────────────────

export async function fetchStations(): Promise<PoliceStation[]> {
  const r = await apiClient.get<{ stations: PoliceStation[] }>(`${BASE}/stations`)
  return r.data.stations
}

export async function fetchNearestStation(
  lat: number, lng: number
): Promise<PoliceStation> {
  const r = await apiClient.get<PoliceStation>(`${BASE}/stations/nearest`, {
    params: { lat, lng },
  })
  return r.data
}

// ── Frame analysis ─────────────────────────────────────────────

export async function analyseFrame(
  cameraId: string,
  frameB64: string
): Promise<{ detected: boolean; incident?: CCTVIncident }> {
  const r = await apiClient.post(`${BASE}/analyse-frame`, {
    camera_id: cameraId,
    frame_b64: frameB64,
  })
  return r.data
}

// ── Video upload ───────────────────────────────────────────────

export async function uploadVideo(
  file: File,
  cameraId = 'CAM-UPLOAD',
  onProgress?: (pct: number) => void
): Promise<{ incident: CCTVIncident; message: string }> {
  const form = new FormData()
  form.append('file', file)
  form.append('camera_id', cameraId)
  const r = await apiClient.post(`${BASE}/upload-video`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded * 100) / e.total))
      }
    },
  })
  return r.data
}

// ── IP Camera proxy ────────────────────────────────────────────

export interface GrabFrameResult {
  detected:     boolean
  snapshot:     string               // base64 JPEG data URL
  snapshot_url: string
  frame_bytes:  number
  cooldown?:    boolean              // true when incident type is on cooldown
  incident?:    CCTVIncident
}

export async function grabIPCamFrame(
  streamUrl: string,
  cameraId  = 'CAM-IPCAM',
  timeout   = 5.0,
  username?: string,
  password?: string,
): Promise<GrabFrameResult> {
  const r = await apiClient.post<GrabFrameResult>(`${BASE}/ipcam/grab-frame`, {
    stream_url: streamUrl,
    camera_id:  cameraId,
    timeout,
    ...(username ? { username, password } : {}),
  })
  return r.data
}

export interface GrabFramesBatchResult extends GrabFrameResult {
  scan_stats?: { frames_scanned: number; frames_clean: number; frames_incident: number }
}

export async function grabIPCamFramesBatch(
  streamUrl: string,
  cameraId  = 'CAM-IPCAM',
  maxFrames = 4,
  username?: string,
  password?: string,
): Promise<GrabFramesBatchResult> {
  const r = await apiClient.post<GrabFramesBatchResult>(`${BASE}/ipcam/grab-frames-batch`, {
    stream_url: streamUrl,
    camera_id:  cameraId,
    max_frames: maxFrames,
    ...(username ? { username, password } : {}),
  })
  return r.data
}

/** URL that the browser can load as <img src="…"> — single JPEG proxied through backend */
export function proxyFrameUrl(streamUrl: string, username?: string, password?: string): string {
  const base = import.meta.env.VITE_API_URL || '/api/v1'
  const auth = username ? `&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password ?? '')}` : ''
  return `${base}/cctv/ipcam/proxy-frame?url=${encodeURIComponent(streamUrl)}&t=${Date.now()}${auth}`
}

/**
 * URL for the continuous MJPEG stream — point an <img src="…"> here.
 * The backend proxies the phone's MJPEG feed with Basic Auth so the browser
 * sees a smooth, continuous video without any polling or flicker.
 */
export function mjpegStreamUrl(streamUrl: string, username?: string, password?: string): string {
  const base = import.meta.env.VITE_API_URL || '/api/v1'
  const auth = username ? `&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password ?? '')}` : ''
  return `${base}/cctv/ipcam/mjpeg-stream?url=${encodeURIComponent(streamUrl)}${auth}`
}

// ── Analytics ──────────────────────────────────────────────────

export interface CCTVAnalytics {
  total_incidents: number
  by_type:         Record<string, number>
  by_status:       Record<string, number>
  by_camera:       Record<string, number>
  by_severity:     Record<string, number>
  avg_confidence:  number
  ws_connected:    number
}

export async function fetchCCTVAnalytics(): Promise<CCTVAnalytics> {
  const r = await apiClient.get<CCTVAnalytics>(`${BASE}/analytics`)
  return r.data
}

// ── Notifications ──────────────────────────────────────────────

export interface PoliceNotification {
  notification_id:    string
  incident_id:        string
  incident_type:      string
  severity_level:     'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  severity_score:     number
  severity_colour:    string
  severity_desc:      string
  response_eta:       number
  title:              string
  message:            string
  location: {
    address:    string
    district:   string
    zone:       string
    lat:        number
    lng:        number
    maps_url:   string
    maps_embed: string
    what3words: string
  }
  assigned_station:    string
  assigned_station_id: number | null
  camera_id:           string
  camera_name:         string
  confidence:          number
  snapshot:            string
  timestamp:           string
  read:                boolean
  acknowledged_by:     string | null
  acknowledged_at:     string | null
}

export interface NotificationSummary {
  total:           number
  unread:          number
  by_severity:     Record<string, number>
  critical_unread: number
}

export async function fetchNotifications(params?: {
  unread_only?: boolean
  severity?:    string
  limit?:       number
}): Promise<{ notifications: PoliceNotification[]; total: number; unread: number }> {
  const r = await apiClient.get(`${BASE}/notifications`, { params })
  return r.data
}

export async function fetchNotificationSummary(): Promise<NotificationSummary> {
  const r = await apiClient.get<NotificationSummary>(`${BASE}/notifications/summary`)
  return r.data
}

export async function markNotificationRead(
  id: string, officer?: string
): Promise<{ notification: PoliceNotification }> {
  const r = await apiClient.post(`${BASE}/notifications/${id}/read`, { officer })
  return r.data
}

export async function markAllNotificationsRead(officer?: string) {
  const r = await apiClient.post(`${BASE}/notifications/read-all`, { officer })
  return r.data
}

// ── Training ───────────────────────────────────────────────────

export interface TrainingSample {
  sample_id:          string
  label:              string
  filename:           string
  file_type:          'image' | 'video'
  file_ext:           string
  file_size_kb:       number
  camera_id:          string
  notes:              string
  thumbnail:          string
  verified:           boolean
  used_in_training:   boolean
  uploaded_at:        string
  verified_at?:       string
}

export interface TrainingSession {
  session_id:       string
  model_base:       string
  epochs:           number
  description:      string
  dataset_size:     number
  status:           'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  progress_pct:     number
  current_epoch:    number
  metrics_history:  Array<{
    epoch: number; loss: number; mAP50: number;
    mAP95: number; precision: number; recall: number;
  }>
  latest_metrics:   Record<string, number>
  final_metrics:    Record<string, number>
  model_path:       string | null
  created_at:       string
  started_at:       string | null
  completed_at:     string | null
  error:            string | null
}

export interface DatasetStats {
  total:                number
  verified:             number
  unverified:           number
  by_label:             Record<string, number>
  ready_for_training:   boolean
  recommended_minimum:  number
}

export async function fetchTrainingLabels(): Promise<{ labels: string[] }> {
  const r = await apiClient.get('/training/labels')
  return r.data
}

export async function fetchTrainingDataset(params?: {
  label?: string; verified?: boolean
}): Promise<{ samples: TrainingSample[]; total: number; stats: DatasetStats }> {
  const r = await apiClient.get('/training/dataset', { params })
  return r.data
}

export async function fetchDatasetStats(): Promise<DatasetStats> {
  const r = await apiClient.get<DatasetStats>('/training/dataset/stats')
  return r.data
}

export async function uploadTrainingSample(
  file: File,
  label: string,
  notes = '',
  cameraId = 'CAM-TRAINING',
  onProgress?: (pct: number) => void,
): Promise<{ sample: TrainingSample; dataset_stats: DatasetStats }> {
  const form = new FormData()
  form.append('file', file)
  form.append('label', label)
  form.append('notes', notes)
  form.append('camera_id', cameraId)
  const r = await apiClient.post('/training/dataset/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total))
    },
  })
  return r.data
}

export interface BatchUploadResult {
  message:       string
  total:         number
  succeeded:     number
  failed:        number
  results:       { filename: string; ok: boolean; sample_id?: string; file_type?: string; indexed?: boolean; error?: string }[]
  dataset_stats: DatasetStats
}

export async function uploadTrainingSampleBatch(
  files: File[],
  label: string,
  notes = '',
  cameraId = 'CAM-TRAINING',
  onProgress?: (pct: number) => void,
): Promise<BatchUploadResult> {
  const form = new FormData()
  files.forEach(f => form.append('files', f))
  form.append('label', label)
  form.append('notes', notes)
  form.append('camera_id', cameraId)
  const r = await apiClient.post<BatchUploadResult>('/training/dataset/upload-batch', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total))
    },
  })
  return r.data
}

export async function scanDisk(label?: string): Promise<{
  message:       string
  scanned:       number
  registered:    number
  skipped:       number
  errors:        number
  new_samples:   { filename: string; label: string; sample_id: string }[]
  dataset_stats: DatasetStats
  storage_dir:   string
  folder_map:    Record<string, string>
}> {
  // label is a query param on the backend, not a body field
  const r = await apiClient.post('/training/dataset/scan-disk', null, {
    params: label ? { label } : undefined,
  })
  return r.data
}

export async function verifySample(
  sampleId: string,
  label: string,
  verified = true,
  notes?: string,
): Promise<{ sample: TrainingSample; dataset_stats: DatasetStats }> {
  const r = await apiClient.patch(`/training/dataset/${sampleId}/verify`, {
    label, verified, notes,
  })
  return r.data
}

export async function deleteSample(sampleId: string): Promise<{ dataset_stats: DatasetStats }> {
  const r = await apiClient.delete(`/training/dataset/${sampleId}`)
  return r.data
}

export async function fetchTrainingSessions(): Promise<{ sessions: TrainingSession[] }> {
  const r = await apiClient.get('/training/sessions')
  return r.data
}

export async function fetchTrainingSession(id: string): Promise<TrainingSession> {
  const r = await apiClient.get<TrainingSession>(`/training/sessions/${id}`)
  return r.data
}

export async function startTraining(params: {
  epochs?: number
  model_base?: string
  description?: string
  use_verified_only?: boolean
}): Promise<{ session: TrainingSession; message: string }> {
  const r = await apiClient.post('/training/sessions/start', params)
  return r.data
}

export async function cancelTraining(id: string) {
  const r = await apiClient.post(`/training/sessions/${id}/cancel`, {})
  return r.data
}

export async function fetchCurrentModel(): Promise<{
  model: string | null
  session?: string
  trained_at?: string
  metrics?: Record<string, number>
  using_base_model: boolean
  base_model?: string
}> {
  const r = await apiClient.get('/training/model/current')
  return r.data
}

// ── Video frame extraction ──────────────────────────────────────

export interface VideoExtractResult {
  message:       string
  extracted:     number
  indexed:       number
  skipped:       number
  label:         string
  fps_requested: number
  max_frames:    number
  dataset_stats: DatasetStats
}

export async function extractVideoFrames(
  file:      File,
  label:     string,
  fps        = 1.0,
  maxFrames  = 300,
  cameraId   = 'CAM-VIDEO',
  notes      = '',
  onProgress?: (pct: number) => void,
): Promise<VideoExtractResult> {
  const form = new FormData()
  form.append('file',       file)
  form.append('label',      label)
  form.append('fps',        String(fps))
  form.append('max_frames', String(maxFrames))
  form.append('camera_id',  cameraId)
  form.append('notes',      notes)
  const r = await apiClient.post<VideoExtractResult>(
    '/training/dataset/extract-video-frames', form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total))
      },
    },
  )
  return r.data
}

// ── DBSCAN clusters ────────────────────────────────────────────

export interface GeoCluster {
  cluster_id:     number
  centroid_lat:   number
  centroid_lng:   number
  count:          number
  critical_count: number
  dominant_type:  string
  type_breakdown: Record<string, number>
  risk_score:     number
  maps_url:       string
}

export async function fetchGeoClusters(params?: {
  eps_km?: number; min_samples?: number
}): Promise<{ clusters: GeoCluster[]; noise_count: number; total: number; params: any }> {
  const r = await apiClient.get(`${BASE}/analytics/clusters`, { params })
  return r.data
}

// ── Patrol schedule ────────────────────────────────────────────

export interface PatrolShift {
  shift:             string
  hours:             string
  total_incidents:   number
  share_pct:         number
  peak_hour:         number
  dominant_type:     string
  intensity:         'HIGH' | 'MEDIUM' | 'LOW'
  recommended_units: number
  by_day: {
    day:               string
    incident_count:    number
    patrol_intensity:  'HIGH' | 'MEDIUM' | 'LOW'
    recommended_units: number
  }[]
}

export async function fetchPatrolSchedule(): Promise<{
  schedule:        PatrolShift[]
  hourly_dist:     { hour: number; count: number }[]
  daily_dist:      { day: string;  count: number }[]
  total_incidents: number
  generated_at:    string
}> {
  const r = await apiClient.get(`${BASE}/analytics/patrol-schedule`)
  return r.data
}

// ── SMS / WhatsApp alerts ──────────────────────────────────────

export async function sendIncidentAlert(
  incidentId: string,
  phone:      string,
  channel:    'SMS' | 'WHATSAPP' = 'SMS',
): Promise<{ message: string; sent_via: string; channel: string; ok: boolean }> {
  const r = await apiClient.post(`${BASE}/incidents/${incidentId}/send-alert`, {
    incident_id: incidentId, phone, channel,
  })
  return r.data
}

export async function fetchSmsLog(limit = 50): Promise<{
  log:   { incident_id: string; phone: string; channel: string; message: string; sent_at: string; ok: boolean }[]
  total: number
}> {
  const r = await apiClient.get(`${BASE}/alerts/sms-log`, { params: { limit } })
  return r.data
}

// ── Auto-retrain status ────────────────────────────────────────

export async function fetchAutoRetrainStatus(): Promise<{
  log:     { triggered_at: string; feedback_count: number; n_samples?: number; best_algorithm?: string; ok: boolean; error?: string }[]
  running: boolean
  total:   number
}> {
  const r = await apiClient.get(`${BASE}/analytics/auto-retrain-status`)
  return r.data
}

export async function triggerRetrainNow(): Promise<{ message: string; result: any }> {
  const r = await apiClient.post(`${BASE}/analytics/retrain-now`, {})
  return r.data
}

// ── YOLO model upload ──────────────────────────────────────────────

export async function uploadYoloModel(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ message: string; model_path: string; yolo_ready: boolean; model_info: any }> {
  const form = new FormData()
  form.append('file', file)
  const r = await apiClient.post('/training/model/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total))
    },
  })
  return r.data
}

// ── Stratus sync (restore training data after redeploy) ────────────

export async function stratusSync(): Promise<{
  message: string
  synced: number
  skipped: number
  errors: number
  model_synced: boolean
  new_samples: string[]
  dataset_stats: any
}> {
  const r = await apiClient.post('/training/stratus/sync', {})
  return r.data
}

// ── Accident model (27-class) ──────────────────────────────────────────────

export async function fetchAccidentLabels(): Promise<{
  labels: string[]
  n_classes: number
  image_counts: Record<string, number>
  total_images: number
}> {
  const r = await apiClient.get('/training/accident-labels')
  return r.data
}

export async function fetchAccidentStatus(): Promise<{
  n_classes: number
  total_images: number
  images_by_class: Record<string, number>
  retrain_pending: boolean
  retrain_queued: number
  stratus_bucket: string
  stratus_prefix: string
  ready_for_training: boolean
  recommended_min_per_class: number
}> {
  const r = await apiClient.get('/training/accident/status')
  return r.data
}

export async function fetchAccidentDataset(label?: string): Promise<{
  images: Array<{ class_name: string; filename: string; file_size_kb: number; uploaded_at: string; stratus_path: string }>
  total: number
  by_class: Record<string, number>
}> {
  const r = await apiClient.get('/training/accident/dataset', { params: label ? { label } : undefined })
  return r.data
}

export async function uploadAccidentImages(
  files: File[],
  label: string,
  onProgress?: (pct: number) => void,
): Promise<{ saved: number; errors: string[]; label: string }> {
  const fd = new FormData()
  fd.append('label', label)
  files.forEach(f => fd.append('files', f))
  const r = await apiClient.post('/training/accident/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => {
      if (onProgress && e.total) onProgress(Math.round(e.loaded / e.total * 100))
    },
  })
  return r.data
}
