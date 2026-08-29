import { lazy, Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
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
  // The map page fills the viewport exactly -- Header takes its natural
  // height, the routed content becomes the remaining flex space, and
  // nothing at the page level scrolls (the map fills that space; the
  // sidebar scrolls internally if its content is taller than that, see
  // MapView.tsx). No footer here either, same reasoning most map apps
  // (Google Maps included) don't have one on the map screen itself --
  // every other route keeps the normal document-flow scrolling page +
  // footer layout, unaffected.
  const isMapRoute = useLocation().pathname === '/'

  return (
    <div className={isMapRoute ? 'flex h-dvh flex-col overflow-hidden' : undefined}>
      <Header />
      <div className={isMapRoute ? 'min-h-0 flex-1' : undefined}>
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
      </div>
      {!isMapRoute && <Footer />}
    </div>
  )
}

export default App
