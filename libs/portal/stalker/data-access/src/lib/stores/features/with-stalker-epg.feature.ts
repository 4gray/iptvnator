import { computed, inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withState,
} from '@ngrx/signals';
import { createLogger } from '@iptvnator/portal/shared/util';
import { DataService } from '@iptvnator/services';
import { EpgItem, EpgProgram, StalkerPortalActions } from '@iptvnator/shared/interfaces';
import { normalizeStalkerEntityId } from '../../stalker-vod.utils';
import { StalkerSessionService } from '../../stalker-session.service';
import { StalkerEpgFeatureStoreContract } from '../stalker-store.contracts';
import { executeStalkerRequest } from '../utils';

interface StalkerEpgEntry {
    id?: string | number;
    name?: string;
    descr?: string;
    category?: string;
    time?: string;
    time_to?: string;
    start?: string;
    stop?: string;
    ch_id?: string | number;
    start_timestamp?: string | number;
    stop_timestamp?: string | number;
}

type StalkerBulkEpgValue =
    | StalkerEpgEntry[]
    | {
          data?: StalkerEpgEntry[];
          epg?: StalkerEpgEntry[];
          items?: StalkerEpgEntry[];
      };

interface StalkerEpgResponse {
    js?:
        | StalkerEpgEntry[]
        | {
              data?: StalkerEpgEntry[] | Record<string, StalkerBulkEpgValue>;
          }
        | Record<string, StalkerBulkEpgValue>;
}

export interface StalkerEpgState {
    bulkItvEpgByChannel: Record<string, EpgProgram[]>;
    bulkItvEpgPlaylistId: string | null;
    bulkItvEpgPeriodHours: number | null;
    bulkItvEpgLoaded: boolean;
    isLoadingBulkItvEpg: boolean;
}

const initialEpgState: StalkerEpgState = {
    bulkItvEpgByChannel: {},
    bulkItvEpgPlaylistId: null,
    bulkItvEpgPeriodHours: null,
    bulkItvEpgLoaded: false,
    isLoadingBulkItvEpg: false,
};

const ACTIVE_EPG_FALLBACK_SIZE = 10;

/**
 * EPG concern methods.
 */
