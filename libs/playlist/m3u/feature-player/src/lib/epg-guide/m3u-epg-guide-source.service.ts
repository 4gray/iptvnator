import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
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

export interface M3uEpgGuideInputs {
    /** Guide-eligible channels (host excludes radio and recognised movies). */
    channels: Signal<Channel[]>;
    favoriteIds: Signal<string[]>;
    activeChannel: Signal<Channel | null>;
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

    readonly scopeId = this.scope.asReadonly();

    private readonly allChannels = computed(
        () => this.inputs()?.channels() ?? []
    );

    readonly scopes = computed<EpgGuideScope[]>(() => {
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
            const favorites = new Set(this.inputs()?.favoriteIds() ?? []);
            return channels.filter((channel) => favorites.has(channel.id));
        }
        if (scope.startsWith(GROUP_PREFIX)) {
            const title = scope.slice(GROUP_PREFIX.length);
            return channels.filter(
                (channel) => channel.group?.title?.trim() === title
            );
        }
        return channels;
    });

    readonly channels = computed<EpgGuideChannel[]>(() => {
        const strip = this.settingsStore.stripCountryPrefix?.();
        return this.scopedChannels().map((channel, index) => ({
            id: channel.id,
            number: index + 1,
            name: applyChannelNameStrip(channel.name, strip) || channel.name,
            logoUrl: channel.tvg?.logo?.trim() || null,
            epgKey: resolveChannelEpgLookupKey(channel) || null,
        }));
    });

    readonly activeChannelId = computed(
        () => this.inputs()?.activeChannel()?.id ?? null
    );

    bind(inputs: M3uEpgGuideInputs): void {
        this.inputs.set(inputs);
    }

    /** Called by the host when the guide opens: mirror the sidebar view. */
    applyInitialScope(view: string): void {
        if (view === SCOPE_FAVORITES) {
            this.scope.set(SCOPE_FAVORITES);
            return;
        }
        const activeGroup = this.inputs()
            ?.activeChannel()
            ?.group?.title?.trim();
        if (view === 'groups' && activeGroup) {
            this.scope.set(`${GROUP_PREFIX}${activeGroup}`);
            return;
        }
        this.scope.set(SCOPE_ALL);
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

    activate(channelId: string): void {
        const channel = this.scopedChannels().find(
            (candidate) => candidate.id === channelId
        );
        if (channel) {
            this.store.dispatch(createM3uChannelPlaybackRequest(channel));
        }
    }

    /** Hits carry the row id only when an exact `epgKey` match exists in scope. */
    async searchPrograms(query: string): Promise<EpgGuideSearchHit[]> {
        const programs =
            (await this.epgBridge.searchPrograms(query, SEARCH_LIMIT)) ?? [];
        const byKey = new Map(
            this.channels()
                .filter((channel) => channel.epgKey !== null)
                .map((channel) => [channel.epgKey as string, channel.id])
        );
        return programs.map((program) => ({
            channelId: byKey.get(program.channel) ?? null,
            program,
        }));
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
