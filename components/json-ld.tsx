import { faq } from '@/lib/faq';
import { site } from '@/lib/site';

// schema.org graph: the site, the web app, its publisher and the FAQ shown in the guide.
export function JsonLd() {
  const organizationId = `${site.studio.url}/#organization`;
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${site.url}/#website`,
        url: `${site.url}/`,
        name: site.name,
        inLanguage: 'fr',
        publisher: { '@id': organizationId },
      },
      {
        '@type': 'WebApplication',
        '@id': `${site.url}/#app`,
        name: site.name,
        alternateName: 'Générateur de depth map Kuartz',
        url: `${site.url}/`,
        description: site.description,
        image: `${site.url}/opengraph-image.png`,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Navigateur récent avec JavaScript ; WebGPU recommandé, WebAssembly sinon.',
        inLanguage: 'fr',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
        featureList: [
          "Depth map depuis n'importe quelle image",
          'Modèles Depth Anything V2 et Depth Anything 3',
          'Calcul 100 % local, WebGPU ou WebAssembly',
          'Export PNG 16 bits, PNG 8 bits, WebGL RG et normal map',
          'Aperçu parallaxe Relief 3D',
          'Intégration WebGL (OGL) prête à copier',
        ],
        license: 'https://opensource.org/license/mit',
        sameAs: [site.repo],
        creator: { '@id': organizationId },
        publisher: { '@id': organizationId },
      },
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: site.studio.name,
        url: site.studio.url,
        logo: `${site.url}/icon-512.png`,
      },
      {
        '@type': 'FAQPage',
        '@id': `${site.url}/#faq`,
        inLanguage: 'fr',
        mainEntity: faq.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
