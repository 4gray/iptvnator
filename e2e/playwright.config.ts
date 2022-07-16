import { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
    testDir: '.',
    maxFailures: 2,
};

export default config;
