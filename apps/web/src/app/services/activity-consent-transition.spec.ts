import { signal } from '@angular/core';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import type { ActivitySyncClient } from '@iptvnator/services/activity-sync';

const request = jest.fn();
jest.unstable_mockModule('@iptvnator/services/source-sync', () => ({
    requestSourceServer: request,
}));
const { changeActivityConsent } = await import('./activity-consent-transition');
const key = 'iptvnator-server:synthetic-nas:activity-consent-v1';
const original = {
    enabled: false,
    generation: 'synthetic-original',
    deviceId: 'synthetic-device',
};

function controls() {
    return {
        enabled: signal(false),
        busy: signal(false),
        error: signal(false),
        state: signal('disabled'),
        supportsStorage: true,
        instanceId: 'synthetic-nas',
        refreshSources: jest.fn(async () => undefined),
        client: () =>
            ({
                stopDelivery: async () => undefined,
            }) as unknown as ActivitySyncClient,
        mirror: jest.fn(async () => undefined),
        pause: jest.fn(),
        stopTimer: jest.fn(),
    };
}
describe('activity consent transition ownership', () => {
    beforeEach(async () => {
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify({
                apiUrl: 'http://synthetic.invalid/api',
                instanceId: 'synthetic-nas',
            })
        );
        await prepareSourceConnection();
        localStorage.setItem(key, JSON.stringify(original));
        request
            .mockReset()
            .mockResolvedValue({
                status: 200,
                body: { capabilities: ['activity-v1'] },
            });
    });
    afterEach(async () => {
        localStorage.clear();
        await prepareSourceConnection();
    });
    it('does not overwrite another window’s later disable while enabling', async () => {
        const state = controls();
        const later = {
            ...original,
            enabled: 2,
            generation: 'synthetic-later',
        };
        request.mockImplementationOnce(async () => {
            localStorage.setItem(key, JSON.stringify(later));
            return { status: 200, body: { capabilities: ['activity-v1'] } };
        });
        await changeActivityConsent(state, true);
        expect(state.error()).toBe(true);
        expect(JSON.parse(localStorage.getItem(key)!)).toEqual(later);
    });
    it('leaves the old profile retryable if the connection changes during copying', async () => {
        localStorage.setItem(
            key,
            JSON.stringify({ ...original, enabled: true })
        );
        const state = controls();
        state.enabled.set(true);
        state.mirror.mockImplementationOnce(async () => {
            localStorage.setItem(
                'iptvnator:source-server',
                JSON.stringify({
                    apiUrl: 'http://other-synthetic.invalid/api',
                    instanceId: 'other-nas',
                })
            );
            await prepareSourceConnection();
        });
        await changeActivityConsent(state, false);
        expect(state.error()).toBe(true);
        expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
            enabled: 2,
            generation: original.generation,
        });
        expect(
            localStorage.getItem(
                'iptvnator-server:other-nas:activity-consent-v1'
            )
        ).toBeNull();
        expect(request).not.toHaveBeenCalled();
    });
});
