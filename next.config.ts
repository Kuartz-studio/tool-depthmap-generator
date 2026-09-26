import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Cross-origin isolation lets ONNX Runtime run multithreaded WebAssembly
  // (see `self.crossOriginIsolated` in public/engine/app.js). `credentialless`
  // keeps cross-origin downloads from jsDelivr and Hugging Face working.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
};

export default nextConfig;
