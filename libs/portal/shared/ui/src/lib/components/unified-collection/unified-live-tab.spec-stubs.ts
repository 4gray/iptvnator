import {
    ChangeDetectionStrategy,
    Component,
    Directive,
    input,
    output,
} from '@angular/core';
import { type PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import { EpgProgramActivationEvent } from '@iptvnator/ui/epg';
import {
    EpgProgram,
    RecordingStartMetadata,
    RecordingStoppedEvent,
    ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    DEFAULT_FAVORITES_CHANNEL_SORT_MODE,
    FavoritesChannelSortMode,
    UnifiedFavoriteChannel,
} from '@iptvnator/portal/shared/util';

/**
 * Stand-ins for the components UnifiedLiveTabComponent renders. They mirror
 * the real inputs/outputs so a spec can assert what the host hands each child
 * without pulling in the players, EPG timeline or the Electron bridge.
 */

@Directive({
    selector: '[appResizable]',
})
export class StubResizableDirective {
    readonly minWidth = input<number>();
    readonly maxWidth = input<number>();
    readonly defaultWidth = input<number>();
    readonly storageKey = input<string>('');
}

@Component({
    selector: 'app-global-favorites-list',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StubGlobalFavoritesListComponent {
    readonly channels = input.required<UnifiedFavoriteChannel[]>();
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly showEpg = input(true);
    readonly favoriteUids = input<ReadonlySet<string>>(new Set<string>());
    readonly epgMap = input<Map<string, EpgProgram | null>>(new Map());
    readonly progressTick = input(0);
    readonly activeUid = input<string | null>(null);
    readonly searchTermInput = input('');
    readonly draggable = input(true);
    readonly sortMode = input<FavoritesChannelSortMode>(
        DEFAULT_FAVORITES_CHANNEL_SORT_MODE
    );

    readonly channelSelected = output<UnifiedFavoriteChannel>();
    readonly channelsReordered = output<UnifiedFavoriteChannel[]>();
    readonly favoriteToggled = output<UnifiedFavoriteChannel>();
    readonly removeRequested = output<UnifiedFavoriteChannel>();
}

// Matches both live-panel selectors so the host's timeline ↔ list swap can be
// asserted by tag name; both branches share the identical contract.
@Component({
    selector: 'app-epg-timeline, app-epg-list-view',
    template: '<div class="stub-epg-timeline"></div>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StubEpgTimelineComponent {
    readonly programs = input<EpgProgram[]>([]);
    readonly channelName = input('');
    readonly channelLogo = input('');
    readonly archivePlaybackAvailable = input(false);
    readonly archiveDays = input(0);
    readonly activeProgram = input<EpgProgram | null>(null);
    readonly isLivePlayback = input(true);
    readonly selectedDate = input<string | null>(null);
    readonly collapsed = input(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly summary = input<any>(null);
    readonly summaryLabelKey = input('');
    readonly offsetMinutes = input(0);
    readonly selectedDateChange = output<string>();
    readonly collapsedChange = output<boolean>();
    readonly programActivated = output<EpgProgramActivationEvent>();
    readonly returnToLive = output<void>();
}

@Component({
    selector: 'app-audio-player',
    template: '<div class="stub-audio-player"></div>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StubAudioPlayerComponent {
    readonly icon = input('');
    readonly url = input.required<string>();
    readonly channelName = input('');
}

@Component({
    selector: 'app-web-player-view',
    template: '<div class="stub-web-player-view"></div>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StubWebPlayerViewComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly streamUrl = input.required<string>();
    readonly title = input('');
    readonly playback = input<ResolvedPortalPlayback | null>(null);
    readonly playerOverride = input<VideoPlayer | null>(null);
    readonly recordingMetadata = input<RecordingStartMetadata | null>(null);
    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();
    readonly recordingStopped = output<RecordingStoppedEvent>();
}
