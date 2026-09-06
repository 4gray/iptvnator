import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { resolveChannelEpgLookupKey } from '@iptvnator/m3u-state';
import { SettingsStore } from '@iptvnator/services';
import { applyChannelNameStrip } from '@iptvnator/shared/m3u-utils';
import { Channel } from '@iptvnator/shared/interfaces';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    EpgGuideChannel,
    EpgGuideScope,
    EpgGuideSearchHit,
    EpgGuideSource,
    EpgGuideWindow,
} from '@iptvnator/ui/epg';
import { createM3uChannelPlaybackRequest } from '../video-player/m3u-channel-playback-actions';
import { isSameChannelEntry } from './channel-entry-identity.util';

export interface M3uEpgGuideInputs {
    /** Guide-eligible channels (host excludes radio and recognised movies). */
    channels: Signal<Channel[]>;
    /**
     * Keys of the playlist's favorites as the store persists them: the
     * channel URL (`FavoritesActions.updateFavorites`), with the channel id
     * accepted as a legacy fallback for rows saved before URL keys.
     */
    favoriteKeys: Signal<string[]>;
    activeChannel: Signal<Channel | null>;
    /** The catch-up/archive URL the host plays instead of the live stream, if any. */
    activePlaybackUrl: Signal<string | null>;
    /**
     * Group the sidebar's groups view currently shows, by title. The guide
     * opens on what the user was looking at, which is not necessarily the
     * playing channel's group — they may have browsed away from it.
     */
    selectedGroup: Signal<string | null>;
}

const SCOPE_ALL = 'all';
const SCOPE_FAVORITES = 'favorites';
const GROUP_PREFIX = 'group:';
const SEARCH_LIMIT = 20;

/**
 * `EPG_GUIDE_SOURCE` for the M3U player. Channels, favorites and the active
 * channel are bound by the host; programmes come from the XMLTV bridge
 * keyed by the same lookup chain the sidebar uses (tvg-id → tvg-name → name).
 * Queries are unscoped (all imported EPG sources), like the M3U timeline.
 */
@Injectable()
export class M3uEpgGuideSourceService implements EpgGuideSource {
    private readonly store = inject(Store);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly translate = inject(TranslateService);

    private readonly inputs = signal<M3uEpgGuideInputs | null>(null);
    private readonly scope = signal(SCOPE_ALL);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    readonly scopeId = this.scope.asReadonly();

    private readonly allChannels = computed(
        () => this.inputs()?.channels() ?? []
    );

    readonly scopes = computed<EpgGuideScope[]>(() => {
        this.languageTick();
        const groups: string[] = [];
        const seen = new Set<string>();
        for (const channel of this.allChannels()) {
            const title = channel.group?.title?.trim();
            if (title && !seen.has(title)) {
                seen.add(title);
                groups.push(title);
            }
        }
        return [
            {
                id: SCOPE_ALL,
                label: this.translate.instant('CHANNELS.ALL_CHANNELS'),
                kind: 'all',
            },
            {
                id: SCOPE_FAVORITES,
                label: this.translate.instant('CHANNELS.FAVORITES'),
                kind: 'favorites',
            },
            ...groups.map((title) => ({
                id: `${GROUP_PREFIX}${title}`,
                label: title,
                kind: 'group' as const,
            })),
        ];
    });

    private readonly scopedChannels = computed(() => {
        const scope = this.scope();
        const channels = this.allChannels();
        if (scope === SCOPE_FAVORITES) {
            const favorites = new Set(this.inputs()?.favoriteKeys() ?? []);
            return channels.filter(
                (channel) =>
                    favorites.has(channel.url) || favorites.has(channel.id)
            );
        }
        if (scope.startsWith(GROUP_PREFIX)) {
            const title = scope.slice(GROUP_PREFIX.length);
            return channels.filter(
                (channel) => channel.group?.title?.trim() === title
            );
        }
        return channels;
    });

    /**
     * Rows the guide renders, each with an id that is unique within the scope.
     * `createChannel` falls back to the stream URL for an M3U entry without an
     * explicit id, so one stream listed in two groups — or simply repeated —
     * yields two channels sharing an id. The guide keys its programme, status
     * and selection maps by row id, so duplicates used to collide: both rows
     * lit up as playing and activating either one played the first.
     * Every row is therefore prefixed with its position in the scope: two rows
     * always differ in that leading integer, so no channel id can collide with
     * another row (suffixing only the repeats did not hold — a playlist whose
     * ids are `x`, `x` and `x#1` produced `x#1` twice). Ids are SCOPE-LOCAL:
     * they change with the scope and the channel list, and only ids the guide
     * was just handed in `channels()` may be passed back.
     */
    private readonly scopedRows = computed<
        Array<{ rowId: string; channel: Channel }>
    >(() =>
        this.scopedChannels().map((channel, index) => ({
            rowId: `${index}:${channel.id}`,
            channel,
        }))
    );

    private readonly channelsByRowId = computed(
        () => new Map(this.scopedRows().map((row) => [row.rowId, row.channel]))
    );

    /** `EpgGuideChannel.id` is the scope-local row id, not `Channel.id`. */
    readonly channels = computed<EpgGuideChannel[]>(() => {
        const strip = this.settingsStore.stripCountryPrefix?.();
        return this.scopedRows().map(({ rowId, channel }, index) => ({
            id: rowId,
            number: index + 1,
            name: applyChannelNameStrip(channel.name, strip) || channel.name,
            logoUrl: channel.tvg?.logo?.trim() || null,
            epgKey: resolveChannelEpgLookupKey(channel) || null,
        }));
    });

