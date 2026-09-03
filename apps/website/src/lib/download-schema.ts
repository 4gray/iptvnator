import { LATEST_RELEASE_URL, REPO_URL, formatAssetSize } from './downloads';
import type { ResolvedDownload, ResolvedRelease } from './downloads';
import { PLATFORM_LABELS } from './platforms';
import type { DownloadPlatform } from './platforms';
import { absoluteUrl } from './site';

export interface FaqEntry {
  q: string;
  a: string;
}

interface DownloadPageSchemaInput {
  platform: DownloadPlatform;
  /** schema.org `operatingSystem` text, e.g. "Windows 10, Windows 11". */
  operatingSystem: string;
  pageUrl: string;
  description: string;
  release: ResolvedRelease;
  downloads: ResolvedDownload[];
  faq: FaqEntry[];
}

/** SoftwareApplication + FAQPage + BreadcrumbList for one per-OS download page. */
export function buildDownloadPageSchema(input: DownloadPageSchemaInput): Array<Record<string, unknown>> {
  const { platform, operatingSystem, pageUrl, description, release, downloads, faq } = input;
  const primary = downloads[0];
  const fileSize = primary ? formatAssetSize(primary.size) : null;

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'IPTVnator',
      applicationCategory: 'MultimediaApplication',
      applicationSubCategory: 'IPTV player',
      operatingSystem,
      softwareVersion: release.version,
      ...(release.publishedAt ? { datePublished: release.publishedAt.toISOString().slice(0, 10) } : {}),
      url: pageUrl,
      downloadUrl: primary?.url ?? LATEST_RELEASE_URL,
      ...(fileSize ? { fileSize } : {}),
      isAccessibleForFree: true,
      license: `${REPO_URL}/blob/master/LICENSE`,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author: { '@type': 'Person', name: '4gray', url: 'https://github.com/4gray' },
      sameAs: [REPO_URL, 'https://t.me/iptvnator'],
      description,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((entry) => ({
        '@type': 'Question',
        name: entry.q,
        acceptedAnswer: { '@type': 'Answer', text: entry.a },
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'IPTVnator', item: absoluteUrl('/') },
        { '@type': 'ListItem', position: 2, name: 'Download', item: absoluteUrl('/download/') },
        { '@type': 'ListItem', position: 3, name: PLATFORM_LABELS[platform], item: pageUrl },
      ],
    },
  ];
}
