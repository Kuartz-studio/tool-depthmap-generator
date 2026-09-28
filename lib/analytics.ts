import { CONSENT_KEY } from '@/lib/consent';

// Google Tag Manager (GA4 is configured inside the container). It only loads on the
// production Vercel deployment and only when a container ID is set, so previews,
// local builds and forks stay free of analytics.
const containerId = process.env.NEXT_PUBLIC_GTM_ID;

export const gtmId =
  process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' && containerId && /^GTM-[A-Z0-9]+$/.test(containerId)
    ? containerId
    : undefined;

// Consent Mode v2 defaults, inlined in <head> before GTM: everything denied except
// functionality and security storage, then a stored acceptance is restored at once.
export const consentDefaultScript = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'granted',security_storage:'granted',wait_for_update:500});
try { if (localStorage.getItem('${CONSENT_KEY}') === 'granted') gtag('consent','update',{analytics_storage:'granted'}); } catch (e) {}`;

// Official GTM snippet.
export const gtmScript = (id: string) => `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${id}');`;
