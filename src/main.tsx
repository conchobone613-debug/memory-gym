import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { seedIfEmpty } from './db/db';
import { startAutoSync } from './sync/auto';
import './pwa';

seedIfEmpty()
  .catch((e) => console.error('seed failed', e))
  .finally(() => {
    startAutoSync();
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