    /**
     * The row id of the first row carrying the active channel's id —
     * duplicates are indistinguishable from here, so the guide marks the first
     * of them. `null` when the playing channel is outside the current scope:
     * row ids are scope-local, so there is nothing to point at.
     */
    readonly activeChannelId = computed(() => {
        const active = this.inputs()?.activeChannel();
        if (!active) {
            return null;
        }
        // The store spreads the selected channel, so identity is gone; the
        // same stream can sit in two groups (same id and url), so narrow by
        // the metadata that still tells copies apart before widening.
        const sameId = this.scopedRows().filter(
            (row) => row.channel.id === active.id
        );
        const match =
            sameId.find((row) => isSameChannelEntry(row.channel, active)) ??
            sameId.find((row) => row.channel.url === active.url) ??
            sameId[0];
        return match?.rowId ?? null;
    });

    /** Live unless the host plays a catch-up URL for the active channel. */
    readonly livePlayback = computed(() => !this.inputs()?.activePlaybackUrl());

    bind(inputs: M3uEpgGuideInputs): void {
        this.inputs.set(inputs);
    }

    /**
     * Called by the host when the guide opens: mirror the sidebar view. In the
     * groups view the sidebar's SELECTED group wins over the playing channel's
     * group — the user may have browsed to another group before opening the
     * guide, and that is what they expect to see. The playing channel's group
     * remains the fallback (nothing selected yet, or a group with no
     * guide-eligible channels left).
     */
    applyInitialScope(view: string): void {
        if (view === SCOPE_FAVORITES) {
            this.scope.set(SCOPE_FAVORITES);
            return;
        }
        if (view === 'groups') {
            const groupScopeId =
                this.groupScopeIdFor(this.inputs()?.selectedGroup()) ??
                this.groupScopeIdFor(
                    this.inputs()?.activeChannel()?.group?.title
                );
            if (groupScopeId) {
                this.scope.set(groupScopeId);
                return;
            }
        }
        this.scope.set(SCOPE_ALL);
    }

    /** The scope id for a group title, or null when it offers no rows. */
    private groupScopeIdFor(title: string | null | undefined): string | null {
        const trimmed = title?.trim();
        if (!trimmed) {
            return null;
        }
        const scopeId = `${GROUP_PREFIX}${trimmed}`;
        return this.scopes().some((scope) => scope.id === scopeId)
            ? scopeId
            : null;
    }

    setScope(id: string): void {
        if (this.scopes().some((scope) => scope.id === id)) {
            this.scope.set(id);
        }
    }

    async loadPrograms(
        window: EpgGuideWindow
    ): Promise<Map<string, EpgProgram[]>> {
        const keyed = this.keyedChannels(window.channels);
        const result = new Map<string, EpgProgram[]>();
        if (keyed.length === 0) {
            return result;
        }
        const response = await this.epgBridge.getProgramsForChannels({
            channelIds: Array.from(new Set(keyed.map(([, key]) => key))),
            fromMs: window.fromMs,
            toMs: window.toMs,
        });
        if (!response) {
            return result;
        }
        for (const [channel, key] of keyed) {
            result.set(channel.id, response[key] ?? []);
        }
        return result;
    }

    async loadCoverage(window: EpgGuideWindow): Promise<Set<string>> {
        const keyed = this.keyedChannels(window.channels);
        const covered = new Set<string>();
        if (keyed.length === 0) {
            return covered;
        }
        const response = await this.epgBridge.getProgramCoverage({
            channelIds: Array.from(new Set(keyed.map(([, key]) => key))),
            fromMs: window.fromMs,
            toMs: window.toMs,
        });
        const keys = new Set(response ?? []);
        for (const [channel, key] of keyed) {
            if (keys.has(key)) {
                covered.add(channel.id);
            }
        }
        return covered;
    }

    /**
     * Resolves the row id back to its own channel — the guide only ever passes
     * back ids it rendered from `channels()`, and a duplicated channel id can
     * only be told apart by that row id.
     */
    activate(rowId: string): void {
        const channel = this.channelsByRowId().get(rowId);
        if (channel) {
            this.store.dispatch(createM3uChannelPlaybackRequest(channel));
        }
    }

    /** Hits carry the row id only when an exact `epgKey` match exists in scope. */
    async searchPrograms(query: string): Promise<EpgGuideSearchHit[]> {
        const programs =
            (await this.epgBridge.searchPrograms(query, SEARCH_LIMIT)) ?? [];
        const byKey = new Map<string, EpgGuideChannel>();
        for (const channel of this.channels()) {
            // Duplicate rows share an EPG key; jump to the first, like
            // `activeChannelId`.
            if (channel.epgKey !== null && !byKey.has(channel.epgKey)) {
                byKey.set(channel.epgKey, channel);
            }
        }
        return programs.map((program) => {
            const row = byKey.get(program.channel);
            return {
                channelId: row?.id ?? null,
                // The playlist's own name when the row is known, else the
                // XMLTV display name the search joined in; never the raw id.
                channelName: row?.name ?? program.channelName ?? null,
                program,
            };
        });
    }

    private keyedChannels(
        channels: readonly EpgGuideChannel[]
    ): Array<[EpgGuideChannel, string]> {
        return channels
            .filter((channel) => channel.epgKey !== null)
            .map((channel): [EpgGuideChannel, string] => [
                channel,
                channel.epgKey as string,
            ]);
    }
}
