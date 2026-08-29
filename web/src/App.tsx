import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Footer } from './layout/Footer'
import { Header } from './layout/Header'
import { About } from './pages/About'
import { Analytics } from './pages/Analytics'
import { Dashboard } from './pages/Dashboard'
import { StationDetail } from './pages/StationDetail'

// maplibre-gl alone is ~800KB before gzip -- lazy so every other page (the
// vast majority of routes) doesn't pay for it in their initial bundle.
const MapView = lazy(() => import('./pages/MapView').then((m) => ({ default: m.MapView })))

function App() {
  return (
    <>
      <Header />
      <Routes>
        <Route
          path="/"
          element={
            <Suspense fallback={<div className="px-6 py-12 text-sm text-muted">Loading map...</div>}>
              <MapView />
            </Suspense>
          }
        />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/stations" element={<Dashboard />} />
        <Route path="/stations/:id" element={<StationDetail />} />
        <Route path="/about" element={<About />} />
      </Routes>
      <Footer />
    </>
  )
}

export default App
