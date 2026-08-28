import { Route, Routes } from 'react-router-dom'
import { Footer } from './layout/Footer'
import { Header } from './layout/Header'
import { About } from './pages/About'
import { Dashboard } from './pages/Dashboard'
import { StationDetail } from './pages/StationDetail'

function App() {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/stations/:id" element={<StationDetail />} />
        <Route path="/about" element={<About />} />
      </Routes>
      <Footer />
    </>
  )
}

export default App
