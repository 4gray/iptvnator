import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
import { EpgTimelineComponent } from './epg-timeline.component';

function currentProgram(): EpgProgram {
    const start = new Date();
    const stop = new Date(start.getTime() + 60 * 60_000);
    return {
        start: start.toISOString(),
        stop: stop.toISOString(),
        channel: 'ch',
        title: 'Synthetic Now',
        desc: null,
        category: null,
    };
}

/** The toolbar of the inline timeline: labels, notice and button roles. */
describe('EpgTimelineComponent toolbar', () => {
    let fixture: ComponentFixture<EpgTimelineComponent>;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [EpgTimelineComponent],
            providers: [
                {
                    provide: MatDialog,
                    useValue: {
                        open: () => ({ afterClosed: () => of(undefined) }),
                    },
                },
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
        fixture = TestBed.createComponent(EpgTimelineComponent);
    });

    function render(inputs: Record<string, unknown>): HTMLElement {
        for (const [key, value] of Object.entries(inputs)) {
            fixture.componentRef.setInput(key, value);
        }
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    const toolbar = (root: HTMLElement) =>
        root.querySelector('.epg-timeline__toolbar') as HTMLElement;

    it('labels a source-less host with the translated guide title', () => {
        const root = render({ channelName: 'Synthetic One', collapsed: true });
        expect(
            root.querySelector('.epg-timeline__source')?.textContent?.trim()
        ).toBe('EPG.GUIDE.TITLE');
    });

    it('keeps a host-provided source label', () => {
        const root = render({
            channelName: 'Synthetic One',
            collapsed: true,
            sourceLabel: 'Synthetic Portal',
        });
        expect(
            root.querySelector('.epg-timeline__source')?.textContent?.trim()
        ).toBe('Synthetic Portal');
    });

    it('shows the schedule-only notice as a toolbar button, not a row', () => {
        const root = render({
            programs: [currentProgram()],
            archivePlaybackAvailable: false,
        });
        expect(root.querySelector('.epg-timeline__notice')).toBeNull();
        expect(
            toolbar(root).querySelector('app-epg-schedule-notice button')
        ).not.toBeNull();
    });

    it('drops the notice when catch-up is available', () => {
        const root = render({
            programs: [currentProgram()],
            archivePlaybackAvailable: true,
        });
        expect(root.querySelector('app-epg-schedule-notice')).toBeNull();
    });

    it('renders guide, now and zoom as kit icon buttons', () => {
        const root = render({
            programs: [currentProgram()],
            guideAvailable: true,
        });
        const buttons = Array.from(
            toolbar(root).querySelectorAll('.epg-timeline__iconbtn')
        );
        expect(buttons).toHaveLength(3);
        for (const button of buttons) {
            expect(button.classList).toContain('mat-mdc-icon-button');
        }
    });
});
