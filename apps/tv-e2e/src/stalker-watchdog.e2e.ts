import { expect, test } from '@playwright/test';
import { addSource, backend, start } from './helpers';
import { playLive } from './live-media';

test('Stalker activates Live session before resolving the native media source', async ({
    page,
}) => {
    await start(page);
    const actions: string[] = [];
    let initialized = false;
    await page.route(`${backend}/stalker?**`, async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (params.get('action') === 'get_events') {
            expect(params.get('type')).toBe('watchdog');
            expect(params.get('event_active_id')).toBe('0');
            expect(params.get('cur_play_type')).toBe('0');
            expect(params.get('init')).toBe(initialized ? '0' : '1');
            actions.push('watchdog');
            await new Promise((resolve) => setTimeout(resolve, 150));
            initialized = true;
            return route.fulfill({ json: { payload: { js: {} } } });
        }
        if (
            params.get('action') === 'create_link' &&
            params.get('type') === 'itv'
        ) {
            expect(initialized).toBe(true);
            actions.push('link');
        }
        await route.continue();
    });
    await addSource(page, 'stalker');
    const video = await playLive(page);
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(0);
    expect(actions.slice(0, 2)).toEqual(['watchdog', 'link']);
});
