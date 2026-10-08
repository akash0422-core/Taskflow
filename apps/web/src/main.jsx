import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui.jsx';
import './style.css';

class AppBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Taskflow render error:', error, info.componentStack); }
  render() {
    if (this.state.error) return <main className="fatal-error"><div className="brand-mark">!</div><h1>Taskflow couldn’t load.</h1><p>{this.state.error.message || 'A page error occurred.'}</p><button onClick={() => window.location.reload()}>Reload page</button></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<React.StrictMode><AppBoundary><App /></AppBoundary></React.StrictMode>);
