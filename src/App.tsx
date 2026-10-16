import { useEffect } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { startBackend, useStore } from './store'
import AuthGate from './pages/Login'
import Home from './pages/Home'
import CampaignNew from './pages/CampaignNew'
import CampaignDetail from './pages/CampaignDetail'
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
          <Route path="/" element={<Home />} />
          <Route path="/new" element={<CampaignNew />} />
          <Route path="/lists/:id" element={<CampaignDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Layout>
    </HashRouter>
  )
}
