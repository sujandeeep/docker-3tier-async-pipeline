// Intercept browser console.log and console.error to sync with the gateway
const originalLog = console.log;
const originalError = console.error;

let isSendingLog = false;
const sendLogToGateway = (level, args) => {
  if (isSendingLog) return;
  isSendingLog = true;

  const message = args.map(arg => {
    try {
      return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
    } catch (e) {
      return String(arg);
    }
  }).join(' ');

  fetch(`http://${window.location.hostname}:3001/api/v1/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, message })
  })
  .catch(() => {})
  .finally(() => {
    isSendingLog = false;
  });
};

console.log = function(...args) {
  if (process.env.REACT_APP_SHOW_CONSOLE_LOGS !== 'false') {
    originalLog.apply(console, args);
  }
  if (process.env.REACT_APP_ENABLE_LOGS_SYNC !== 'false') {
    sendLogToGateway('info', args);
  }
};

console.error = function(...args) {
  if (process.env.REACT_APP_SHOW_CONSOLE_LOGS !== 'false') {
    originalError.apply(console, args);
  }
  if (process.env.REACT_APP_ENABLE_LOGS_SYNC !== 'false') {
    sendLogToGateway('error', args);
  }
};

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
