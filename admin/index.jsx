import React from 'react';
import { createRoot } from 'react-dom/client';
import { OneTimeCode } from './components/OneTimeCode';
import './components/OneTimeCode.css';

const host = document.getElementById('one-time-code');
if (host && !document.getElementById('pin-gate-overlay').classList.contains('hidden')) {
  createRoot(host).render(
    <OneTimeCode length={8} initialValue={host.querySelector('input')?.value || ''} verify={window.jmVerifyAdminPin} onVerified={window.jmUnlockAdmin} />
  );
}
