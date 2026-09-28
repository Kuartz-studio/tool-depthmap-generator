'use client';

import { useEffect, useRef, useState } from 'react';
import { CONSENT_KEY, CONSENT_OPEN_EVENT } from '@/lib/consent';

type Choice = 'granted' | 'denied';

function readChoice() {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function saveChoice(choice: Choice | null) {
  try {
    if (choice) localStorage.setItem(CONSENT_KEY, choice);
    else localStorage.removeItem(CONSENT_KEY);
  } catch {}
}

function updateAnalyticsConsent(state: Choice) {
  const { gtag } = window as Window & { gtag?: (...args: unknown[]) => void };
  gtag?.('consent', 'update', { analytics_storage: state });
}

// Google Analytics consent. Shown until the visitor picks an option; the footer
// "Cookies" link clears the choice and shows it again. Ad signals stay denied.
export function CookieBanner() {
  const [open, setOpen] = useState(false);
  const wasGranted = useRef(false);

  useEffect(() => {
    if (!readChoice()) setOpen(true);
    const reopen = () => {
      wasGranted.current = readChoice() === 'granted';
      saveChoice(null);
      setOpen(true);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  if (!open) return null;

  const accept = () => {
    saveChoice('granted');
    updateAnalyticsConsent('granted');
    setOpen(false);
  };

  const refuse = () => {
    saveChoice('denied');
    // Withdrawing an earlier acceptance has to take effect right away.
    if (wasGranted.current) updateAnalyticsConsent('denied');
    setOpen(false);
  };

  return (
    <div className="cookie-banner" role="region" aria-label="Cookies">
      <p>On utilise Google Analytics pour mesurer l'audience de l'outil. Aucun usage publicitaire.</p>
      <div className="cookie-actions">
        <button type="button" className="btn small" onClick={accept}>
          Accepter
        </button>
        <button type="button" className="btn small" onClick={refuse}>
          Refuser
        </button>
      </div>
    </div>
  );
}
