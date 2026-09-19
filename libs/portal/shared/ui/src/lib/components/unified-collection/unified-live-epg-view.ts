import { computed, inject, Signal, signal } from '@angular/core';
import {
    applyChannelNameStrip,
    getM3uArchiveDays,
    isM3uCatchupPlaybackSupported,
} from '@iptvnator/shared/m3u-utils';
import { ResolvedLiveCollectionDetail } from '@iptvnator/portal/shared/data-access';
import {
    LiveEpgPanelState,
    persistLiveEpgPanelState,
    restoreLiveEpgPanelState,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import {
    EpgDateNavigationDirection,
    getTodayEpgDateKey,
    shiftEpgDateKey,
} from '@iptvnator/ui/epg';
import { SettingsStore } from '@iptvnator/services';
import {
    Channel,
    EpgItem,
    EpgProgram,
    EpgViewMode,
} from '@iptvnator/shared/interfaces';
import { LiveEpgPanelSummary } from '@iptvnator/ui/shared-portals';
import {
    getLiveEpgPanelSummary,
    toEpgProgram,
    toLiveEpgPanelSummary,
} from './unified-live-epg-summary.util';
import { UnifiedLiveTimeshift } from './unified-live-catchup';

/**
 * The EPG panel under the live player: its collapsed/expanded state, the
 * day it is showing, and the programme data the timeline and list views
 * render for whichever channel is selected.
 */
export interface UnifiedLiveEpgView {
    readonly panelState: Signal<LiveEpgPanelState>;
    readonly isPanelCollapsed: Signal<boolean>;
    readonly selectedDate: Signal<string>;
    /** Live EPG panel layout chosen in settings; hosts swap timeline ↔ list. */
    readonly viewMode: Signal<EpgViewMode>;
    readonly offsetMinutes: Signal<number>;
    readonly timelinePrograms: Signal<EpgProgram[]>;
    readonly timelineChannelName: Signal<string>;
    readonly timelineChannelLogo: Signal<string>;
    readonly timelineArchiveAvailable: Signal<boolean>;
    readonly timelineArchiveDays: Signal<number>;
    readonly panelSummary: Signal<LiveEpgPanelSummary | null>;
    readonly panelSummaryLabelKey: Signal<string>;
    setPanelCollapsed(collapsed: boolean): void;
    navigateDate(direction: EpgDateNavigationDirection): void;
    selectDate(selectedDate: string): void;
}

/**
 * Must run in an injection context (the hosting component's field
 * initializer or constructor).
 */
export function createUnifiedLiveEpgView(options: {
    activeDetail: Signal<ResolvedLiveCollectionDetail | null>;
    activeItem: Signal<UnifiedCollectionItem | null>;
    activeTimeshift: Signal<UnifiedLiveTimeshift | null>;
    isM3uSelection: Signal<boolean>;
    currentM3uChannel: Signal<Channel | null>;
    currentM3uPrograms: Signal<EpgProgram[]>;
    currentPortalEpgItems: Signal<EpgItem[]>;
    /** 30 s tick that re-evaluates "what is on now". */
    progressTick: Signal<number>;
}): UnifiedLiveEpgView {
    const settingsStore = inject(SettingsStore);
    const panelState = signal<LiveEpgPanelState>(restoreLiveEpgPanelState());
    const selectedDate = signal(getTodayEpgDateKey());
    const offsetMinutes = settingsStore.resolvedEpgOffsetMinutes;

    const currentM3uArchivePlaybackAvailable = computed(() =>
        isM3uCatchupPlaybackSupported(options.currentM3uChannel())
    );

    const timelinePrograms = computed<EpgProgram[]>(() =>
        options.isM3uSelection()
            ? options.currentM3uPrograms()
            : // Portal EPG items normalised to the timeline programme shape.
              options.currentPortalEpgItems().map((item) => toEpgProgram(item))
    );

    const timelineArchiveAvailable = computed(() => {
        if (options.isM3uSelection()) {
            return currentM3uArchivePlaybackAvailable();
        }

        // Portal archive: tvArchive === 1 means the provider has
        // timeshift / archive enabled for this channel.
        const item = options.activeItem();
        return (
            Number(item?.tvArchive ?? 0) === 1 &&
            Number(item?.tvArchiveDuration ?? 0) > 0
        );
    });

    return {
        panelState: panelState.asReadonly(),
        isPanelCollapsed: computed(() => panelState() === 'collapsed'),
        selectedDate: selectedDate.asReadonly(),
        viewMode: settingsStore.resolvedEpgViewMode,
        offsetMinutes,
        timelinePrograms,
        timelineChannelName: computed(() =>
            applyChannelNameStrip(
                options.currentM3uChannel()?.name ??
                    options.activeDetail()?.playback?.title,
                settingsStore.stripCountryPrefix?.()
            )
        ),
        timelineChannelLogo: computed(
            () =>
                options.currentM3uChannel()?.tvg?.logo ??
                options.activeDetail()?.playback?.thumbnail ??
                ''
        ),
        timelineArchiveAvailable,
        /**
         * Catch-up window (days) for the active channel, so the timeline can
         * gate "Watch" to programmes inside it. Without this the timeline
         * defaults `archiveDays` to 0 (treated as unlimited) and offers
         * catch-up on programmes older than the real archive window.
         *
         * M3U: reads catchup-days / timeshift / tvg-rec from the channel
         * attrs. Portal: tvArchiveDuration is already in days — pass it
         * through, matching `live-stream-layout.controlledArchiveDays`.
         */
        timelineArchiveDays: computed(() => {
            if (!timelineArchiveAvailable()) return 0;

            if (options.isM3uSelection()) {
                return getM3uArchiveDays(options.currentM3uChannel());
            }

            return Math.max(
                0,
                Number(options.activeItem()?.tvArchiveDuration ?? 0) || 0
            );
        }),
        panelSummary: computed(() => {
            const timeshift = options.activeTimeshift();
            if (timeshift) {
                // Archive summary is frozen — don't track the 30s tick.
                return toLiveEpgPanelSummary(timeshift.program);
            }
            options.progressTick();
            return getLiveEpgPanelSummary(
                options.activeDetail(),
                offsetMinutes()
            );
        }),
        panelSummaryLabelKey: computed(() =>
            options.activeTimeshift()
                ? 'EPG.ARCHIVE_PLAYBACK'
                : 'EPG.CURRENT_PROGRAM'
        ),
        setPanelCollapsed(collapsed: boolean): void {
            const state: LiveEpgPanelState = collapsed
                ? 'collapsed'
                : 'expanded';
            panelState.set(state);
            persistLiveEpgPanelState(state);
        },
        navigateDate(direction: EpgDateNavigationDirection): void {
            selectedDate.set(shiftEpgDateKey(selectedDate(), direction));
        },
        selectDate(nextDate: string): void {
            selectedDate.set(nextDate);
        },
    };
}
