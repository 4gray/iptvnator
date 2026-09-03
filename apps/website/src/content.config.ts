import { glob } from 'astro/loaders';
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('4gray'),
    featured: z.boolean().default(false),
    heroImage: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    /** Rendered as an accordion after the post and emitted as FAQPage JSON-LD. */
    faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  }),
});

export const collections = { blog };
