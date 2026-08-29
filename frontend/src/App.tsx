import { Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/toaster'
import { useAuthStore } from '@/store/auth'
import DashboardPage      from '@/pages/DashboardPage'
import FIRPage            from '@/pages/FIRPage'
import MapPage            from '@/pages/MapPage'
import AIAssistantPage    from '@/pages/AIAssistantPage'
import AnalyticsPage      from '@/pages/AnalyticsPage'
import ReportsPage        from '@/pages/ReportsPage'
import WantedPage         from '@/pages/WantedPage'
import ComparisonPage     from '@/pages/ComparisonPage'
import SOSPage            from '@/pages/SOSPage'
import HotspotPage        from '@/pages/HotspotPage'
import StationsPage       from '@/pages/StationsPage'
import CorrelationPage    from '@/pages/CorrelationPage'
import SchedulerPage      from '@/pages/SchedulerPage'
import CaseFilePage       from '@/pages/CaseFilePage'
import MonthlyReportPage  from '@/pages/MonthlyReportPage'
import LoginPage          from '@/pages/LoginPage'
import Layout             from '@/components/Layout'
import CCTVPage              from '@/pages/CCTVPage'
import AITrainingPage        from '@/pages/AITrainingPage'
import NotificationsPage     from '@/pages/NotificationsPage'
import IncidentHeatmapPage   from '@/pages/IncidentHeatmapPage'
import CamerasPage           from '@/pages/CamerasPage'
import FootagePage           from '@/pages/FootagePage'
import RPi5LivePage          from '@/pages/RPi5LivePage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 2,
    },
  },
})

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index                element={<DashboardPage />} />
          <Route path="fir"           element={<FIRPage />} />
          <Route path="map"           element={<MapPage />} />
          <Route path="ai"            element={<AIAssistantPage />} />
          <Route path="analytics"     element={<AnalyticsPage />} />
          <Route path="wanted"        element={<WantedPage />} />
          <Route path="comparison"    element={<ComparisonPage />} />
          <Route path="sos"           element={<SOSPage />} />
          <Route path="hotspot"       element={<HotspotPage />} />
          <Route path="stations"      element={<StationsPage />} />
          <Route path="correlation"   element={<CorrelationPage />} />
          <Route path="scheduler"     element={<SchedulerPage />} />
          <Route path="casefile"      element={<CaseFilePage />} />
          <Route path="report"        element={<MonthlyReportPage />} />
          <Route path="reports"       element={<ReportsPage />} />
          <Route path="cctv"          element={<CCTVPage />} />
          <Route path="training"      element={<AITrainingPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="heatmap"       element={<IncidentHeatmapPage />} />
          <Route path="cameras"       element={<CamerasPage />} />
          <Route path="footage"       element={<FootagePage />} />
          <Route path="rpi5"          element={<RPi5LivePage />} />
        </Route>
      </Routes>
      <Toaster />
    </QueryClientProvider>
  )
}
