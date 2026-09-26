'use client';

import Script from 'next/script';
import { useState } from 'react';

// Starts the vanilla engine once React has hydrated <DepthTool />.
// core.js defines window.KDCore, which app.js reads on startup, so it loads first.
export function DepthToolEngine() {
  const [coreReady, setCoreReady] = useState(false);

  return (
    <>
      <Script src="/engine/core.js" strategy="afterInteractive" onReady={() => setCoreReady(true)} />
      {coreReady && <Script src="/engine/app.js" strategy="afterInteractive" />}
    </>
  );
}
