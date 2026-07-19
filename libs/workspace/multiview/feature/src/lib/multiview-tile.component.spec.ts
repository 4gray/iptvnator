import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import {
    MultiviewTileComponent,
    MultiviewTilePlayback,
} from './multiview-tile.component';

jest.mock('./multiview-tile-engine', () => {
    class MockMultiviewTileEngine {
        static instances: MockMultiviewTileEngine[] = [];
        readonly config: {
            video: HTMLVideoElement;
            url: string;
            onError: (diagnostic: unknown) => void;
        };
        start = jest.fn();
        destroy = jest.fn();

        constructor(config: MockMultiviewTileEngine['config']) {
            this.config = config;
            MockMultiviewTileEngine.instances.push(this);
        }
    }

    return { MultiviewTileEngine: MockMultiviewTileEngine };
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const MockEngine = jest.requireMock('./multiview-tile-engine')
    .MultiviewTileEngine as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const playback: MultiviewTilePlayback = {
    url: 'http://example.com/live.m3u8',
    title: 'Channel One',
    logo: 'http://example.com/logo.png',
};

describe('MultiviewTileComponent', () => {
    let fixture: ComponentFixture<MultiviewTileComponent>;

    beforeEach(async () => {
        MockEngine.instances.length = 0;
        await TestBed.configureTestingModule({
            imports: [MultiviewTileComponent, TranslateModule.forRoot()],
            providers: [provideNoopAnimations()],
        }).compileComponents();

        fixture = TestBed.createComponent(MultiviewTileComponent);
    });

    function video(): HTMLVideoElement {
        return fixture.nativeElement.querySelector('video');
    }

    it('creates and starts an engine when playback becomes available', () => {
        fixture.componentRef.setInput('playback', playback);
        fixture.detectChanges();

        expect(MockEngine.instances).toHaveLength(1);
        expect(MockEngine.instances[0].config.url).toBe(playback.url);
        expect(MockEngine.instances[0].config.video).toBe(video());
        expect(MockEngine.instances[0].start).toHaveBeenCalledTimes(1);
    });

    it('does not create an engine without playback', () => {
        fixture.detectChanges();

        expect(MockEngine.instances).toHaveLength(0);
    });

    it('destroys the previous engine when playback changes', () => {
        fixture.componentRef.setInput('playback', playback);
        fixture.detectChanges();

        fixture.componentRef.setInput('playback', {
            ...playback,
            url: 'http://example.com/other.m3u8',
        });
        fixture.detectChanges();

        expect(MockEngine.instances).toHaveLength(2);
        expect(MockEngine.instances[0].destroy).toHaveBeenCalled();
        expect(MockEngine.instances[1].start).toHaveBeenCalled();
    });

    it('destroys the engine when the component is destroyed', () => {
        fixture.componentRef.setInput('playback', playback);
        fixture.detectChanges();

        fixture.destroy();

        expect(MockEngine.instances[0].destroy).toHaveBeenCalled();
    });

    it('mutes and unmutes via the audioFocused input without touching localStorage', () => {
        const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
        fixture.componentRef.setInput('playback', playback);
        fixture.detectChanges();
        expect(video().muted).toBe(true);

        fixture.componentRef.setInput('audioFocused', true);
        fixture.detectChanges();
        expect(video().muted).toBe(false);
        expect(video().volume).toBe(1);

        fixture.componentRef.setInput('audioFocused', false);
        fixture.detectChanges();
        expect(video().muted).toBe(true);

        expect(setItemSpy).not.toHaveBeenCalledWith(
            'volume',
            expect.anything()
        );
        setItemSpy.mockRestore();
    });

    it('keeps a focused tile unmuted when its playback restarts', () => {
        fixture.componentRef.setInput('playback', playback);
        fixture.componentRef.setInput('audioFocused', true);
        fixture.detectChanges();

        fixture.componentRef.setInput('playback', {
            ...playback,
            url: 'http://example.com/retry.m3u8',
        });
        fixture.detectChanges();

        expect(video().muted).toBe(false);
    });

    it('emits focusRequested on click and openInPlayerRequested on dblclick', () => {
        const focusSpy = jest.fn();
        const openSpy = jest.fn();
        fixture.componentInstance.focusRequested.subscribe(focusSpy);
        fixture.componentInstance.openInPlayerRequested.subscribe(openSpy);
        fixture.componentRef.setInput('playback', playback);
        fixture.detectChanges();

        fixture.nativeElement.dispatchEvent(new MouseEvent('click'));
        expect(focusSpy).toHaveBeenCalledTimes(1);

        fixture.nativeElement.dispatchEvent(new MouseEvent('dblclick'));
        expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it('emits removeRequested from the header button without focusing', () => {
        const focusSpy = jest.fn();
        const removeSpy = jest.fn();
        fixture.componentInstance.focusRequested.subscribe(focusSpy);
        fixture.componentInstance.removeRequested.subscribe(removeSpy);
        fixture.componentRef.setInput('playback', playback);
        fixture.detectChanges();

        const removeButton: HTMLButtonElement =
            fixture.nativeElement.querySelector('.tile-remove');
        removeButton.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );

        expect(removeSpy).toHaveBeenCalledTimes(1);
        expect(focusSpy).not.toHaveBeenCalled();
    });

    it('shows the error state with a retry action', () => {
        const retrySpy = jest.fn();
        fixture.componentInstance.retryRequested.subscribe(retrySpy);
        fixture.componentRef.setInput('playback', playback);
        fixture.componentRef.setInput('status', 'error');
        fixture.detectChanges();

        const status = fixture.nativeElement.querySelector(
            '.tile-status--error'
        );
        expect(status).toBeTruthy();

        const retryButton: HTMLButtonElement =
            status.querySelector('button');
        retryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(retrySpy).toHaveBeenCalledTimes(1);
    });

    it('propagates engine errors through playbackFailed', () => {
        const failedSpy = jest.fn();
        fixture.componentInstance.playbackFailed.subscribe(failedSpy);
        fixture.componentRef.setInput('playback', playback);
        fixture.detectChanges();

        const diagnostic = { code: 'network-error' };
        MockEngine.instances[0].config.onError(diagnostic);

        expect(failedSpy).toHaveBeenCalledWith(diagnostic);
    });
});
