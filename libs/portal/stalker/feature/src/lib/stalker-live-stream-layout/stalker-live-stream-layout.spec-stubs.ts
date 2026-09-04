import { Component, Directive, input, output } from '@angular/core';
import { type PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import {
    EpgProgram,
    RecordingStartMetadata,
    RecordingStoppedEvent,
} from '@iptvnator/shared/interfaces';

/**
 * Stand-ins for the children StalkerLiveStreamLayoutComponent renders, mirroring
 * the real inputs/outputs so specs can assert what the host hands each child
 * without pulling in the players or the EPG timeline.
 */

@Component({
    selector: 'app-channel-list-item',
    standalone: true,
    template: '',
})
export class StubChannelListItemComponent {
    readonly name = input('');
    readonly logo = input<string | null | undefined>(null);
    readonly selected = input(false);
    readonly showEpg = input(true);
    readonly isRadio = input(false);
    readonly epgProgram = input<unknown>(null);
    readonly progressPercentage = input(0);
    readonly showFavoriteButton = input(false);
    readonly showProgramInfoButton = input(false);
    readonly showDetailsContextMenu = input(false);
    readonly isFavorite = input(false);
    readonly clicked = output<void>();
    readonly activated = output<void>();
    readonly favoriteToggled = output<void>();
    readonly contextMenuRequested = output<MouseEvent>();
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

@Component({
    selector: 'app-audio-player',
    standalone: true,
    template: '',
})
export class StubAudioPlayerComponent {
    readonly url = input.required<string>();
    readonly icon = input('');
    readonly channelName = input('');
    readonly dispatchAdjacentChannelAction = input(true);
    readonly channelSwitchRequested = output<'next' | 'previous'>();
}

// Matches both live-panel selectors so the host's timeline ↔ list swap can be
// asserted by tag name; both branches share the identical contract.
@Component({
    selector: 'app-epg-timeline, app-epg-list-view',
    standalone: true,
    template: `
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
    readonly isLivePlayback = input(false);
    readonly loading = input(false);
    readonly emptyReason = input<string>('none');
    readonly selectedDate = input<string | null>(null);
    readonly collapsed = input(false);
    readonly summary = input<{ title?: string } | null>(null);
    readonly summaryLabelKey = input('');
    readonly offsetMinutes = input(0);
    readonly selectedDateChange = output<string>();
    readonly programActivated = output<EpgProgram>();
    readonly returnToLive = output<void>();
    readonly openEpgSettings = output<void>();
    readonly retry = output<void>();
    readonly collapsedChange = output<boolean>();
}

@Component({
    selector: 'app-portal-empty-state',
    standalone: true,
    template: '',
})
export class StubPortalEmptyStateComponent {
    readonly icon = input('');
    readonly message = input('');
}

@Directive({
    selector: '[appResizable]',
    standalone: true,
})
export class StubResizableDirective {}
