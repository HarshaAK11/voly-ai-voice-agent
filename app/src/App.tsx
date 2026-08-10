import {  BrowserRouter as Router, Route, Routes } from 'react-router-dom'
import STT from './pages/VoiceResponse'
import { InterruptExample } from './components/InterruptExample'
import { AdvancedInterruptTest } from './components/AdvancedInterruptTest'
import { EnhancedInterruptDemo } from './components/EnhancedInterruptDemo'
import { InterruptionUsageExample } from './components/InterruptionUsageExample'
import { PerformanceDashboard } from './components/PerformanceDashboard'
import { PCMDebugTest } from './components/PCMDebugTest'
import { Navigation } from './components/Navigation'

const App = () => {
  return (
    <>
      <Router>
        <Navigation />
        <Routes>
          <Route path="/" element={<STT mode="public" />} />
          <Route path="/stt" element={<STT />} />
          <Route path="/interrupt-test" element={<InterruptExample />} />
          <Route path="/advanced-test" element={<AdvancedInterruptTest />} />
          <Route path="/enhanced-interrupt" element={<EnhancedInterruptDemo />} />
          <Route path="/usage-examples" element={<InterruptionUsageExample />} />
          <Route path="/performance" element={<PerformanceDashboard />} />
          <Route path="/debug" element={<PCMDebugTest />} />
        </Routes>
      </Router>
    </>
  )
}

export default App
