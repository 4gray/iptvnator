import {
    isM3uRecentlyViewedItem,
    PlaylistBackupSettings,
} from '@iptvnator/shared/interfaces';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;
const isStringList = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string');
const isRecordList = (value: unknown): boolean =>
    Array.isArray(value) && value.every(isRecord);

/** Validate destructive inputs for every entry before the first storage write.
 * Xtream's historical ID-less records still go through its compatibility normalizer.
 */
export function hasValidBackupEntryData(entry: unknown): boolean {
    if (
        !isRecord(entry) ||
        !isText(entry['exportedId']) ||
        !isText(entry['title'])
    ) {
        return false;
    }
    if (
        entry['autoRefresh'] !== undefined &&
        typeof entry['autoRefresh'] !== 'boolean'
    )
        return false;
    if (
        entry['position'] !== undefined &&
        (typeof entry['position'] !== 'number' ||
            !Number.isFinite(entry['position']))
    )
        return false;
    if (
        entry['autoImportEpg'] !== undefined &&
        typeof entry['autoImportEpg'] !== 'boolean'
    )
        return false;
    if (!isRecord(entry['userState'])) return false;
    const state = entry['userState'];
    const metadata =
        entry['portalType'] === 'm3u' ? entry['source'] : entry['connection'];
    if (!isRecord(metadata)) return false;
    // These fields reach persistence or identity matching directly, without a normalizer.
    const stringFields =
        entry['portalType'] === 'm3u'
            ? [
                  'rawM3u',
                  'url',
                  'userAgent',
                  'referrer',
                  'origin',
                  'filePathHint',
              ]
            : [
                  'serverUrl',
                  'portalUrl',
                  'username',
                  'password',
                  'macAddress',
                  'userAgent',
                  'referrer',
                  'origin',
                  'stalkerSerialNumber',
                  'stalkerDeviceId1',
                  'stalkerDeviceId2',
                  'stalkerSignature1',
                  'stalkerSignature2',
              ];
    if (
        stringFields.some(
            (key) =>
                metadata[key] !== undefined && typeof metadata[key] !== 'string'
        )
    ) {
        return false;
    }
    switch (entry['portalType']) {
        case 'm3u':
            return (
                (entry['epgUrls'] === undefined ||
                    isStringList(entry['epgUrls'])) &&
                (entry['manualEpgUrls'] === undefined ||
                    isStringList(entry['manualEpgUrls'])) &&
                (entry['disabledEpgUrls'] === undefined ||
                    isStringList(entry['disabledEpgUrls'])) &&
                isText(metadata['rawM3u']) &&
                /^\s*#EXTM3U/i.test(metadata['rawM3u']) &&
                isStringList(state['favorites']) &&
                isStringList(state['hiddenGroupTitles']) &&
                Array.isArray(state['recentlyViewed']) &&
                state['recentlyViewed'].every(isM3uRecentlyViewedItem)
            );
        case 'stalker':
            return (
                isText(metadata['portalUrl']) &&
                isText(metadata['macAddress']) &&
                isRecordList(state['favorites']) &&
                isRecordList(state['recentlyViewed'])
            );
        case 'xtream':
            return (
                isText(metadata['serverUrl']) && isText(metadata['username'])
            );
        default:
            return false;
    }
}

export function hasValidBackupSettings(
    settings: PlaylistBackupSettings | undefined
): boolean {
    return (
        settings === undefined ||
        (isRecord(settings) && isStringList(settings.epgUrls))
    );
}
