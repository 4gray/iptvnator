import { DestroyRef, Signal, effect, inject } from '@angular/core';
import {
    CollectionSourceType,
    REMOTE_CONTROL_RESET_STATUS,
    UnifiedFavoriteChannel,
    getAdjacentChannelItem,
    getChannelItemByNumber,
} from '@iptvnator/portal/shared/util';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { LiveEpgPanelSummary } from '@iptvnator/ui/shared-portals';

/**
 * Remote-control integration for the unified live tab (portal favorites,
 * recently viewed, and the global collections). Unlike the three routed live
 * layouts, this tab hosts channels from any source type, so the published
 * portal is the ACTIVE item's source rather than a fixed value.
 */
export interface UnifiedLiveRemoteControlHost {
    /** The list exactly as rendered: search-filtered and sorted. */
    visibleChannels: Signal<readonly UnifiedFavoriteChannel[]>;
    activeUid: Signal<string | null>;
    activeSourceType: Signal<CollectionSourceType | null>;
    activeChannelName: Signal<string | null>;
    /**
     * True once a selection has resolved its playback detail. This is
     * selection-based, matching the routed live layouts: with an external
     * player in double-click-to-play mode, a single click selects without
     * starting playback yet — the status still reports the selection so the
     * remote can navigate from it.
     */
    isPlaybackActive: Signal<boolean>;
    epgSummary: Signal<LiveEpgPanelSummary | null>;
    playChannel: (channel: UnifiedFavoriteChannel) => void;
}

/**
 * Must run in an injection context (the hosting component's constructor).
 * Subscribes to remote channel commands, publishes status snapshots, and
 * resets the remote status when the tab is destroyed so the remote never
 * keeps advertising a live view that no longer exists.
 */
export function setupUnifiedLiveTabRemoteControl(
    host: UnifiedLiveRemoteControlHost
): void {
    const runtime = inject(RuntimeCapabilitiesService);
    const destroyRef = inject(DestroyRef);

    if (!runtime.supportsRemoteControl) {
        return;
    }

    const bridge = window.electron;
    if (
        !bridge?.onChannelChange ||
        !bridge.onRemoteControlCommand ||
        !bridge.updateRemoteControlStatus
    ) {
        return;
    }

    const unsubscribeChannelChange = bridge.onChannelChange((data) => {
        const activeUid = host.activeUid();
        if (!activeUid) {
            return;
        }

        const nextChannel = getAdjacentChannelItem(
            [...host.visibleChannels()],
            activeUid,
            data.direction,
            (channel) => channel.uid
        );
        if (nextChannel) {
            host.playChannel(nextChannel);
        }
    });

    const unsubscribeCommand = bridge.onRemoteControlCommand((command) => {
        if (command.type !== 'channel-select-number' || !command.number) {
            return;
        }

        const channel = getChannelItemByNumber(
            [...host.visibleChannels()],
            command.number
        );
        if (channel) {
            host.playChannel(channel);
        }
    });

    effect(() => {
        const sourceType = host.activeSourceType();
        if (!host.isPlaybackActive() || !sourceType) {
            bridge.updateRemoteControlStatus?.(REMOTE_CONTROL_RESET_STATUS);
            return;
        }

        const activeUid = host.activeUid();
        const currentIndex = host
            .visibleChannels()
            .findIndex((channel) => channel.uid === activeUid);
        const summary = host.epgSummary();

        bridge.updateRemoteControlStatus?.({
            portal: sourceType,
            isLiveView: true,
            channelName: host.activeChannelName() ?? undefined,
            channelNumber: currentIndex >= 0 ? currentIndex + 1 : undefined,
            epgTitle: summary?.title ?? undefined,
            epgStart: toIsoTimeString(summary?.start),
            epgEnd: toIsoTimeString(summary?.stop),
            supportsVolume: false,
        });
    });

    destroyRef.onDestroy(() => {
        if (typeof unsubscribeChannelChange === 'function') {
            unsubscribeChannelChange();
        }
        if (typeof unsubscribeCommand === 'function') {
            unsubscribeCommand();
        }
        bridge.updateRemoteControlStatus?.(REMOTE_CONTROL_RESET_STATUS);
    });
}

function toIsoTimeString(
    value: string | number | Date | null | undefined
): string | undefined {
    if (value == null) {
        return undefined;
    }
    if (typeof value === 'string') {
        return value;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
