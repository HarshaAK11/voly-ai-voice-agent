import { Link, useLocation } from 'react-router-dom'

export const Navigation = () => {
  const location = useLocation()

  // The root route is a visitor-facing demo. Keep developer tools available
  // by URL without exposing them in the public interface.
  if (location.pathname === '/') return null

  const navItems = [
    { path: '/', label: 'Chatbot' },
    { path: '/stt', label: 'Voice Response' },
    { path: '/interrupt-test', label: 'Basic Interrupt Test' },
    { path: '/advanced-test', label: 'Advanced Test' },
    { path: '/enhanced-interrupt', label: '🎵 Enhanced Interrupt Demo' },
    { path: '/usage-examples', label: '📚 Usage Examples' },
    { path: '/performance', label: 'Performance Dashboard' },
    { path: '/debug', label: 'PCM Debug' }
  ]

  return (
    <nav style={{
      padding: '10px 20px',
      background: '#f0f0f0',
      borderBottom: '1px solid #ddd',
      marginBottom: '20px'
    }}>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'grid', placeItems: 'center', width: '42px', height: '34px', borderRadius: '8px', background: '#18302f' }}>
            <img src="/voly-logo.png" alt="" style={{ width: '38px', height: '30px', objectFit: 'contain' }} />
          </span>
          <h2 style={{ margin: 0, color: '#333' }}>Voly</h2>
        </div>
        <div style={{ display: 'flex', gap: '15px' }}>
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              style={{
                textDecoration: 'none',
                padding: '8px 12px',
                borderRadius: '4px',
                background: location.pathname === item.path ? '#007bff' : 'transparent',
                color: location.pathname === item.path ? 'white' : '#007bff',
                border: '1px solid #007bff',
                fontSize: '14px',
                transition: 'all 0.2s'
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
