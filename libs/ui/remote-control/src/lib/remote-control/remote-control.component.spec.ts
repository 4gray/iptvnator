import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RemoteControlComponent } from './remote-control.component';
import {
    RemoteControlService,
    RemoteControlStatus,
} from './remote-control.service';

const GERMAN = {
    REMOTE_CONTROL: {
        NOW_PLAYING: 'Läuft gerade',
        SOURCE_XTREAM: 'Xtream live',
        WAITING_FOR_PLAYBACK: 'Warte auf Wiedergabe',
        UNKNOWN_SOURCE: 'unbekannt',
        NO_STREAM: 'Kein Livestream ausgewählt',
        NO_PROGRAM: 'Keine aktuelle Sendung',
        CHANNEL_ABBR: 'K',
        UP_CHANNEL: 'Kanal hoch',
        MUTE: 'STUMM',
        VOLUME_UNAVAILABLE: 'Lautstärke nicht verfügbar',
        WAITING_FOR_STATUS: 'Warte auf Status…',
        ERRORS: { CHANNEL_UP: 'Kanalwechsel fehlgeschlagen' },
    },
};

describe('RemoteControlComponent', () => {
    let fixture: ComponentFixture<RemoteControlComponent>;
    let service: {
        getStatus: jest.Mock<Promise<RemoteControlStatus>>;
        channelUp: jest.Mock<Promise<void>>;
    };

    const text = (selector: string): string =>
        (
            fixture.nativeElement.querySelector(selector) as HTMLElement | null
        )?.textContent?.trim() ?? '';

    beforeEach(async () => {
        jest.useFakeTimers();
        service = {
            getStatus: jest
                .fn()
                .mockResolvedValue({ portal: 'unknown', isLiveView: false }),
            channelUp: jest.fn().mockRejectedValue(new Error('offline')),
        };

        await TestBed.configureTestingModule({
            imports: [RemoteControlComponent, TranslateModule.forRoot()],
            providers: [{ provide: RemoteControlService, useValue: service }],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('de', GERMAN);
        translate.use('de');

        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        // The first status answer stays pending through the first render.
        let answerFirstStatus!: (status: RemoteControlStatus) => void;
        service.getStatus.mockReturnValueOnce(
            new Promise((resolve) => (answerFirstStatus = resolve))
        );
        fixture = TestBed.createComponent(RemoteControlComponent);
        fixture.detectChanges();
        answerFirstStatus({ portal: 'unknown', isLiveView: false });
        await settle();
    });

    /**
     * The component keeps plain fields, so in this zoneless test bed a
     * resolved status request neither schedules nor dirties a render (the
     * app itself runs Zone.js): flush it on the fake clock, mark the view,
     * then render.
     */
    async function settle(milliseconds = 0): Promise<void> {
        await jest.advanceTimersByTimeAsync(milliseconds);
        fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck();
        fixture.detectChanges();
    }

    afterEach(() => {
        fixture.destroy();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('renders its labels in the active language', () => {
        expect(text('.now-card__label')).toBe('Läuft gerade');
        expect(text('.now-card__statusline')).toBe('Warte auf Wiedergabe');
        expect(text('.now-card__channel')).toBe('Kein Livestream ausgewählt');
        expect(text('.now-card__meta')).toContain('unbekannt');
        expect(text('.now-card__program')).toBe('Keine aktuelle Sendung');
        expect(text('.volume-row__button--mute')).toBe('STUMM');
        expect(text('.volume-caption')).toBe('Lautstärke nicht verfügbar');
        expect(text('.remote__footer')).toBe('Warte auf Status…');
        expect(
            fixture.nativeElement
                .querySelector('.touchpad__button--up')
                .getAttribute('aria-label')
        ).toBe('Kanal hoch');
    });

    it('names the source of the current playback', async () => {
        service.getStatus.mockResolvedValue({
            portal: 'xtream',
            isLiveView: true,
            channelNumber: 7,
        });
        await settle(2000);

        expect(text('.now-card__statusline')).toBe('Xtream live');
        expect(text('.now-card__meta')).toContain('K 7');
        expect(text('.now-card__meta')).toContain('xtream');
    });

    it('shows a failed action in the active language', async () => {
        await fixture.componentInstance.changeChannelUp();
        await settle();

        expect(text('.remote__error')).toBe('Kanalwechsel fehlgeschlagen');
    });
});
