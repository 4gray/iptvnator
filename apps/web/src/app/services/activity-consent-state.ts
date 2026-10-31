import { activityConsentKey } from './activity-consent';
export interface ActivityConsent {
    enabled: boolean;
    generation: string;
    deviceId: string;
}
export function readActivityConsent(): ActivityConsent | null {
    const key = activityConsentKey();
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as ActivityConsent;
    if (
        typeof value.enabled !== 'boolean' ||
        typeof value.generation !== 'string' ||
        !value.generation ||
        typeof value.deviceId !== 'string' ||
        !value.deviceId
    )
        throw new Error('Activity consent unavailable');
    return value;
}
