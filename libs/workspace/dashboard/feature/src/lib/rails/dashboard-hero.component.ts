import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { DashboardHeroSlidesPresenter } from './dashboard-hero-slides.presenter';
import { HERO_ROTATION_MS } from './dashboard-hero-slides.utils';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Cinematic dashboard hero: a full-bleed backdrop that rotates between an
 * unfinished title, a favourite channel on air now and a few discovery
 * picks (see `pickDashboardHeroSources`).
 *
 * Rotation is driven by the active dot's CSS fill animation: its
 * `animationend` advances the slide, so pausing (hover, focus inside the
 * hero, the pause button) is just `animation-play-state: paused` and resumes
 * where it stopped. With `prefers-reduced-motion` there is no animation and
 * therefore no auto-advance; the dots still switch slides.
 *
 * The active slide is tracked by id, so a slide that arrives late (the live
 * slide waits for its EPG answer) never yanks the user off the current one.
 */
@Component({
    selector: 'lib-dashboard-hero',
    imports: [MatIcon, RouterLink, TranslatePipe],
    templateUrl: './dashboard-hero.component.html',
    styleUrl: './dashboard-hero.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [DashboardHeroSlidesPresenter],
    host: {
        '[style.--hero-rotation-ms]': 'rotationMs + "ms"',
    },
})
export class DashboardHeroComponent {
    readonly presenter = inject(DashboardHeroSlidesPresenter);
    readonly slides = this.presenter.slides;
    readonly rotationMs = HERO_ROTATION_MS;

    private readonly activeId = signal<string | null>(null);
    private readonly hovered = signal(false);
    private readonly focusWithin = signal(false);
    readonly userPaused = signal(false);
    readonly reducedMotion = signal(false);

    readonly activeIndex = computed(() => {
        const index = this.slides().findIndex(
            (slide) => slide.id === this.activeId()
        );
        return index >= 0 ? index : 0;
    });

    readonly activeSlide = computed(
        () => this.slides()[this.activeIndex()] ?? null
    );

    readonly canRotate = computed(
        () => this.slides().length > 1 && !this.reducedMotion()
    );

    readonly paused = computed(
        () => this.userPaused() || this.hovered() || this.focusWithin()
    );

    constructor() {
        const media =
            typeof window !== 'undefined' && window.matchMedia
                ? window.matchMedia(REDUCED_MOTION_QUERY)
                : null;
        if (media) {
            this.reducedMotion.set(media.matches);
            const onChange = (event: MediaQueryListEvent) =>
                this.reducedMotion.set(event.matches);
            media.addEventListener('change', onChange);
            inject(DestroyRef).onDestroy(() =>
                media.removeEventListener('change', onChange)
            );
        }
    }

    show(index: number): void {
        const slide = this.slides()[index];
        if (slide) {
            this.activeId.set(slide.id);
        }
    }

    /** The active dot's fill animation finished: time for the next slide. */
    onRotationTick(): void {
        if (!this.canRotate() || this.paused()) {
            return;
        }
        this.show((this.activeIndex() + 1) % this.slides().length);
    }

    togglePaused(): void {
        this.userPaused.update((paused) => !paused);
    }

    setHovered(hovered: boolean): void {
        this.hovered.set(hovered);
    }

    onFocusIn(): void {
        this.focusWithin.set(true);
    }

    onFocusOut(event: FocusEvent): void {
        const host = event.currentTarget as HTMLElement | null;
        const next = event.relatedTarget as Node | null;
        if (!host || !next || !host.contains(next)) {
            this.focusWithin.set(false);
        }
    }

    /** Roving arrows between the dots, like a tab list. */
    onDotKeydown(event: KeyboardEvent, index: number): void {
        const count = this.slides().length;
        const step =
            event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0 || count < 2) {
            return;
        }
        event.preventDefault();
        const next = (index + step + count) % count;
        this.show(next);
        const group = (event.currentTarget as HTMLElement).parentElement;
        group?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
    }
}
