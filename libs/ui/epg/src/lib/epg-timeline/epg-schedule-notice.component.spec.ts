import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
import { EpgScheduleNoticeComponent } from './epg-schedule-notice.component';

const NOTICE = 'EPG.TIMELINE.SCHEDULE_ONLY_NOTICE';

describe('EpgScheduleNoticeComponent', () => {
    function create() {
        TestBed.configureTestingModule({
            imports: [EpgScheduleNoticeComponent],
            providers: [
                {
                    provide: TranslateService,
                    useValue: {
                        currentLang: 'en',
                        defaultLang: 'en',
                        onLangChange: new BehaviorSubject(null),
                        onTranslationChange: new BehaviorSubject(null),
                        onDefaultLangChange: new BehaviorSubject(null),
                        get: (key: string) => of(key),
                    },
                },
            ],
        });
        const fixture = TestBed.createComponent(EpgScheduleNoticeComponent);
        fixture.detectChanges();
        const button = fixture.nativeElement.querySelector(
            'button'
        ) as HTMLButtonElement;
        const overlay = TestBed.inject(OverlayContainer).getContainerElement();
        return { fixture, button, overlay };
    }

    afterEach(() => TestBed.inject(OverlayContainer).ngOnDestroy());

    it('is a collapsed button named by the notice text', () => {
        const { button } = create();
        expect(button.getAttribute('aria-label')).toBe(NOTICE);
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(button.hasAttribute('aria-controls')).toBe(false);
    });

    it('opens the text in a popover on click and closes it with Escape', () => {
        const { fixture, button, overlay } = create();

        button.click();
        fixture.detectChanges();
        const popover = overlay.querySelector('.epg-schedule-notice__popover');
        expect(popover?.textContent?.trim()).toBe(NOTICE);
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(button.getAttribute('aria-controls')).toBe(popover?.id);

        document.body.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        fixture.detectChanges();
        expect(overlay.querySelector('.epg-schedule-notice__popover')).toBe(
            null
        );
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(button);
    });

    it('toggles closed on a second click', () => {
        const { fixture, button, overlay } = create();
        button.click();
        fixture.detectChanges();
        button.click();
        fixture.detectChanges();
        expect(overlay.querySelector('.epg-schedule-notice__popover')).toBe(
            null
        );
    });
});
