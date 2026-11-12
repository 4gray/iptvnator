import { test } from '@playwright/test';
import {
    verifySourceSettingsRecovery,
    verifySourceConnectionRecheck,
    verifySourceReconnectAfterRestart,
} from './source-sync-settings';

test.skip(
    process.env['IPTVNATOR_E2E_SOURCE_SYNC'] !== '1',
    'Run with playwright.source-sync.config.ts'
);

test('validates source settings and retains credentials after a native connection failure @electron @settings', async () => {
    await verifySourceSettingsRecovery();
});

test('renews credentials and rechecks an existing connection without restarting Electron @electron @settings', async () => {
    await verifySourceConnectionRecheck();
});

test('reconnects to the saved server after Electron restarts @electron @settings', async () => {
    await verifySourceReconnectAfterRestart();
});
