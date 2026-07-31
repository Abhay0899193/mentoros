import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../renderer/theme/ThemeProvider';
import App from './App';
import './reader.css';

const container = document.getElementById('root');
if (!container) throw new Error('reader: #root element not found');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);

// Offline: the service worker precaches the shell + bundle on first visit, so
// every later open works with no network at all. Failure is silent — the app
// is perfectly usable online without it.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js');
  });
}
