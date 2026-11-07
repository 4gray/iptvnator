import { sourceConnection } from '@iptvnator/services/source-sync/connection';
export interface HistoryConsent {
    enabled: boolean;
    generation: string;
    deviceId: string;
}
export const historyConsentKey = () => {
    const id = sourceConnection()?.instanceId;
    return id ? `iptvnator-server:${id}:history-consent-v1` : null;
};
export function readHistoryConsent(): HistoryConsent | null {
    const key = historyConsentKey();
    const value = key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null;
    if (!value) return null;
    if (
        typeof value.enabled !== 'boolean' ||
        typeof value.generation !== 'string' ||
        !value.generation ||
        typeof value.deviceId !== 'string' ||
        !value.deviceId
    )
        throw new Error('History consent unavailable');
    return value;
}
export const historyProfileUsed = () => {
    try {
        return !!readHistoryConsent();
    } catch {
        return false;
    }
};
export const historyEnabled = () => {
    try {
        return readHistoryConsent()?.enabled === true;
    } catch {
        return false;
    }
};