export function withStalkerEpg() {
    const logger = createLogger('withStalkerEpg');

    return signalStoreFeature(
        withState<StalkerEpgState>(initialEpgState),
        withComputed((store) => {
            const storeContext = store as typeof store &
                StalkerEpgFeatureStoreContract;

            return {
                selectedItvEpgPrograms: computed(() => {
                    const selectedId = storeContext.selectedItvId();
                    if (!selectedId) {
                        return [];
                    }

                    return (
                        store.bulkItvEpgByChannel()[
                            normalizeStalkerEntityId(selectedId)
                        ] ?? []
                    );
                }),
            };
        }),
        withMethods(
            (
                store,
                dataService = inject(DataService),
                stalkerSession = inject(StalkerSessionService)
            ) => {
                const storeContext = store as typeof store &
                    StalkerEpgFeatureStoreContract;
                const requestDeps = {
                    dataService,
                    stalkerSession,
                };

                const requestEpg = async (
                    playlist: NonNullable<
                        ReturnType<
                            StalkerEpgFeatureStoreContract['currentPlaylist']
                        >
                    >,
                    queryParams: Record<string, string>
                ): Promise<StalkerEpgResponse> => {
                    return executeStalkerRequest<StalkerEpgResponse>(
                        requestDeps,
                        playlist,
                        queryParams
                    );
                };

                const fetchShortEpg = async (
                    channelId: number | string,
                    size: number
                ): Promise<EpgItem[]> => {
                    const playlist = storeContext.currentPlaylist();
                    if (!playlist) {
                        return [];
                    }

                    const response = await requestEpg(playlist, {
                        action: StalkerPortalActions.GetShortEpg,
                        type: 'itv',
                        ch_id: String(channelId),
                        size: String(size),
                    });

                    return extractShortEpgEntries(response)
                        .map((item) => toEpgItem(item, channelId))
                        .filter((item) => item.start && item.stop)
                        .sort(
                            (left, right) =>
                                getProgramTimestampMs(
                                    left.start,
                                    left.start_timestamp
                                ) -
                                getProgramTimestampMs(
                                    right.start,
                                    right.start_timestamp
                                )
                        );
                };

                return {
                    async fetchChannelEpg(
                        channelId: number | string,
                        size = ACTIVE_EPG_FALLBACK_SIZE
                    ): Promise<EpgItem[]> {
                        try {
                            return await fetchShortEpg(channelId, size);
                        } catch (error) {
                            logger.error('Error loading short Stalker EPG', {
                                channelId,
                                size,
                                error,
                            });
                            return [];
                        }
                    },

                    async ensureBulkItvEpg(periodHours = 168): Promise<void> {
                        const playlist = storeContext.currentPlaylist();
                        if (!playlist?._id) {
                            patchState(store, initialEpgState);
                            return;
                        }

                        const playlistId = String(playlist._id);
                        const shouldReuseCache =
                            store.bulkItvEpgLoaded() &&
                            store.bulkItvEpgPlaylistId() === playlistId &&
                            store.bulkItvEpgPeriodHours() === periodHours;

                        if (shouldReuseCache || store.isLoadingBulkItvEpg()) {
                            return;
                        }

                        if (store.bulkItvEpgPlaylistId() !== playlistId) {
                            patchState(store, initialEpgState);
                        }

                        patchState(store, {
                            isLoadingBulkItvEpg: true,
                            bulkItvEpgPlaylistId: playlistId,
                            bulkItvEpgPeriodHours: periodHours,
                        });

                        try {
                            const response = await requestEpg(playlist, {
                                action: StalkerPortalActions.GetEpgInfo,
                                type: 'itv',
                                period: String(periodHours),
                            });
                            const selectedChannelId =
                                storeContext.selectedItvId() ?? null;
                            const bulkPrograms = extractBulkEpgByChannel(
                                response,
                                selectedChannelId
                            );

                            patchState(store, {
                                bulkItvEpgByChannel: bulkPrograms,
                                bulkItvEpgLoaded: true,
                                isLoadingBulkItvEpg: false,
                            });
                        } catch (error) {
                            logger.warn('Bulk Stalker EPG unavailable', error);
                            patchState(store, {
                                bulkItvEpgByChannel: {},
                                bulkItvEpgLoaded: true,
                                isLoadingBulkItvEpg: false,
                            });
                        }
                    },

                    clearBulkItvEpgCache(): void {
                        patchState(store, initialEpgState);
                    },
                };
            }
        )
    );
}

function extractShortEpgEntries(
    response: StalkerEpgResponse
): StalkerEpgEntry[] {
    if (Array.isArray(response?.js)) {
        return response.js;
    }

    const data = response?.js?.data;
    return Array.isArray(data) ? data : [];
}

function extractBulkEpgByChannel(
    response: StalkerEpgResponse,
    selectedChannelId?: string | null
): Record<string, EpgProgram[]> {
    const raw = response?.js;
    const groupedEntries: Record<string, StalkerEpgEntry[]> = {};

    const appendEntries = (
        channelId: string | number | null | undefined,
        entries: StalkerEpgEntry[]
    ) => {
        const normalizedChannelId = normalizeOptionalEntityId(channelId);
        if (!normalizedChannelId || entries.length === 0) {
            return;
        }

        groupedEntries[normalizedChannelId] = entries;
    };

    const groupArrayEntries = (entries: StalkerEpgEntry[]) => {
        for (const entry of entries) {
            const entryChannelId = entry.ch_id ?? selectedChannelId ?? null;
            const normalizedChannelId =
                normalizeOptionalEntityId(entryChannelId);
            if (!normalizedChannelId) {
                continue;
            }

            groupedEntries[normalizedChannelId] ??= [];
            groupedEntries[normalizedChannelId].push(entry);
        }
    };

    if (Array.isArray(raw)) {
        groupArrayEntries(raw);
    } else {
        const rawData =
            raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw;

        if (Array.isArray(rawData)) {
            groupArrayEntries(rawData);
        } else if (rawData && typeof rawData === 'object') {
            for (const [channelId, value] of Object.entries(rawData)) {
                appendEntries(channelId, extractEntriesFromBulkValue(value));
            }
        }
    }

    const normalizedPrograms: Record<string, EpgProgram[]> = {};

    for (const [channelId, entries] of Object.entries(groupedEntries)) {
        const programs = entriesToPrograms(entries, channelId);
        if (programs.length > 0) {
            normalizedPrograms[channelId] = programs;
        }
    }

    return normalizedPrograms;
}

