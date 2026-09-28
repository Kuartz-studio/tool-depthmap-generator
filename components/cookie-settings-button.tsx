'use client';

import { CONSENT_OPEN_EVENT } from '@/lib/consent';

// Footer entry point to review or withdraw the analytics choice.
export function CookieSettingsButton() {
  return (
    <button type="button" className="foot-link" onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}>
      Cookies
    </button>
  );
}
