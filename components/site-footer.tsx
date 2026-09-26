import { site } from '@/lib/site';

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="guide-wrap site-foot-inner">
        <p>
          Kuartz Depth est un outil open source (licence MIT) conçu par{' '}
          <a href={site.studio.url} target="_blank" rel="noopener">
            {site.studio.name}
          </a>
          .
        </p>
        <p>
          <a href={site.repo} target="_blank" rel="noopener">
            Code source sur GitHub
          </a>
          {' · '}
          <a href={`${site.repo}/issues`} target="_blank" rel="noopener">
            Signaler un bug
          </a>
        </p>
      </div>
    </footer>
  );
}
