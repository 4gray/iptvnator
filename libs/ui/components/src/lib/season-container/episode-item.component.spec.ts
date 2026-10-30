import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { EpisodeItemComponent } from './episode-item.component';
import { SeasonDownloadPresenter } from './season-download-presenter';

const episode = (info: Record<string, unknown> = {}): XtreamSerieEpisode =>
    ({
        id: '101',
        episode_num: 3,
        title: 'Episode 3',
        container_extension: 'mp4',
        info: { plot: 'A plot', duration_secs: 2760, ...info },
        custom_sid: '',
        added: '',
        season: 1,
        direct_source: '',
    }) as XtreamSerieEpisode;

const position = (positionSeconds: number): PlaybackPositionData => ({
    contentXtreamId: 101,
    contentType: 'episode',
    positionSeconds,
    durationSeconds: 2760,
});

describe('EpisodeItemComponent', () => {
    let fixture: ComponentFixture<EpisodeItemComponent>;
    const el = () => fixture.nativeElement as HTMLElement;
    const q = (selector: string) => el().querySelector(selector);

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                EpisodeItemComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: SeasonDownloadPresenter,
                    useValue: { presentationVisible: () => false },
                },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(EpisodeItemComponent);
        fixture.componentRef.setInput('episode', episode());
    });

    it('renders an unstarted list row: number, runtime, no badge, no bar', () => {
        fixture.detectChanges();

        expect(el().classList).toContain('episode-list-item');
        expect(q('.episode-item__number')?.textContent?.trim()).toBe('3');
        expect(q('.episode-item__meta')?.textContent).toContain(
            'PORTALS.DETAIL.DURATION_MINUTES'
        );
        expect(q('.episode-item__badge')).toBeNull();
        expect(q('.episode-item__progress')).toBeNull();
    });

    it('shows the bar and the time left for a started episode', () => {
        fixture.componentRef.setInput('position', position(900));
        fixture.detectChanges();

        expect(el().classList).toContain('episode-item--in-progress');
        expect(
            (q('.episode-item__progress i') as HTMLElement).style.width
        ).toBe('33%');
        expect(q('.episode-item__meta')?.textContent).toContain(
            'WORKSPACE.DASHBOARD.REMAINING_MINUTES'
        );
        expect(q('.episode-item__badge')).toBeNull();
    });

    it('marks a watched episode with the badge and without a bar', () => {
        fixture.componentRef.setInput('position', position(2700));
        fixture.detectChanges();

        expect(el().classList).toContain('episode-item--watched');
        expect(q('[data-testid="episode-watched-badge"]')).not.toBeNull();
        expect(q('.episode-item__progress')).toBeNull();
        const toggle = q('[data-testid="episode-watched-toggle"]');
        expect(toggle?.getAttribute('aria-pressed')).toBe('true');
        expect(toggle?.classList).toContain(
            'episode-item__watched-toggle--watched'
        );
    });

    it('plays from the stretched target, but not while launching', () => {
        const played = jest.fn();
        fixture.componentInstance.played.subscribe(played);
        fixture.detectChanges();

        const target = q('[data-testid="episode-play-target"]') as HTMLElement;
        expect(target.tagName).toBe('BUTTON');
        target.click();
        expect(played).toHaveBeenCalledTimes(1);

        fixture.componentRef.setInput('launching', true);
        fixture.detectChanges();
        target.click();
        expect(played).toHaveBeenCalledTimes(1);
        expect(target.getAttribute('aria-disabled')).toBe('true');
    });

    it('emits the watched toggle without playing', () => {
        const played = jest.fn();
        const toggled = jest.fn();
        fixture.componentInstance.played.subscribe(played);
        fixture.componentInstance.watchedToggled.subscribe(toggled);
        fixture.detectChanges();

        (q('[data-testid="episode-watched-toggle"]') as HTMLElement).click();

        expect(toggled).toHaveBeenCalledTimes(1);
        expect(played).not.toHaveBeenCalled();
    });

    it('keeps the actions in the DOM for every row (reserved slot)', () => {
        fixture.detectChanges();
        expect(q('.episode-item__actions')).not.toBeNull();
        expect(q('[data-testid="episode-more-button"]')).not.toBeNull();
    });

    it('renders a grid card with a number chip instead of the number column', () => {
        fixture.componentRef.setInput('layout', 'grid');
        fixture.detectChanges();

        expect(el().classList).toContain('episode-card');
        expect(q('.episode-item__number')).toBeNull();
        expect(q('.episode-item__chip')?.textContent?.trim()).toBe('3');
    });

    it('dims the still when the season has no distinct stills', () => {
        fixture.componentRef.setInput(
            'episode',
            episode({ movie_image: 'poster.jpg' })
        );
        fixture.componentRef.setInput('showStill', false);
        fixture.detectChanges();

        expect(q('.episode-item__thumb--fallback img')).not.toBeNull();
    });

    it('leaves a failed still out', () => {
        fixture.componentRef.setInput(
            'episode',
            episode({ movie_image: 'broken.jpg' })
        );
        fixture.detectChanges();
        q('.episode-item__thumb img')?.dispatchEvent(new Event('error'));
        fixture.detectChanges();

        expect(q('.episode-item__thumb img')).toBeNull();
        expect(q('.episode-item__thumb--fallback')).not.toBeNull();
    });
    describe('bare row', () => {
        beforeEach(() => {
            fixture.componentRef.setInput(
                'episode',
                episode({ plot: '', movie_image: '' })
            );
            fixture.componentRef.setInput('bare', true);
        });

        it('drops the thumbnail and the description', () => {
            fixture.componentRef.setInput(
                'episode',
                episode({ plot: 'A plot' })
            );
            fixture.detectChanges();

            expect(el().classList).toContain('episode-item--bare');
            expect(q('.episode-item__thumb')).toBeNull();
            expect(q('.episode-item__description')).toBeNull();
            expect(q('.episode-item__number')?.textContent?.trim()).toBe('3');
            expect(q('[data-testid="episode-more-button"]')).not.toBeNull();
        });

        it('puts the watched check inline, without a bar', () => {
            fixture.componentRef.setInput('position', position(2760));
            fixture.detectChanges();

            expect(
                q('.episode-item__title-row .episode-item__inline-check')
            ).not.toBeNull();
            expect(q('.episode-item__inline-progress')).toBeNull();
        });

        it('puts a 72px bar inline for a started episode', () => {
            fixture.componentRef.setInput('position', position(900));
            fixture.detectChanges();

            expect(
                (q('.episode-item__inline-progress i') as HTMLElement).style
                    .width
            ).toBe('33%');
            expect(q('.episode-item__inline-check')).toBeNull();
        });

        it('shows the start in the number column while launching', () => {
            fixture.componentRef.setInput('launching', true);
            fixture.detectChanges();

            expect(
                q('.episode-item__number mat-progress-spinner')
            ).not.toBeNull();
        });
    });
});
