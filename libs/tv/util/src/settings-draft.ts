import type { UserData } from './index';
export type SetupPurpose = 'source' | 'settings';
export interface SettingsDraft {
    layout: 'cinema' | 'shelf';
    epg: boolean;
    tmdb: { enabled: boolean; language: string; apiKey?: string };
}
export interface PhoneSettingsDefaults {
    layout: 'cinema' | 'shelf';
    epg: boolean;
    tmdb: { enabled: boolean; language: string; hasKey: boolean };
}
export const metadataLanguages = ['en', 'ru', 'de', 'uk', 'fr', 'es', 'it'];
export function parseSettingsDraft(value: unknown): SettingsDraft {
    const raw = value as SettingsDraft | undefined;
    if (
        !raw ||
        !['cinema', 'shelf'].includes(raw.layout) ||
        typeof raw.epg !== 'boolean' ||
        typeof raw.tmdb?.enabled !== 'boolean' ||
        !metadataLanguages.includes(raw.tmdb.language) ||
        (raw.tmdb.apiKey !== undefined &&
            (typeof raw.tmdb.apiKey !== 'string' ||
                raw.tmdb.apiKey.length > 4096))
    )
        throw new Error('Check the TV settings fields.');
    const key = raw.tmdb.apiKey?.trim();
    return {
        layout: raw.layout,
        epg: raw.epg,
        tmdb: {
            enabled: raw.tmdb.enabled,
            language: raw.tmdb.language,
            ...(key ? { apiKey: key } : {}),
        },
    };
}
export function phoneSettingsDefaults(
    data: Pick<UserData, 'layout' | 'epg' | 'tmdb'>
): PhoneSettingsDefaults {
    return {
        layout: data.layout,
        epg: data.epg,
        tmdb: {
            enabled: data.tmdb.enabled,
            language: data.tmdb.language,
            hasKey: !!data.tmdb.apiKey,
        },
    };
}
export function applySettingsDraft(data: UserData, value: unknown): UserData {
    const settings = parseSettingsDraft(value);
    const apiKey = settings.tmdb.apiKey ?? data.tmdb.apiKey;
    if (settings.tmdb.enabled && !apiKey)
        throw new Error('Enter a TMDB key on your phone or disable metadata.');
    return {
        ...data,
        layout: settings.layout,
        epg: settings.epg,
        tmdb: { ...settings.tmdb, apiKey },
    };
}
