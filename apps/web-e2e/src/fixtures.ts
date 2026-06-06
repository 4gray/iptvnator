import { test as base, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function safeArtifactName(value: string): string {
    return value
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
}

export const test = base.extend<{ page: Page }>({
    page: async ({ page }, use, testInfo) => {
        if (process.env['IPTVNATOR_E2E_V8_COVERAGE'] !== '1') {
            await use(page);
            return;
        }

        await page.coverage.startJSCoverage({ resetOnNavigation: false });
        await page.coverage.startCSSCoverage({ resetOnNavigation: false });

        try {
            await use(page);
        } finally {
            const [js, css] = await Promise.all([
                page.coverage.stopJSCoverage(),
                page.coverage.stopCSSCoverage(),
            ]);
            const coverageDir = path.join(testInfo.outputDir, 'v8-coverage');
            const artifactName = safeArtifactName(testInfo.titlePath.join(' '));

            await mkdir(coverageDir, { recursive: true });
            await writeFile(
                path.join(coverageDir, `${artifactName || 'test'}.json`),
                `${JSON.stringify({ css, js }, null, 4)}\n`
            );
        }
    },
});

export { expect };
