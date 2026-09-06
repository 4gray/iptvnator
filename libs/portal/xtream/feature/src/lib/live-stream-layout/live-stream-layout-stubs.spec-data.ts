import { Component, Directive, input, output, signal } from '@angular/core';
import {
    EpgProgram,
    RecordingStartMetadata,
    RecordingStoppedEvent,
} from '@iptvnator/shared/interfaces';
import {
    EpgProgramActivationEvent,
    EpgTimelineSummary,
} from '@iptvnator/ui/epg';
import { PlaybackFallbackRequest } from '@iptvnator/ui/playback';

@Component({
    selector: 'app-portal-channels-list',
    standalone: true,
    template: '<div data-test-id="portal-channels-list-stub"></div>',
})
export class StubPortalChannelsListComponent {
    readonly sortMode = input<'server' | 'name-asc' | 'name-desc'>('server');
    readonly channelsOverride = input<unknown[] | null>(null);
    readonly searchTermInput = input('');
    readonly revealRequest = input<unknown>(null);
    readonly filteredChannels = signal<unknown[]>([]);
    readonly playClicked = output<unknown>();
    readonly playbackRequested = output<unknown>();
}

@Component({
    selector: 'app-grid-list',
    standalone: true,
    template: '<div data-test-id="grid-list-stub"></div>',
})
export class StubGridListComponent {
    readonly items = input<unknown[]>([]);
    readonly isLoading = input(false);
    readonly isAppending = input(false);
    readonly appendError = input(false);
    readonly searchTerm = input('');
    readonly variant = input<'poster' | 'logo'>('poster');
    readonly type = input<string>();
    readonly itemClicked = output<unknown>();
    readonly retryLoadMore = output<void>();
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
    readonly recordingMetadata = input<RecordingStartMetadata | null>(null);
    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();
    readonly recordingStopped = output<RecordingStoppedEvent>();
}

// Matches both live-panel selectors so the host's timeline ↔ list swap can be
// asserted by tag name; both branches share the identical contract.
@Component({
    selector: 'app-epg-timeline, app-epg-list-view',
    standalone: true,
    template: `
        <div class="live-epg-panel-label">{{ summaryLabelKey() }}</div>
        <div class="live-epg-panel-summary">{{ summary()?.title }}</div>
    `,
})
export class StubEpgTimelineComponent {
    readonly programs = input<EpgProgram[]>([]);
    readonly channelName = input('');
    readonly channelLogo = input('');
    readonly sourceLabel = input('');
    readonly archivePlaybackAvailable = input(false);
    readonly archiveDays = input(0);
    readonly activeProgram = input<EpgProgram | null>(null);
    readonly isLivePlayback = input(true);
    readonly loading = input(false);
    readonly selectedDate = input<string | null>(null);
    readonly collapsed = input(false);
    readonly summary = input<EpgTimelineSummary | null>(null);
    readonly summaryLabelKey = input('');
    readonly offsetMinutes = input(0);
    readonly programActivated = output<EpgProgramActivationEvent>();
    readonly returnToLive = output<void>();
    readonly selectedDateChange = output<string>();
    readonly collapsedChange = output<boolean>();
}

@Directive({
    selector: '[appResizable]',
    standalone: true,
})
export class StubResizableDirective {}
