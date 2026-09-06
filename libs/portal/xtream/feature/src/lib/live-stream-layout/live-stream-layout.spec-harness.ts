import { Directive, Component, input, output, signal } from '@angular/core';
import { of } from 'rxjs';
import {
    EpgProgramActivationEvent,
    EpgTimelineSummary,
} from '@iptvnator/ui/epg';
import { type PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import {
    EpgItem,
    EpgProgram,
    RecordingStartMetadata,
    RecordingStoppedEvent,
} from '@iptvnator/shared/interfaces';

/**
 * Shared stubs, mocks and fixture state for the `LiveStreamLayoutComponent`
 * spec suite. They live beside the specs rather than inside a single file
 * because the suite is at the 1200-line test cap; module-scoped signals are
 * safe to export because Jest gives every spec file its own module registry.
 */

export const LIVE_CHANNEL_SORT_STORAGE_KEY = 'xtream-live-channel-sort-mode';

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

export const fixedNow = new Date('2026-04-05T12:00:00.000Z');

export const sampleChannel = {
    xtream_id: 101,
    name: 'Channel 101',
    stream_icon: 'channel-101.png',
    tv_archive: 1,
    tv_archive_duration: 3,
};
export const playlist = {
    id: 'playlist-1',
    serverUrl: 'http://demo.example',
    username: 'demo',
    password: 'secret',
};

export const categories = signal([{ category_id: 1, category_name: 'News' }]);
export const categoryItemCounts = signal(new Map<number, number>([[1, 1]]));
export const epgItems = signal<EpgItem[]>([]);
export const currentEpgItem = signal<EpgItem | null>(null);
export const isLoadingEpg = signal(false);
export const selectedTypeContentLoading = signal(false);
export const selectedCategoryId = signal<number | null>(1);
export const selectedContentType = signal<'live' | 'vod' | 'series'>('live');
export const selectedItem = signal<unknown>(sampleChannel);
export const currentPlaylist = signal(playlist);
export const liveStreams = signal<unknown[]>([]);
export const paginatedContent = signal<unknown[]>([]);
export const hasMoreContent = signal(false);

export const xtreamStore = {
    getCategoriesBySelectedType: categories,
    getCategoryItemCounts: categoryItemCounts,
    getPaginatedContent: paginatedContent,
    hasMoreContent,
    epgItems,
    currentEpgItem,
    isLoadingEpg,
    selectedTypeContentLoading,
    selectedCategoryId,
    selectedContentType,
    selectedItem,
    currentPlaylist,
    liveStreams,
    selectItemsFromSelectedCategory: jest.fn(() => [sampleChannel]),
    constructStreamUrl: jest.fn(() => 'https://example.com/live.ts'),
    openPlayer: jest.fn(),
    setSelectedItem: jest.fn(),
    setSelectedCategory: jest.fn(),
    loadMoreContent: jest.fn(),
};

export const favoritesService = {
    getFavorites: jest.fn().mockReturnValue(of([])),
};

export const xtreamUrlService = {
    constructAutoLiveTsUrl: jest.fn(() => undefined),
    resolveCatchupUrl: jest
        .fn()
        .mockResolvedValue('https://example.com/timeshift.ts'),
};

export const portalPlayer = {
    isEmbeddedPlayer: jest.fn().mockReturnValue(true),
    openExternalPlayback: jest.fn(),
};

export const settingsStore = {
    openStreamOnDoubleClick: signal(false),
    // Reset in beforeEach: the store is module-scoped, so a test failure
    // before an in-test restore must not leak 'list' into siblings.
    resolvedEpgViewMode: signal<'timeline' | 'list'>('timeline'),
    resolvedEpgOffsetMinutes: signal(0),
};
