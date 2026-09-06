import { Component, Directive, input, output } from '@angular/core';
import {
    Channel,
    EpgProgram,
    RecordingStartMetadata,
    RecordingStoppedEvent,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import { LiveEpgPanelSummary } from '@iptvnator/ui/shared-portals';

/**
 * Stand-in for the live EPG panel. Matches both selectors so the host's
 * timeline ↔ list swap can be asserted by tag name; both branches share the
 * identical input/output contract, which this stub has to mirror — an input
 * missing here fails the host template with NG0303 at compile time.
 */
@Component({
    selector: 'app-epg-timeline, app-epg-list-view',
    standalone: true,
    template: '',
})
export class StubEpgTimelineComponent {
    readonly programs = input<EpgProgram[]>([]);
    readonly offsetMinutes = input(0);
    readonly channelName = input('');
    readonly channelLogo = input('');
    readonly archivePlaybackAvailable = input(false);
    readonly archiveDays = input(0);
    readonly activeProgram = input<EpgProgram | null>(null);
    readonly isLivePlayback = input(true);
    readonly loading = input(false);
    readonly emptyReason = input<string | null>(null);
    readonly selectedDate = input<string | null>(null);
    readonly collapsed = input(false);
    readonly summary = input<LiveEpgPanelSummary | null>(null);
    readonly summaryLabelKey = input('');
    readonly guideAvailable = input(false);
    readonly programActivated = output<{
        program?: EpgProgram;
        type: 'timeshift' | 'live';
    }>();
    readonly returnToLive = output<void>();
    readonly selectedDateChange = output<string>();
    readonly openEpgSettings = output<void>();
    readonly retry = output<void>();
    readonly collapsedChange = output<boolean>();
    readonly openGuide = output<void>();
}

@Component({
    selector: 'app-channel-list-loading-state',
    standalone: true,
    template: '',
})
export class StubChannelListLoadingStateComponent {
    readonly view = input<string | null>(null);
    readonly showEpg = input(true);
}

@Component({
    selector: 'app-sidebar',
    standalone: true,
    template: '',
})
export class StubSidebarComponent {
    readonly channels = input<Channel[]>([]);
    readonly channelsLoading = input(false);
    readonly showPlaylistHeader = input(false);
    readonly activeView = input('');
    readonly sidebarWidth = input(0);
    readonly sidebarWidthRequested = output<number>();
    readonly sidebarWidthRequestEnded = output<number>();
    readonly sidebarToggleRequested = output<void>();
}

@Component({
    selector: 'app-portal-empty-state',
    standalone: true,
    template: '<div class="stub-empty-state">{{ message() }}</div>',
})
export class StubPortalEmptyStateComponent {
    readonly icon = input('');
    readonly message = input('');
}

@Component({
    selector: 'app-audio-player',
    standalone: true,
    template: '',
})
export class StubAudioPlayerComponent {
    readonly url = input('');
    readonly icon = input('');
    readonly channelName = input('');
    readonly channelLogo = input('');
    readonly volume = input<number | null>(null);
    readonly volumeChange = output<number>();
}

@Component({
    selector: 'app-web-player-view',
    standalone: true,
    template: '',
})
export class StubWebPlayerViewComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly streamUrl = input('');
    readonly title = input('');
    readonly playback = input<unknown>(null);
    readonly playerOverride = input<VideoPlayer | null>(null);
    readonly volume = input(1);
    readonly recordingMetadata = input<RecordingStartMetadata | null>(null);
    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();
    readonly recordingStopped = output<RecordingStoppedEvent>();
}

@Component({
    selector: 'app-epg-guide',
    standalone: true,
    template: '<div class="stub-guide"></div>',
})
export class StubEpgGuideComponent {
    readonly close = output<void>();
    readonly channelActivated = output<string>();
}

@Component({
    selector: 'app-epg-guide-now-playing',
    standalone: true,
    template: '',
})
export class StubEpgGuideNowPlayingComponent {
    readonly channelName = input('');
    readonly program = input<EpgProgram | null>(null);
    readonly offsetMinutes = input(0);
    readonly collapsed = input(false);
    readonly closeRequested = output<void>();
    readonly collapsedChange = output<boolean>();
}

@Directive({
    selector: '[appResizable]',
    standalone: true,
})
export class StubResizableDirective {
    readonly minWidth = input(0);
    readonly maxWidth = input(0);
    readonly defaultWidth = input(0);
    readonly storageKey = input('');
    readonly widthChange = output<number>();
    readonly resizeEnd = output<number>();
}
