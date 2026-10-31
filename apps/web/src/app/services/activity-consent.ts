import { sourceConnection } from '@iptvnator/services/source-sync/connection';

export function activityConsentKey(): string | null {
    const instance = sourceConnection()?.instanceId;
    return instance ? `iptvnator-server:${instance}:activity-consent-v1` : null;
}
/** The delivery client separately validates the consent generation and device identity. */
export function activityEnabled(): boolean {
    try {
        const key = activityConsentKey();
        return (
            !!key &&
            JSON.parse(localStorage.getItem(key) ?? 'null')?.enabled === true
        );
    } catch {
        return false;
    }
}
