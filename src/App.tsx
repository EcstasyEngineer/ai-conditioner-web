import { Routes, Route, Navigate } from 'react-router-dom'
import Builder from './routes/Builder'
import Player from './routes/Player'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Builder />} />
      <Route path="/play" element={<Player />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
