import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    buildLoopingEmbedUrl,
    canAutoplayTrailer,
    HeroTrailerBackdropComponent,
    TRAILER_BACKDROP_IDLE_MS,
} from './hero-trailer-backdrop.component';
import { TrailerDialogState } from './trailer-dialog-state';

const EMBED = 'https://www.youtube-nocookie.com/embed/abc123def';

describe('HeroTrailerBackdropComponent', () => {
    let fixture: ComponentFixture<HeroTrailerBackdropComponent>;
    let reducedMotion: boolean;
    const originalMatchMedia = window.matchMedia;

    beforeEach(async () => {
        jest.useFakeTimers();
        reducedMotion = false;
        window.matchMedia = jest.fn().mockImplementation(() => ({
            matches: reducedMotion,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        }));
        await TestBed.configureTestingModule({
            imports: [HeroTrailerBackdropComponent, TranslateModule.forRoot()],
        }).compileComponents();
        fixture = TestBed.createComponent(HeroTrailerBackdropComponent);
        fixture.componentRef.setInput('embedUrl', EMBED);
        fixture.componentRef.setInput('title', 'Black Harbor');
    });

    afterEach(() => {
        jest.useRealTimers();
        window.matchMedia = originalMatchMedia;
    });

    function host(): HTMLElement {
        return fixture.nativeElement as HTMLElement;
    }

    /** jsdom reports an unfocused document until something is focused. */
    function renderFocused(): void {
        fixture.detectChanges();
        window.dispatchEvent(new Event('focus'));
        fixture.detectChanges();
    }

    it('starts the muted loop after the idle delay and toggles the sound', () => {
        renderFocused();
        expect(host().querySelector('iframe')).toBeNull();

        jest.advanceTimersByTime(TRAILER_BACKDROP_IDLE_MS);
        fixture.detectChanges();
        const frame = host().querySelector('iframe');
        expect(frame).not.toBeNull();
        expect(frame?.getAttribute('src')).toContain('autoplay=1');
        expect(frame?.getAttribute('src')).toContain('mute=1');
        expect(frame?.getAttribute('src')).toContain('playlist=abc123def');

        const postMessage = jest.fn();
        Object.defineProperty(frame, 'contentWindow', {
            value: { postMessage },
            configurable: true,
        });
        fixture.componentInstance.toggleMute();
        fixture.detectChanges();
        expect(postMessage).toHaveBeenCalledWith(
            expect.stringContaining('"unMute"'),
            '*'
        );
        expect(fixture.componentInstance.muted()).toBe(false);
    });

    it('never starts under reduced motion', () => {
        reducedMotion = true;
        renderFocused();
        jest.advanceTimersByTime(TRAILER_BACKDROP_IDLE_MS * 2);
        fixture.detectChanges();
        expect(host().querySelector('iframe')).toBeNull();
    });

    it('drops the frame and waits again, muted, when the trailer changes', () => {
        renderFocused();
        jest.advanceTimersByTime(TRAILER_BACKDROP_IDLE_MS);
        fixture.detectChanges();
        fixture.componentInstance.toggleMute();
        fixture.detectChanges();
        expect(fixture.componentInstance.muted()).toBe(false);

        fixture.componentRef.setInput(
            'embedUrl',
            'https://www.youtube-nocookie.com/embed/next456'
        );
        fixture.detectChanges();
        // No mounted frame may autoplay the next URL at once.
        expect(host().querySelector('iframe')).toBeNull();

        jest.advanceTimersByTime(TRAILER_BACKDROP_IDLE_MS);
        fixture.detectChanges();
        expect(host().querySelector('iframe')?.getAttribute('src')).toContain(
            'playlist=next456'
        );
        expect(fixture.componentInstance.muted()).toBe(true);
    });

    it('stops while the document is hidden', () => {
        renderFocused();
        jest.advanceTimersByTime(TRAILER_BACKDROP_IDLE_MS);
        fixture.detectChanges();
        expect(host().querySelector('iframe')).not.toBeNull();

        const visibility = jest
            .spyOn(document, 'visibilityState', 'get')
            .mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        fixture.detectChanges();
        expect(host().querySelector('iframe')).toBeNull();
        visibility.mockRestore();
    });

    it('stops while the trailer modal is open and waits again afterwards', () => {
        renderFocused();
        jest.advanceTimersByTime(TRAILER_BACKDROP_IDLE_MS);
        fixture.detectChanges();
        expect(host().querySelector('iframe')).not.toBeNull();

        // The modal plays its own copy; an unmuted backdrop would sound
        // underneath it.
        const dialogs = TestBed.inject(TrailerDialogState);
        dialogs.opened();
        fixture.detectChanges();
        expect(host().querySelector('iframe')).toBeNull();

        dialogs.closed();
        fixture.detectChanges();
        expect(host().querySelector('iframe')).toBeNull();
        jest.advanceTimersByTime(TRAILER_BACKDROP_IDLE_MS);
        fixture.detectChanges();
        expect(host().querySelector('iframe')).not.toBeNull();
        expect(fixture.componentInstance.muted()).toBe(true);
    });

    it('stops when the window loses focus', () => {
        renderFocused();
        jest.advanceTimersByTime(TRAILER_BACKDROP_IDLE_MS);
        fixture.detectChanges();
        expect(host().querySelector('iframe')).not.toBeNull();

        window.dispatchEvent(new Event('blur'));
        fixture.detectChanges();
        expect(host().querySelector('iframe')).toBeNull();
    });
});

describe('trailer backdrop helpers', () => {
    it('builds a looping, muted, controls-free embed with the JS API', () => {
        const url = new URL(buildLoopingEmbedUrl(EMBED));
        expect(url.searchParams.get('loop')).toBe('1');
        expect(url.searchParams.get('controls')).toBe('0');
        expect(url.searchParams.get('enablejsapi')).toBe('1');
        expect(url.searchParams.get('playlist')).toBe('abc123def');
    });

    it('respects a metered connection', () => {
        const original = Object.getOwnPropertyDescriptor(
            navigator,
            'connection'
        );
        Object.defineProperty(navigator, 'connection', {
            value: { saveData: true },
            configurable: true,
        });
        expect(canAutoplayTrailer()).toBe(false);
        if (original) {
            Object.defineProperty(navigator, 'connection', original);
        } else {
            delete (navigator as { connection?: unknown }).connection;
        }
    });
});
