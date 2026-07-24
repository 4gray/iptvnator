import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
    ...baseConfig,
    outputDir:
        '../../dist/test-results/electron-backend-e2e/packaged-frame-copy-smoke',
    reporter: [
        ['list'],
        [
            'html',
            {
                outputFolder:
                    '../../dist/playwright-report/electron-backend-e2e/packaged-frame-copy-smoke',
            },
        ],
        [
            'json',
            {
                outputFile:
                    '../../dist/test-results/electron-backend-e2e/packaged-frame-copy-smoke/results.json',
            },
        ],
    ],
    timeout: 120000,
    webServer: [],
});
