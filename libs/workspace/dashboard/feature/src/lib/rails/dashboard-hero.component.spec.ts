import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DashboardHeroComponent } from './dashboard-hero.component';
import { DashboardHeroSlidesPresenter } from './dashboard-hero-slides.presenter';
import type { DashboardHeroSlide } from './dashboard-hero.utils';

const slide = (id: string, title: string): DashboardHeroSlide => ({
    id,
    kind: 'continue',
    contentType: 'movie',
    title,
    typeLabelKey: 'WORKSPACE.DASHBOARD.TYPE_MOVIE',
    reasonLabelKey: 'WORKSPACE.DASHBOARD.CONTINUE_WATCHING',
    episodeBadge: null,
    rating: null,
    genres: [],
    year: null,
    source: 'Source',
    programmeTitle: null,
    category: null,
    timeRange: null,
    description: null,
    progress: null,
    accentHue: 200,
    backdropSource: 'fallback',
    fallbackBackdropBackground: 'none',
    fallbackPosterBackground: 'none',
    hasBackdrop: false,
    primaryAction: {
        labelKey: 'WORKSPACE.DASHBOARD.HERO_CONTINUE',
        icon: 'play_arrow',
        link: ['/workspace', id],
        testId: 'dashboard-hero-primary-action',
    },
    secondaryAction: null,
});

describe('DashboardHeroComponent', () => {
    let fixture: ComponentFixture<DashboardHeroComponent>;
    let slides: ReturnType<typeof signal<DashboardHeroSlide[]>>;
    let reducedMotion: boolean;

    const host = () => fixture.nativeElement as HTMLElement;
    const activeTitle = () =>
        host().querySelector('[data-test-id=dashboard-hero-slide] h1')
            ?.textContent;
    const dots = () =>
        Array.from(
            host().querySelectorAll<HTMLButtonElement>(
                '[data-test-id=dashboard-hero-dot]'
            )
        );
    const finishActiveDot = () => {
        const fill = host().querySelector(
            '.hero__dot--active .hero__dot-fill'
        ) as HTMLElement;
        fill.dispatchEvent(new Event('animationend'));
        fixture.detectChanges();
    };

    function render(): void {
        window.matchMedia = jest.fn().mockReturnValue({
            matches: reducedMotion,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        });
        TestBed.configureTestingModule({
            imports: [DashboardHeroComponent, TranslateModule.forRoot()],
            providers: [provideRouter([])],
        });
        TestBed.overrideComponent(DashboardHeroComponent, {
            set: {
                providers: [
                    {
                        provide: DashboardHeroSlidesPresenter,
                        useValue: {
                            slides,
                            loading: signal(false),
                            markImageFailed: jest.fn(),
                        },
                    },
                ],
            },
        });
        fixture = TestBed.createComponent(DashboardHeroComponent);
        fixture.detectChanges();
    }

    beforeEach(() => {
        reducedMotion = false;
        slides = signal([
            slide('a', 'First'),
            slide('b', 'Second'),
            slide('c', 'Third'),
        ]);
    });

    it('advances when the active dot finishes its rotation interval', () => {
        render();
        expect(activeTitle()).toBe('First');

        finishActiveDot();
        expect(activeTitle()).toBe('Second');

        finishActiveDot();
        finishActiveDot();
        expect(activeTitle()).toBe('First');
    });

    it('does not advance while the pointer or focus is inside the hero', () => {
        render();
        const section = host().querySelector(
            '[data-test-id=dashboard-hero]'
        ) as HTMLElement;

        section.dispatchEvent(new Event('mouseenter'));
        fixture.detectChanges();
        expect(section.classList).toContain('hero--paused');
        finishActiveDot();
        expect(activeTitle()).toBe('First');

        section.dispatchEvent(new Event('mouseleave'));
        fixture.detectChanges();
        finishActiveDot();
        expect(activeTitle()).toBe('Second');
    });

    it('lets the user pause and resume the rotation', () => {
        render();
        const pause = host().querySelector(
            '[data-test-id=dashboard-hero-pause]'
        ) as HTMLButtonElement;

        pause.click();
        fixture.detectChanges();
        expect(pause.getAttribute('aria-pressed')).toBe('true');
        finishActiveDot();
        expect(activeTitle()).toBe('First');

        pause.click();
        fixture.detectChanges();
        finishActiveDot();
        expect(activeTitle()).toBe('Second');
    });

    it('switches slides from the dots, with roving arrow keys', () => {
        render();

        dots()[2].click();
        fixture.detectChanges();
        expect(activeTitle()).toBe('Third');
        expect(dots()[2].getAttribute('aria-current')).toBe('true');
        expect(dots()[2].tabIndex).toBe(0);
        expect(dots()[0].tabIndex).toBe(-1);

        dots()[2].dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight' })
        );
        fixture.detectChanges();
        expect(activeTitle()).toBe('First');
    });

    it('keeps the current slide when a slide arrives late', () => {
        render();
        dots()[1].click();
        fixture.detectChanges();

        slides.set([
            slide('a', 'First'),
            slide('live', 'Live channel'),
            slide('b', 'Second'),
            slide('c', 'Third'),
        ]);
        fixture.detectChanges();

        expect(activeTitle()).toBe('Second');
        expect(dots()).toHaveLength(4);
    });

    it('never auto-rotates under reduced motion, but the dots still work', () => {
        reducedMotion = true;
        render();

        expect(
            host().querySelector('[data-test-id=dashboard-hero-pause]')
        ).toBeNull();
        finishActiveDot();
        expect(activeTitle()).toBe('First');

        dots()[1].click();
        fixture.detectChanges();
        expect(activeTitle()).toBe('Second');
    });

    it('renders a single slide without rotation controls', () => {
        slides.set([slide('a', 'Only')]);
        render();

        expect(activeTitle()).toBe('Only');
        expect(dots()).toHaveLength(0);
        expect(
            host()
                .querySelector('[data-test-id=dashboard-hero-primary-action]')
                ?.getAttribute('href')
        ).toBe('/workspace/a');
    });

    it('renders nothing when there is nothing to feature', () => {
        slides.set([]);
        render();

        expect(
            host().querySelector('[data-test-id=dashboard-hero]')
        ).toBeNull();
    });
});
