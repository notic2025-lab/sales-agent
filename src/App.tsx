import { useEffect } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { startBackend, useStore } from './store'
import AuthGate from './pages/Login'
import Dashboard from './pages/Dashboard'
import Inbox from './pages/Inbox'
import Campaigns from './pages/Campaigns'
import CampaignNew from './pages/CampaignNew'
import CampaignDetail from './pages/CampaignDetail'
import Reactions from './pages/Reactions'
import Reports from './pages/Reports'
import Runner from './pages/Runner'
import Settings from './pages/Settings'

export default function App() {
  useEffect(() => startBackend(), [])
  const status = useStore((s) => s.session.status)
  // 本番はログインして members に管理者として登録されている人だけが使える
  if (status !== 'demo' && status !== 'ready') return <AuthGate />
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/new" element={<CampaignNew />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/reactions" element={<Reactions />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/runner" element={<Runner />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </Layout>
    </HashRouter>
  )
}
