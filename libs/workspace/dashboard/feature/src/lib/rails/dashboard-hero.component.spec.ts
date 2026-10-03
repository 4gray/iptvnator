import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

    it('resumes on Play even while the button keeps the pointer and focus', () => {
        render();
        const section = host().querySelector(
            '[data-test-id=dashboard-hero]'
        ) as HTMLElement;
        const pause = host().querySelector(
            '[data-test-id=dashboard-hero-pause]'
        ) as HTMLButtonElement;
        section.dispatchEvent(new Event('mouseenter'));
        section.dispatchEvent(new FocusEvent('focusin'));

        pause.click();
        fixture.detectChanges();
        pause.click();
        fixture.detectChanges();

        expect(section.classList).not.toContain('hero--paused');
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

    it('keeps the first slide when a slide arrives ahead of it untouched', () => {
        slides.set([slide('fav', 'Favourite'), slide('added', 'Import')]);
        render();
        expect(activeTitle()).toBe('Favourite');

        slides.set([
            slide('live', 'Live channel'),
            slide('fav', 'Favourite'),
            slide('added', 'Import'),
        ]);
        fixture.detectChanges();

        expect(activeTitle()).toBe('Favourite');
    });

    it('shows the slide now at the same position when the active one goes', () => {
        render();
        dots()[1].click();
        fixture.detectChanges();

        slides.set([slide('a', 'First'), slide('c', 'Third')]);
        fixture.detectChanges();

        expect(activeTitle()).toBe('Third');
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

    it('positions the progress fill through a custom property, never its width', () => {
        // Animating width re-lays out the page on every live-EPG tick; the
        // stylesheet slides the fill with a transform driven by this property.
        slides.set([
            { ...slide('a', 'Live'), contentType: 'live', progress: 42 },
        ]);
        render();

        const fill = host().querySelector<HTMLElement>('.hero__progress i');
        expect(fill?.style.getPropertyValue('--hero-progress')).toBe('42');
        expect(fill?.style.width).toBe('');
    });

    it('renders nothing when there is nothing to feature', () => {
        slides.set([]);
        render();

        expect(
            host().querySelector('[data-test-id=dashboard-hero]')
        ).toBeNull();
    });

    it('switches slides with the arrow keys and follows Enter on the hero itself', () => {
        render();
        const section = host().querySelector(
            '[data-test-id=dashboard-hero]'
        ) as HTMLElement;
        expect(section.getAttribute('tabindex')).toBe('0');

        section.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
        );
        fixture.detectChanges();
        expect(activeTitle()).toBe('Second');

        section.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
        );
        fixture.detectChanges();
        expect(activeTitle()).toBe('First');

        const primary = host().querySelector<HTMLElement>(
            '[data-test-id=dashboard-hero-primary-action]'
        ) as HTMLElement;
        const clicked = jest.fn();
        primary.addEventListener('click', (event) => {
            event.preventDefault();
            clicked();
        });
        section.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
        expect(clicked).toHaveBeenCalledTimes(1);

        // Keys pressed inside a control belong to that control.
        const dot = dots()[0];
        dot.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
        expect(clicked).toHaveBeenCalledTimes(1);
    });

    it('pauses the rotation while the document is hidden', () => {
        const visibility = jest
            .spyOn(document, 'visibilityState', 'get')
            .mockReturnValue('visible');
        render();
        const section = host().querySelector(
            '[data-test-id=dashboard-hero]'
        ) as HTMLElement;
        expect(section.classList).not.toContain('hero--paused');

        visibility.mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        fixture.detectChanges();
        expect(section.classList).toContain('hero--paused');

        visibility.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        fixture.detectChanges();
        expect(section.classList).not.toContain('hero--paused');
        visibility.mockRestore();
    });
});

describe('DashboardHeroComponent rotation animation', () => {
    const styles = readFileSync(
        resolve(__dirname, 'dashboard-hero.component.scss'),
        'utf8'
    );
    const keyframes = (name: string) =>
        new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(
            styles
        )?.[1] ?? '';

    // The fill runs for the whole time an idle dashboard is on screen: a
    // layout property here means style, layout and paint on every frame.
    it('fills the active dot with a compositor-only animation', () => {
        const frames = keyframes('hero-dot-fill');
        const properties = Array.from(
            frames.matchAll(/^\s*([a-z-]+)\s*:/gm),
            (match) => match[1]
        );

        expect(properties.length).toBeGreaterThan(0);
        expect(new Set(properties)).toEqual(new Set(['transform']));
    });
});
