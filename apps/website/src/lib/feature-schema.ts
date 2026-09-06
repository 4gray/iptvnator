import type { FaqEntry } from './download-schema';
import { REPO_URL } from './downloads';
import type { FeatureEntry } from './features';
import { FEATURES_HUB_HREF } from './features';
import { absoluteUrl } from './site';

interface FeaturePageSchemaInput {
  feature: FeatureEntry;
  pageUrl: string;
  description: string;
  /** Plain-language feature statements for schema.org `featureList`. */
  featureList: string[];
  faq: FaqEntry[];
}

/** SoftwareApplication (with featureList) + FAQPage + BreadcrumbList for one feature page. */
export function buildFeaturePageSchema(input: FeaturePageSchemaInput): Array<Record<string, unknown>> {
  const { feature, pageUrl, description, featureList, faq } = input;

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'IPTVnator',
      applicationCategory: 'MultimediaApplication',
      applicationSubCategory: 'IPTV player',
      operatingSystem: 'Windows, macOS, Linux',
      url: pageUrl,
      downloadUrl: absoluteUrl('/download/'),
      featureList,
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
        { '@type': 'ListItem', position: 2, name: 'Features', item: absoluteUrl(FEATURES_HUB_HREF.replace('/iptvnator', '')) },
        { '@type': 'ListItem', position: 3, name: feature.label, item: pageUrl },
      ],
    },
  ];
}
