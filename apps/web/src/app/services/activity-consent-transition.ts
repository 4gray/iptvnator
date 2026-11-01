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

export interface ActivityConsentPause {
    key: string;
    generation: string;
}

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
    pause(value: boolean, owner?: ActivityConsentPause): void;
    stopTimer(): void;
}

/** A durable pause retains shared reads until every local mirror acknowledges. */
export async function changeActivityConsent(
    controls: ConsentControls,
    enabled: boolean
): Promise<void> {
    controls.busy.set(true);
    controls.error.set(false);
    let attempt: ActivityConsentPause | undefined;
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
            if (!previous) throw new Error('Activity consent unavailable');
            attempt = { key, generation: previous.generation };
            controls.pause(true, attempt);
            controls.state.set('disabling');
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
        if (attempt) {
            try {
                const sameProfile = activityConsentKey() === attempt.key;
                const current = sameProfile ? readActivityConsent() : null;
                if (
                    !sameProfile ||
                    current?.generation !== attempt.generation
                ) {
                    controls.pause(false);
                    const active = sameProfile && !!current?.enabled;
                    controls.enabled.set(active);
                    controls.state.set(
                        active
                            ? current?.disabling
                                ? 'disabling'
                                : 'initializing'
                            : 'disabled'
                    );
                    if (sameProfile) controls.error.set(false);
                    if (!active) controls.stopTimer();
                }
            } catch {
                // Retain the pause until the current consent can be read safely.
            }
        }
    } finally {
        controls.busy.set(false);
    }
}
