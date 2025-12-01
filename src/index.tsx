import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './renderer/App';
import { ThemeProvider } from './renderer/components/ThemeProvider';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
