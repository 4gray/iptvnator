import type { UserData } from './index';
export type SetupPurpose = 'source' | 'settings';
/**
 * Playback switches, same names and defaults as desktop. Optional so a TV and
 * a backend from different releases still pair: a missing value keeps what
 * the TV has.
 */
export interface PlaybackDraft {
    seriesAutoplay?: boolean;
    playerUpNextCard?: boolean;
}
export interface SettingsDraft extends PlaybackDraft {
    layout: 'cinema' | 'shelf';
    epg: boolean;
    tmdb: { enabled: boolean; language: string; apiKey?: string };
}
export interface PhoneSettingsDefaults extends PlaybackDraft {
    layout: 'cinema' | 'shelf';
    epg: boolean;
    tmdb: { enabled: boolean; language: string; hasKey: boolean };
}
export const metadataLanguages = ['en', 'ru', 'de', 'uk', 'fr', 'es', 'it'];
const playbackFields = ['seriesAutoplay', 'playerUpNextCard'] as const;
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
                raw.tmdb.apiKey.length > 4096)) ||
        playbackFields.some(
            (field) =>
                raw[field] !== undefined && typeof raw[field] !== 'boolean'
        )
    )
        throw new Error('Check the TV settings fields.');
    const key = raw.tmdb.apiKey?.trim();
    return {
        layout: raw.layout,
        epg: raw.epg,
        ...playbackDraft(raw),
        tmdb: {
            enabled: raw.tmdb.enabled,
            language: raw.tmdb.language,
            ...(key ? { apiKey: key } : {}),
        },
    };
}
/** Only the playback switches that are present, checked by the caller. */
export function playbackDraft(value: PlaybackDraft): PlaybackDraft {
    const draft: PlaybackDraft = {};
    for (const field of playbackFields)
        if (typeof value[field] === 'boolean') draft[field] = value[field];
    return draft;
}
export function phoneSettingsDefaults(
    data: Pick<
        UserData,
        'layout' | 'epg' | 'tmdb' | 'seriesAutoplay' | 'playerUpNextCard'
    >
): PhoneSettingsDefaults {
    return {
        layout: data.layout,
        epg: data.epg,
        seriesAutoplay: data.seriesAutoplay,
        playerUpNextCard: data.playerUpNextCard,
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
        seriesAutoplay: settings.seriesAutoplay ?? data.seriesAutoplay,
        playerUpNextCard: settings.playerUpNextCard ?? data.playerUpNextCard,
        tmdb: { ...settings.tmdb, apiKey },
    };
}
