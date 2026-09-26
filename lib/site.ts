// Public URL of the production site, used for canonical, sitemap and Open Graph URLs.
// Set NEXT_PUBLIC_SITE_URL for a custom domain; on Vercel the production domain is
// picked up automatically at build time.
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const site = {
  name: 'Kuartz Depth',
  url:
    process.env.NEXT_PUBLIC_SITE_URL ||
    (productionHost ? `https://${productionHost}` : 'http://localhost:3000'),
  title: 'Générateur de depth map en ligne, gratuit — Kuartz Depth',
  description:
    "Crée une depth map depuis n'importe quelle photo, gratuitement et sans upload : l'IA Depth Anything tourne dans ton navigateur. Export PNG 16 bits et normal map.",
  locale: 'fr_FR',
  repo: 'https://github.com/Kuartz-studio/tool-depthmap-generator',
  studio: { name: 'Kuartz Studio', url: 'https://kuartz.studio' },
} as const;
