import { provideZonelessChangeDetection } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RemoteControlComponent } from './remote-control.component';
import {
    RemoteControlService,
    RemoteControlStatus,
} from './remote-control.service';

const english = {
    REMOTE_CONTROL: {
        TITLE: 'Remote control',
        SUBTITLE: 'Control your IPTV player remotely',
        UP_CHANNEL: 'Previous channel',
        DOWN_CHANNEL: 'Next channel',
        NOW_PLAYING: 'Now playing',
        EXECUTING: 'Executing',
        SOURCE_M3U: 'M3U live',
        SOURCE_XTREAM: 'Xtream live',
        SOURCE_STALKER: 'Stalker live',
        WAITING_FOR_PLAYBACK: 'Waiting for playback',
        UNKNOWN_SOURCE: 'unknown',
        NO_STREAM: 'No live stream selected',
        NO_PROGRAM: 'No current EPG program',
        CHANNEL_ABBR: 'CH',
        CHANNEL_NAVIGATION: 'Channel navigation',
        CHANNEL_NUMBER: 'Channel number',
        KEYPAD_DELETE: 'DEL',
        KEYPAD_CLEAR: 'CLR',
        VOLUME: 'Volume',
        VOLUME_ABBR: 'VOL',
        MUTE: 'MUTE',
        UNMUTE: 'UNMUTE',
        VOLUME_UNAVAILABLE: 'Volume control unavailable for this player mode',
        SYNCING_STATUS: 'Syncing status…',
        UPDATED_AT: 'Updated {{time}}',
        WAITING_FOR_STATUS: 'Waiting for status…',
        ERRORS: {
            CHANNEL_UP: 'Failed to switch to the previous channel',
            CHANNEL_DOWN: 'Failed to switch to the next channel',
            SELECT_NUMBER: 'Failed to switch by channel number',
            VOLUME_UP: 'Failed to increase volume',
            VOLUME_DOWN: 'Failed to decrease volume',
            TOGGLE_MUTE: 'Failed to toggle mute',
            STATUS: 'Failed to fetch remote status',
        },
        HEADER: 'IPTVNator Remote Control',
        FOOTER: 'IPTVNator Remote Control',
    },
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function status(channelName: string): RemoteControlStatus {
    return {
        portal: 'm3u',
        isLiveView: true,
        channelName,
        channelNumber: 3,
        supportsVolume: true,
        volume: 0.5,
        updatedAt: '2026-09-14T10:00:00Z',
    };
}

describe('RemoteControlComponent asynchronous rendering', () => {
    let fixture: ComponentFixture<RemoteControlComponent>;
    let initial: ReturnType<typeof deferred<RemoteControlStatus>>;
    let poll: () => void;
    let clearIntervalSpy: jest.SpyInstance;
    let service: {
        getStatus: jest.Mock;
        channelUp: jest.Mock;
        selectChannelByNumber: jest.Mock;
    };

    const text = (selector: string): string =>
        fixture.nativeElement.querySelector(selector)?.textContent.trim() ?? '';
    const button = (selector: string): HTMLButtonElement =>
        fixture.nativeElement.querySelector(selector);
    // Settle promise continuations, then let Angular's notification scheduler render.
    // Never force change detection after an asynchronous response.
    async function settle(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
        await fixture.whenStable();
    }
    async function loadInitial(): Promise<void> {
        initial.resolve(status('Initial channel'));
        await settle();
    }

    beforeEach(async () => {
        initial = deferred<RemoteControlStatus>();
        service = {
            getStatus: jest.fn().mockReturnValue(initial.promise),
            channelUp: jest.fn(),
            selectChannelByNumber: jest.fn(),
        };
        jest.spyOn(window, 'setInterval').mockImplementation((callback) => {
            poll = callback as () => void;
            return 123 as unknown as ReturnType<typeof setInterval>;
        });
        clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        await TestBed.configureTestingModule({
            imports: [RemoteControlComponent, TranslateModule.forRoot()],
            providers: [
                provideZonelessChangeDetection(),
                { provide: RemoteControlService, useValue: service },
            ],
        }).compileComponents();
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', english);
        translate.use('en');
        fixture = TestBed.createComponent(RemoteControlComponent);
        await fixture.whenStable();
    });

    afterEach(() => {
        fixture.destroy();
        jest.restoreAllMocks();
    });

    it('renders deferred initial status and finishes syncing without interaction', async () => {
        expect(text('.remote__footer')).toContain('Syncing status');
        await loadInitial();
        expect(text('.now-card__channel')).toBe('Initial channel');
        expect(text('.remote__footer')).toContain('Updated');
        expect(text('.volume-caption')).toBe('50%');
    });

    it('renders an initial status failure and finishes syncing', async () => {
        initial.reject(new Error('offline'));
        await settle();
        expect(text('.remote__error')).toBe('Failed to fetch remote status');
        expect(text('.remote__footer')).toBe('Waiting for status…');
    });

    it('renders a silent interval response without showing the syncing indicator', async () => {
        await loadInitial();
        const response = deferred<RemoteControlStatus>();
        service.getStatus.mockReturnValueOnce(response.promise);
        poll();
        await settle();
        expect(text('.remote__footer')).not.toContain('Syncing');
        response.resolve({
            ...status('Polled channel'),
            volume: 0.8,
            muted: true,
        });
        await settle();
        expect(text('.now-card__channel')).toBe('Polled channel');
        expect(text('.volume-caption')).toBe('80%');
        expect(text('.volume-row__button--mute')).toBe('UNMUTE');
    });

    it('renders action progress and its deferred fresh status, then enables controls', async () => {
        await loadInitial();
        const action = deferred<void>();
        const response = deferred<RemoteControlStatus>();
        service.channelUp.mockReturnValueOnce(action.promise);
        service.getStatus.mockReturnValueOnce(response.promise);
        button('.touchpad__button--up').click();
        await settle();
        expect(text('.now-card__statusline')).toContain('Executing');
        expect(button('.touchpad__button--up').disabled).toBe(true);
        action.resolve();
        await settle();
        expect(button('.touchpad__button--up').disabled).toBe(true);
        response.resolve(status('Next channel'));
        await settle();
        expect(text('.now-card__channel')).toBe('Next channel');
        expect(button('.touchpad__button--up').disabled).toBe(false);
        expect(text('.now-card__statusline')).toContain('M3U live');
    });

    it('renders a deferred action error and enables controls', async () => {
        await loadInitial();
        const action = deferred<void>();
        service.channelUp.mockReturnValueOnce(action.promise);
        button('.touchpad__button--up').click();
        await settle();
        action.reject(new Error('offline'));
        await settle();
        expect(text('.remote__error')).toBe(
            'Failed to switch to the previous channel'
        );
        expect(button('.touchpad__button--up').disabled).toBe(false);
    });

    it('clears channel digits after deferred selection without another click', async () => {
        await loadInitial();
        const action = deferred<void>();
        const response = deferred<RemoteControlStatus>();
        service.selectChannelByNumber.mockReturnValueOnce(action.promise);
        service.getStatus.mockReturnValueOnce(response.promise);
        button('.keypad__key').click();
        await settle();
        button('.keypad__key--go').click();
        await settle();
        expect(service.selectChannelByNumber).toHaveBeenCalledWith(1);
        action.resolve();
        await settle();
        response.resolve(status('Selected channel'));
        await settle();
        expect(text('.digit-display')).toBe('----');
        expect(button('.keypad__key--go').disabled).toBe(true);
    });

    it('prevents an older poll from replacing the action status', async () => {
        await loadInitial();
        const oldPoll = deferred<RemoteControlStatus>();
        const action = deferred<void>();
        const actionStatus = deferred<RemoteControlStatus>();
        service.getStatus
            .mockReturnValueOnce(oldPoll.promise)
            .mockReturnValueOnce(actionStatus.promise);
        poll();
        service.channelUp.mockReturnValueOnce(action.promise);
        button('.touchpad__button--up').click();
        await settle();
        action.resolve();
        await settle();
        actionStatus.resolve(status('Action channel'));
        await settle();
        oldPoll.resolve(status('Stale channel'));
        await settle();
        expect(fixture.componentInstance.status?.channelName).toBe(
            'Action channel'
        );
        expect(text('.now-card__channel')).toBe('Action channel');
    });

    it('skips overlapping interval requests and polls while an action is pending', async () => {
        await loadInitial();
        const response = deferred<RemoteControlStatus>();
        const action = deferred<void>();
        service.getStatus.mockReturnValueOnce(response.promise);
        poll();
        poll();
        expect(service.getStatus).toHaveBeenCalledTimes(2);
        response.resolve(status('Polled channel'));
        await settle();
        service.channelUp.mockReturnValueOnce(action.promise);
        button('.touchpad__button--up').click();
        await settle();
        poll();
        expect(service.getStatus).toHaveBeenCalledTimes(2);
        action.reject(new Error('offline'));
        await settle();
    });

    it('resumes polling after a status request rejects', async () => {
        await loadInitial();
        const stalled = deferred<RemoteControlStatus>();
        const recovered = deferred<RemoteControlStatus>();
        service.getStatus
            .mockReturnValueOnce(stalled.promise)
            .mockReturnValueOnce(recovered.promise);
        poll();
        stalled.reject(new Error('Status request timed out'));
        await settle();
        poll();
        expect(service.getStatus).toHaveBeenCalledTimes(3);
        recovered.resolve(status('Recovered channel'));
        await settle();
        expect(text('.now-card__channel')).toBe('Recovered channel');
    });

    it('clears the interval and ignores a status response after destruction', async () => {
        fixture.destroy();
        initial.resolve(status('Too late'));
        await settle();
        expect(clearIntervalSpy).toHaveBeenCalledWith(123);
        expect(fixture.componentInstance.status).toBeNull();
        poll();
        expect(service.getStatus).toHaveBeenCalledTimes(1);
    });

    it('does not refresh status or clear digits after a destroyed selection completes', async () => {
        await loadInitial();
        const action = deferred<void>();
        service.selectChannelByNumber.mockReturnValueOnce(action.promise);
        button('.keypad__key').click();
        await settle();
        button('.keypad__key--go').click();
        await settle();
        fixture.destroy();
        action.resolve();
        await settle();
        expect(service.getStatus).toHaveBeenCalledTimes(1);
        expect(fixture.componentInstance.numericInput).toBe('1');
    });
});
