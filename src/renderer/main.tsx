import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Before the first paint, not in an effect: the persisted theme travelled in with the
// window, so a dark booth never sees a frame of the light UI.
document.documentElement.setAttribute('data-theme', window.api?.initialTheme ?? 'light');

const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');
createRoot(container).render(<App />);
