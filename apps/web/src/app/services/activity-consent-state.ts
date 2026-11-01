import { activityConsentKey } from './activity-consent';
export interface ActivityConsent {
    enabled: boolean;
    generation: string;
    deviceId: string;
    disabling?: boolean;
}
export function readActivityConsent(): ActivityConsent | null {
    const key = activityConsentKey();
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Omit<ActivityConsent, 'enabled'> & {
        enabled: boolean | 2;
    };
    if (
        (value.enabled !== 2 && typeof value.enabled !== 'boolean') ||
        typeof value.generation !== 'string' ||
        !value.generation ||
        typeof value.deviceId !== 'string' ||
        !value.deviceId
    )
        throw new Error('Activity consent unavailable');
    return {
        ...value,
        enabled: value.enabled !== false,
        disabling: value.enabled === 2,
    };
}

/** The compact pause value also fits when ordinary position writes exhaust quota. */
export function writeActivityConsent(
    key: string,
    value: ActivityConsent
): void {
    localStorage.setItem(
        key,
        JSON.stringify({
            enabled: value.disabling ? 2 : value.enabled,
            generation: value.generation,
            deviceId: value.deviceId,
        })
    );
}
