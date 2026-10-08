import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    linkedSignal,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { MetaChipComponent } from '@iptvnator/ui/components';
import { DashboardHeroSlidesPresenter } from './dashboard-hero-slides.presenter';
import { HERO_ROTATION_MS } from './dashboard-hero-slides.utils';
import type { DashboardHeroSlide } from './dashboard-hero.utils';

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
 *
 * The hero is a focusable region: ←/→ switch slides, Enter follows the
 * primary action. Rotation also pauses while the document is hidden.
 */
@Component({
    selector: 'lib-dashboard-hero',
    imports: [MatIcon, MetaChipComponent, RouterLink, TranslatePipe],
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

    /**
     * The slide on screen, by id. Pinned to the first slide as soon as one
     * exists, so a late slide inserted ahead of it cannot take its place;
     * if the active slide itself disappears, the one now at its position
     * takes over.
     */
    private readonly activeId = linkedSignal<
        DashboardHeroSlide[],
        string | null
    >({
        source: this.slides,
        computation: (slides, previous) => {
            const currentId = previous?.value ?? null;
            if (currentId && slides.some((slide) => slide.id === currentId)) {
                return currentId;
            }
            const previousIndex =
                previous?.source.findIndex((slide) => slide.id === currentId) ??
                -1;
            const index = Math.min(
                Math.max(previousIndex, 0),
                slides.length - 1
            );
            return slides[index]?.id ?? null;
        },
    });
    private readonly hovered = signal(false);
    private readonly focusWithin = signal(false);
    private readonly documentHidden = signal(false);
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
        () =>
            this.userPaused() ||
            this.hovered() ||
            this.focusWithin() ||
            this.documentHidden()
    );

    constructor() {
        if (typeof document !== 'undefined') {
            const onVisibility = () =>
                this.documentHidden.set(document.visibilityState === 'hidden');
            onVisibility();
            document.addEventListener('visibilitychange', onVisibility);
            inject(DestroyRef).onDestroy(() =>
                document.removeEventListener('visibilitychange', onVisibility)
            );
        }
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
        if (!this.userPaused()) {
            this.userPaused.set(true);
            return;
        }
        // An explicit Play wins over the implicit pauses: the pointer and
        // the focus are on this very button, so they would otherwise keep
        // the rotation stopped. They re-arm on the next enter / focus move.
        this.userPaused.set(false);
        this.hovered.set(false);
        this.focusWithin.set(false);
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

    /**
     * On the hero region itself: ←/→ switch slides, Enter follows the
     * primary action. Buttons and dots inside keep their own keys.
     */
    onHeroKeydown(event: KeyboardEvent): void {
        if (event.target !== event.currentTarget) {
            return;
        }
        const count = this.slides().length;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            if (count < 2) {
                return;
            }
            event.preventDefault();
            const step = event.key === 'ArrowRight' ? 1 : -1;
            this.show((this.activeIndex() + step + count) % count);
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            (event.currentTarget as HTMLElement)
                .querySelector<HTMLElement>('.hero__button--primary')
                ?.click();
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