function extractEntriesFromBulkValue(value: unknown): StalkerEpgEntry[] {
    if (Array.isArray(value)) {
        return value;
    }

    if (!value || typeof value !== 'object') {
        return [];
    }

    const recordValue = value as {
        data?: StalkerEpgEntry[];
        epg?: StalkerEpgEntry[];
        items?: StalkerEpgEntry[];
    };

    if (Array.isArray(recordValue.data)) {
        return recordValue.data;
    }

    if (Array.isArray(recordValue.epg)) {
        return recordValue.epg;
    }

    if (Array.isArray(recordValue.items)) {
        return recordValue.items;
    }

    return [];
}

function entriesToPrograms(
    entries: StalkerEpgEntry[],
    fallbackChannelId: string | number
): EpgProgram[] {
    return entries
        .map((entry) => toEpgProgram(entry, fallbackChannelId))
        .filter((program): program is EpgProgram => program !== null)
        .sort(
            (left, right) =>
                getProgramTimestampMs(left.start, left.startTimestamp) -
                getProgramTimestampMs(right.start, right.startTimestamp)
        );
}

function toEpgItem(
    item: StalkerEpgEntry,
    fallbackChannelId: string | number
): EpgItem {
    const startRaw = item.time ?? item.start ?? '';
    const stopRaw = item.time_to ?? item.stop ?? '';
    const startTimestamp = getProgramTimestampSeconds(
        startRaw,
        item.start_timestamp
    );
    const stopTimestamp = getProgramTimestampSeconds(
        stopRaw,
        item.stop_timestamp
    );
    const start = toIsoString(startRaw, startTimestamp);
    const stop = toIsoString(stopRaw, stopTimestamp);

    return {
        id: String(item.id ?? ''),
        epg_id: '',
        title: item.name ?? '',
        description: item.descr ?? '',
        lang: '',
        start,
        end: stop,
        stop,
        channel_id: String(item.ch_id ?? fallbackChannelId),
        start_timestamp: startTimestamp !== null ? String(startTimestamp) : '',
        stop_timestamp: stopTimestamp !== null ? String(stopTimestamp) : '',
    };
}

function toEpgProgram(
    item: StalkerEpgEntry,
    fallbackChannelId: string | number
): EpgProgram | null {
    const epgItem = toEpgItem(item, fallbackChannelId);
    if (!epgItem.start || !epgItem.stop) {
        return null;
    }

    return {
        start: epgItem.start,
        stop: epgItem.stop,
        channel: normalizeStalkerEntityId(epgItem.channel_id),
        title: epgItem.title,
        desc: epgItem.description || null,
        category: item.category ?? null,
        startTimestamp: parseInteger(epgItem.start_timestamp),
        stopTimestamp: parseInteger(epgItem.stop_timestamp),
    };
}

function toIsoString(
    rawValue: string,
    timestampSeconds: number | null
): string {
    if (timestampSeconds !== null) {
        return new Date(timestampSeconds * 1000).toISOString();
    }

    const normalized = String(rawValue ?? '').trim();
    if (!normalized) {
        return '';
    }

    const candidate = normalized.includes('T')
        ? normalized
        : normalized.replace(' ', 'T');
    const parsed = Date.parse(candidate);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function getProgramTimestampSeconds(
    rawValue: string,
    timestampValue?: string | number | null
): number | null {
    const parsedTimestamp = parseInteger(timestampValue);
    if (parsedTimestamp !== null && parsedTimestamp > 0) {
        return parsedTimestamp;
    }

    const normalized = String(rawValue ?? '').trim();
    if (!normalized) {
        return null;
    }

    const candidate = normalized.includes('T')
        ? normalized
        : normalized.replace(' ', 'T');
    const parsedDate = Date.parse(candidate);

    return Number.isFinite(parsedDate) ? Math.floor(parsedDate / 1000) : null;
}

function getProgramTimestampMs(
    rawValue: string,
    timestampValue?: string | number | null
): number {
    const timestampSeconds = getProgramTimestampSeconds(
        rawValue,
        timestampValue
    );
    if (timestampSeconds !== null) {
        return timestampSeconds * 1000;
    }

    return Number.POSITIVE_INFINITY;
}

function parseInteger(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOptionalEntityId(
    value: string | number | null | undefined
): string | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    return normalizeStalkerEntityId(value);
}
