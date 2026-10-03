import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    afterNextRender,
    computed,
    effect,
    inject,
    input,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { TrailerDialogState } from './trailer-dialog-state';

/** Idle time on the page before the trailer takes over the backdrop. */
export const TRAILER_BACKDROP_IDLE_MS = 3000;

/**
 * Plays a title's trailer, muted and looping, as the hero backdrop after a
 * few idle seconds (`Settings → Playback → Play trailers in details
 * background`). It stops when the hero scrolls out of view, the window
 * loses focus, the document is hidden or the trailer modal opens (which
 * plays its own copy), and never starts under `prefers-reduced-motion` or
 * on a metered connection. `toggleMute()`
 * drives the sound through the YouTube IFrame API (`enablejsapi`); the hero
 * renders that control itself, above its content layer.
 */
@Component({
    selector: 'app-hero-trailer-backdrop',
    templateUrl: './hero-trailer-backdrop.component.html',
    styleUrl: './hero-trailer-backdrop.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '[class.is-playing]': 'playing()' },
})
export class HeroTrailerBackdropComponent {
    /** A `youtube-nocookie.com/embed/...` URL, see `youtubeEmbedUrl`. */
    readonly embedUrl = input.required<string>();
    readonly title = input('');

    readonly playing = signal(false);
    readonly muted = signal(true);

    private readonly sanitizer = inject(DomSanitizer);
    private readonly destroyRef = inject(DestroyRef);
    private readonly trailerDialog = inject(TrailerDialogState);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');
    private readonly inView = signal(true);
    private readonly windowFocused = signal(true);
    private readonly documentVisible = signal(true);
    private idleTimer: ReturnType<typeof setTimeout> | null = null;

    readonly frameUrl = computed<SafeResourceUrl>(() =>
        this.sanitizer.bypassSecurityTrustResourceUrl(
            buildLoopingEmbedUrl(this.embedUrl())
        )
    );

    constructor() {
        effect(() => {
            // A new trailer, a hero off screen or a hidden window: the frame
            // goes away and the idle wait starts over (a mounted frame would
            // autoplay the next URL at once).
            this.embedUrl();
            const visible =
                this.inView() &&
                this.windowFocused() &&
                this.documentVisible() &&
                !this.trailerDialog.dialogOpen();
            untracked(() => {
                this.clearIdleTimer();
                this.playing.set(false);
                if (visible && canAutoplayTrailer()) {
                    this.idleTimer = setTimeout(() => {
                        // Every frame mounts with `mute=1`.
                        this.muted.set(true);
                        this.playing.set(true);
                        this.idleTimer = null;
                    }, TRAILER_BACKDROP_IDLE_MS);
                }
            });
        });
        afterNextRender(() => this.observe());
        this.destroyRef.onDestroy(() => this.clearIdleTimer());
    }

    toggleMute(): void {
        const nextMuted = !this.muted();
        this.muted.set(nextMuted);
        this.frame()?.nativeElement.contentWindow?.postMessage(
            JSON.stringify({
                event: 'command',
                func: nextMuted ? 'mute' : 'unMute',
                args: [],
            }),
            '*'
        );
    }

    private observe(): void {
        const element = this.host.nativeElement;
        if (typeof IntersectionObserver !== 'undefined') {
            const observer = new IntersectionObserver(
                (entries) =>
                    this.inView.set(
                        entries.some((entry) => entry.intersectionRatio > 0.4)
                    ),
                { threshold: [0, 0.4, 1] }
            );
            observer.observe(element);
            this.destroyRef.onDestroy(() => observer.disconnect());
        }
        const onFocus = () => this.windowFocused.set(true);
        const onBlur = () => this.windowFocused.set(false);
        const onVisibility = () =>
            this.documentVisible.set(document.visibilityState !== 'hidden');
        this.windowFocused.set(document.hasFocus());
        onVisibility();
        window.addEventListener('focus', onFocus);
        window.addEventListener('blur', onBlur);
        document.addEventListener('visibilitychange', onVisibility);
        this.destroyRef.onDestroy(() => {
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('blur', onBlur);
            document.removeEventListener('visibilitychange', onVisibility);
        });
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }
}

/** Reduced motion and metered connections keep the backdrop still. */
export function canAutoplayTrailer(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        return false;
    }
    const connection = (
        navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    return connection?.saveData !== true;
}

/** Autoplay muted, loop the single video, no controls, JS API for the mute toggle. */
export function buildLoopingEmbedUrl(embedUrl: string): string {
    try {
        const url = new URL(embedUrl);
        const videoId = url.pathname.split('/').pop() ?? '';
        url.searchParams.set('autoplay', '1');
        url.searchParams.set('mute', '1');
        url.searchParams.set('controls', '0');
        url.searchParams.set('loop', '1');
        url.searchParams.set('playlist', videoId);
        url.searchParams.set('rel', '0');
        url.searchParams.set('playsinline', '1');
        url.searchParams.set('enablejsapi', '1');
        return url.toString();
    } catch {
        return embedUrl;
    }
}
