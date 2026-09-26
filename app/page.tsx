import { DepthTool } from '@/components/depth-tool';
import { DepthToolEngine } from '@/components/depth-tool-engine';
import { Guide } from '@/components/guide';
import { JsonLd } from '@/components/json-ld';
import { SiteFooter } from '@/components/site-footer';

export default function Home() {
  return (
    <>
      <DepthTool />
      <Guide />
      <SiteFooter />
      <JsonLd />
      <DepthToolEngine />
    </>
  );
}
