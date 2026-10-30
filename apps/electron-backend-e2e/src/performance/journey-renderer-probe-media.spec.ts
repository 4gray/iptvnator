import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

import {
    assertJourneyRendererProbeState,
    createPlaybackJourneyProbeOptions,
    JOURNEY_IPC_SENTINEL_ID,
    JOURNEY_IPC_SENTINEL_METHOD,
    JOURNEY_OPEN_SOURCE_PROBE_STATE_KEY,
    JOURNEY_PLAYBACK_END_SENTINEL_ID,
    JOURNEY_PLAYBACK_PROBE_STATE_KEY,
    JOURNEY_PLAYBACK_START_SENTINEL_ID,
    JOURNEY_PROBE_STATE_KEY,
    type JourneyRendererProbeOptions,
} from './journey-renderer-probe';
import {
    createFixtureFromDom,
    settle,
    type FakeObserver,
    type Fixture,
} from './journey-renderer-probe.test-helpers';

const LIVE_URL = 'http://localhost/workspace/xtreams/playlist-1/live';

interface PlaybackFixture extends Fixture {
    readonly channel: HTMLElement;
    readonly player: HTMLElement;
}

function createPlaybackFixture(
    overrides: Partial<JourneyRendererProbeOptions> = {}
): PlaybackFixture {
    const dom = new JSDOM(
        `<!doctype html><html><body><app-root>
<app-live-stream-layout>
<div data-test-id="channel-item"><span class="name">Channel 1</span></div>
<app-web-player-view></app-web-player-view>
</app-live-stream-layout></app-root></body></html>`,
        { pretendToBeVisual: true, runScripts: 'outside-only', url: LIVE_URL }
    );
    const fixture = createFixtureFromDom(
        dom,
        { ...createPlaybackJourneyProbeOptions(), ...overrides },
        true
    );
    const { document } = fixture.window;
    return {
        ...fixture,
        channel: document.querySelector(
            '[data-test-id="channel-item"]'
        ) as HTMLElement,
        player: document.querySelector('app-web-player-view') as HTMLElement,
    };
}

/** What the player does on the click: mount a video element. */
function mountVideo(fixture: PlaybackFixture): HTMLVideoElement {
    const video = fixture.window.document.createElement('video');
    fixture.player.append(video);
    return video;
}

function fire(fixture: Fixture, target: EventTarget, type: string): void {
    // Media events do not bubble; the probe must see them in capture.
    target.dispatchEvent(new fixture.window.Event(type, { bubbles: false }));
}

test('playback options start at a live channel row and end on the player video', () => {
    const options = createPlaybackJourneyProbeOptions();
    assert.equal(options.journey, 'playback');
    assert.equal(options.stateKey, JOURNEY_PLAYBACK_PROBE_STATE_KEY);
    assert.notEqual(options.stateKey, JOURNEY_PROBE_STATE_KEY);
    assert.notEqual(options.stateKey, JOURNEY_OPEN_SOURCE_PROBE_STATE_KEY);
    assert.equal(options.sentinelId, JOURNEY_PLAYBACK_END_SENTINEL_ID);
    assert.notEqual(options.sentinelId, JOURNEY_IPC_SENTINEL_ID);
    assert.equal(options.sentinelMethod, JOURNEY_IPC_SENTINEL_METHOD);
    assert.equal(
        options.startClick?.sentinelId,
        JOURNEY_PLAYBACK_START_SENTINEL_ID
    );
    assert.match(options.startClick?.selector ?? '', /channel-item/);
    assert.equal(options.cardSelector, 'app-web-player-view video');
    assert.deepEqual(options.media, {
        endEvent: 'playing',
        phaseEvents: ['loadedmetadata'],
    });
});

