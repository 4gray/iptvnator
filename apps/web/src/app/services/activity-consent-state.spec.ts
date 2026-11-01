import { signal } from '@angular/core';
import type {
    RuntimeCapabilitiesService,
    PlaybackPositionRuntimeBridgeService,
} from '@iptvnator/services';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import { activityEnabled } from './activity-consent';
import {
    readActivityConsent,
    writeActivityConsent,
} from './activity-consent-state';
import { createActivityRuntimeClient } from './activity-runtime-client';
const key = 'iptvnator-server:synthetic-nas:activity-consent-v1';
const original = {
    enabled: true,
    generation: 'synthetic-consent',
    deviceId: 'synthetic-device',
};
describe('activity consent persistence', () => {
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
    });
    afterEach(async () => {
        localStorage.clear();
        await prepareSourceConnection();
    });
    it('reads historical booleans and uses a smaller durable pause value', () => {
        expect(readActivityConsent()).toMatchObject({
            enabled: true,
            disabling: false,
        });
        const size = localStorage.getItem(key)!.length;
        writeActivityConsent(key, { ...original, disabling: true });
        expect(localStorage.getItem(key)!.length).toBeLessThanOrEqual(size);
        expect(readActivityConsent()).toMatchObject({
            enabled: true,
            disabling: true,
            generation: original.generation,
        });
        expect(activityEnabled()).toBe(true);
        writeActivityConsent(key, { ...original, enabled: false });
        expect(activityEnabled()).toBe(false);
        expect(readActivityConsent()).toMatchObject({
            enabled: false,
            disabling: false,
        });
    });
    it('pauses the actual runtime client without bypassing shared reads', () => {
        const paused = signal(false);
        const makeClient = () =>
            createActivityRuntimeClient(
                {
                    supportsActivityStorage: true,
                    isElectron: true,
                    supportsXtreamSqliteDataSource: false,
                } as RuntimeCapabilitiesService,
                {} as PlaybackPositionRuntimeBridgeService,
                { changed: () => undefined, status: () => undefined },
                paused
            ).client;
        const client = makeClient();
        expect(client.options.consent()).toBe(original.generation);
        paused.set(true);
        expect(client.options.consent()).toBeNull();
        paused.set(false);
        writeActivityConsent(key, { ...original, disabling: true });
        expect(activityEnabled()).toBe(true);
        expect(makeClient().options.consent()).toBeNull();
    });
    it.each([1, 'true', null, '2'])(
        'rejects invalid consent values (%s)',
        (enabled) => {
            localStorage.setItem(key, JSON.stringify({ ...original, enabled }));
            expect(readActivityConsent).toThrow('Activity consent unavailable');
            expect(activityEnabled()).toBe(false);
        }
    );
});
