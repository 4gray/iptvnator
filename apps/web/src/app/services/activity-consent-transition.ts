import type { WritableSignal } from '@angular/core';
import type { ActivitySyncClient } from '@iptvnator/services/activity-sync';
import {
    createRandomId,
    type ServerInstanceInfo,
} from '@iptvnator/shared/interfaces';
import { ACTIVITY_SYNC_CAPABILITY } from '@iptvnator/shared/interfaces/activity-sync';
import { requestSourceServer } from '@iptvnator/services/source-sync';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import { activityConsentKey } from './activity-consent';
import {
    readActivityConsent,
    writeActivityConsent,
    type ActivityConsent,
} from './activity-consent-state';

interface ConsentControls {
    enabled: WritableSignal<boolean>;
    busy: WritableSignal<boolean>;
    error: WritableSignal<boolean>;
    state: WritableSignal<string>;
    supportsStorage: boolean;
    instanceId?: string;
    refreshSources(): Promise<void>;
    client(): ActivitySyncClient;
    mirror(): Promise<void>;
    pause(value: boolean): void;
    stopTimer(): void;
}

/** A durable pause retains shared reads until every local mirror acknowledges. */
export async function changeActivityConsent(
    controls: ConsentControls,
    enabled: boolean
): Promise<void> {
    controls.busy.set(true);
    controls.error.set(false);
    try {
        const key = activityConsentKey();
        if (
            !key ||
            (controls.instanceId &&
                controls.instanceId !== sourceConnection()?.instanceId)
        )
            throw new Error('Activity profile changed');
        const original = localStorage.getItem(key);
        let previous: ActivityConsent | null;
        try {
            previous = readActivityConsent();
        } catch {
            previous = null;
        }
        if (enabled) {
            if (!controls.supportsStorage)
                throw new Error('Activity storage unavailable');
            await controls.refreshSources();
            const response = await requestSourceServer({
                operation: 'instance',
            });
            if (
                !(response.body as ServerInstanceInfo)?.capabilities?.includes(
                    ACTIVITY_SYNC_CAPABILITY
                )
            ) {
                controls.state.set('incompatible');
                throw new Error('Activity server incompatible');
            }
        } else {
            controls.pause(true);
            controls.state.set('disabling');
            if (!previous) throw new Error('Activity consent unavailable');
            writeActivityConsent(key, {
                ...previous,
                enabled: true,
                disabling: true,
            });
            await controls.client().stopDelivery();
            if (activityConsentKey() !== key)
                throw new Error('Activity profile changed');
            await controls.mirror();
            if (activityConsentKey() !== key)
                throw new Error('Activity profile changed');
            const current = readActivityConsent();
            if (current?.enabled === false) {
                controls.enabled.set(false);
                controls.state.set('disabled');
                controls.pause(false);
                controls.stopTimer();
                return;
            }
            if (
                !current?.disabling ||
                current.generation !== previous.generation
            )
                throw new Error('Activity consent changed');
        }
        if (activityConsentKey() !== key)
            throw new Error('Activity profile changed');
        if (enabled && localStorage.getItem(key) !== original)
            throw new Error('Activity consent changed');
        writeActivityConsent(key, {
            enabled,
            generation: createRandomId(),
            deviceId: previous?.deviceId ?? createRandomId(),
        });
        controls.enabled.set(enabled);
        controls.state.set(enabled ? 'initializing' : 'disabled');
        controls.pause(false);
        if (!enabled) controls.stopTimer();
    } catch {
        controls.error.set(true);
    } finally {
        controls.busy.set(false);
    }
}