test('ends at the playing event, not when the video becomes visible, and records loadedmetadata on the way', async () => {
    const fixture = createPlaybackFixture();
    let video: HTMLVideoElement | null = null;
    fixture.channel.addEventListener('click', () => {
        video = mountVideo(fixture);
    });
    (fixture.channel.querySelector('.name') as HTMLElement).click();
    await settle();
    assert.ok(video, 'the app mounted a video');
    const mounted = video as HTMLVideoElement;
    assert.equal(
        fixture.state().terminal,
        null,
        'a visible video is not enough'
    );
    assert.deepEqual(fixture.bridgeCalls, [JOURNEY_PLAYBACK_START_SENTINEL_ID]);

    fire(fixture, mounted, 'loadedmetadata');
    await settle();
    const afterMetadata = fixture.state();
    assert.equal(afterMetadata.terminal, null);
    assert.equal(
        typeof afterMetadata.media?.phases['loadedmetadata'],
        'number'
    );

    // Mutations queued in the same task as the event still count: the
    // probe takes them synchronously at the event.
    mounted.setAttribute('data-state', 'playing');
    fire(fixture, mounted, 'playing');
    mounted.setAttribute('data-state', 'after');
    await settle();
    const state = fixture.state();
    assert.deepEqual(fixture.bridgeCalls, [
        JOURNEY_PLAYBACK_START_SENTINEL_ID,
        JOURNEY_PLAYBACK_END_SENTINEL_ID,
    ]);
    assert.ok(state.start && state.terminal && state.media?.element);
    assert.equal(state.start.targetTestId, 'channel-item');
    assert.equal(state.terminal.cardTag, 'video');
    assert.equal(state.terminal.cardCount, 1);
    assert.deepEqual(state.terminal.companionCounts, []);
    assert.equal(state.terminal.pathname, '/workspace/xtreams/playlist-1/live');
    // video mounted (1) + data-state=playing (1); the later change is not.
    assert.equal(state.counters.domMutations, 2);
    const metadataEpochMs = state.media.phases['loadedmetadata'] as number;
    assert.ok(state.start.epochMs <= metadataEpochMs);
    assert.ok(metadataEpochMs <= state.terminal.epochMs);
    assert.equal(state.media.phases['playing'], state.terminal.epochMs);
    assert.equal(state.media.element.paused, true);
    assert.equal(state.final, true);
    assert.equal(state.settle.status, 'disabled');
    assert.doesNotThrow(() => assertJourneyRendererProbeState(state));
});

test('ignores media events before the click and on other media elements', async () => {
    const fixture = createPlaybackFixture();
    const early = mountVideo(fixture);
    fire(fixture, early, 'loadedmetadata');
    fire(fixture, early, 'playing');
    await settle();
    assert.equal(fixture.state().start, null);
    assert.equal(fixture.state().terminal, null);

    fixture.channel.click();
    const preview = fixture.window.document.createElement('video');
    fixture.window.document.body.append(preview);
    fire(fixture, preview, 'playing');
    await settle();
    const state = fixture.state();
    assert.ok(state.start);
    assert.equal(state.terminal, null);
    assert.deepEqual(state.media?.phases, {});
    assert.deepEqual(fixture.bridgeCalls, [JOURNEY_PLAYBACK_START_SENTINEL_ID]);
});

test('counts shifts and long tasks up to the playing event, not to the post-paint cutoff', async () => {
    const fixture = createPlaybackFixture();
    const [layoutShift, longTask] = fixture.observers as [
        FakeObserver,
        FakeObserver,
    ];
    const now = () => fixture.window.performance.now();
    fixture.channel.click();
    const video = mountVideo(fixture);
    layoutShift.emit([
        {
            entryType: 'layout-shift',
            hadRecentInput: true,
            startTime: now(),
            value: 0.004,
        },
    ]);
    longTask.emit([{ duration: 80, entryType: 'longtask', startTime: now() }]);
    // Leave room between the click and the event for the entries below.
    await new Promise((resolve) => setTimeout(resolve, 20));
    fire(fixture, video, 'playing');
    const playingMs =
        (fixture.rawState().terminal?.epochMs ?? 0) -
        fixture.window.performance.timeOrigin;
    // Delivered after the event: one started before it, one after.
    layoutShift.emit([
        {
            entryType: 'layout-shift',
            hadRecentInput: false,
            startTime: playingMs - 1,
            value: 0.002,
        },
        {
            entryType: 'layout-shift',
            hadRecentInput: false,
            startTime: playingMs + 5,
            value: 0.5,
        },
    ]);
    longTask.emit([
        // The task that dispatched `playing` began before it and counts.
        { duration: 60, entryType: 'longtask', startTime: playingMs - 10 },
        { duration: 300, entryType: 'longtask', startTime: playingMs + 5 },
    ]);
    await settle();
    const state = fixture.state();
    assert.equal(state.final, true);
    assert.equal(state.counters.recentInputLayoutShiftScore, 0.004);
    assert.equal(state.counters.layoutShiftScore, 0.002);
    assert.equal(state.counters.longTasks, 2);
    assert.deepEqual(state.longTaskDurationsMs, [80, 60]);
    assert.ok((state.firstCardPaintEpochMs ?? 0) >= state.terminal!.epochMs);
});

test('a media terminal without a click start is invalid', () => {
    const fixture = createPlaybackFixture({ startClick: undefined });
    assert.ok(
        fixture
            .state()
            .invalidReasons.includes('media-terminal-needs-start-click')
    );
});

test('other journeys carry no media block', () => {
    const fixture = createPlaybackFixture({ media: undefined });
    assert.equal(fixture.state().media, null);
});
