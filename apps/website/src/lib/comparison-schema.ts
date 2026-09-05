import type { FaqEntry } from './download-schema';
import type { ComparisonEntry } from './comparisons';
import { absoluteUrl } from './site';

interface ComparisonPageSchemaInput {
  comparison: ComparisonEntry;
  pageUrl: string;
  description: string;
  faq: FaqEntry[];
}

/**
 * WebPage + FAQPage + BreadcrumbList. Deliberately not SoftwareApplication:
 * these pages are guidance about choosing between options, not a product
 * listing, and marking them up as one would misdescribe them.
 */
export function buildComparisonPageSchema(input: ComparisonPageSchemaInput): Array<Record<string, unknown>> {
  const { comparison, pageUrl, description, faq } = input;

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: comparison.label,
      description,
      url: pageUrl,
      inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', name: 'IPTVnator', url: absoluteUrl('/') },
      about: { '@type': 'SoftwareApplication', name: 'IPTVnator', applicationCategory: 'MultimediaApplication' },
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
        { '@type': 'ListItem', position: 2, name: 'Compare', item: absoluteUrl('/compare/') },
        { '@type': 'ListItem', position: 3, name: comparison.label, item: pageUrl },
      ],
    },
  ];
}
