import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kuartz Depth · Générateur de depth map',
    short_name: site.name,
    description: site.description,
    lang: 'fr',
    start_url: '/',
    display: 'standalone',
    background_color: '#eceef1',
    theme_color: '#eceef1',
    icons: [
      { src: '/icon.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
