import {
    afterNextRender,
    computed,
    DestroyRef,
    effect,
    ElementRef,
    inject,
    Injectable,
    Injector,
    Signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { SettingsContextService } from '@iptvnator/workspace/shell/util/settings-context';
import {
    SettingsRevealRequest,
    SettingsSearchEntry,
    SettingsSearchService,
} from '@iptvnator/workspace/shell/util/settings-search';
import { map, startWith } from 'rxjs';

/** How long a revealed row keeps its highlight. */
export const SETTINGS_REVEAL_HIGHLIGHT_MS = 2400;
export const SETTINGS_REVEALED_CLASS = 'setting-item--revealed';

export interface SettingsRevealBinding {
    /** Section page currently rendered. */
    readonly activeSection: Signal<string>;
    /** True once the form is hydrated, so form-dependent rows exist. */
    readonly ready: Signal<boolean>;
}

/**
 * Settings page side of settings search. The header search writes the term
 * to the `q` query param (shell-owned); this facade turns it into ranked
 * results, publishes per-section match counts to the settings navigation,
 * and scrolls to and highlights a row that search or the command palette
 * asked `SettingsSearchService` to reveal.
 */
@Injectable()
export class SettingsSearchFacade {
    private readonly route = inject(ActivatedRoute);
    private readonly settingsSearch = inject(SettingsSearchService);
    private readonly settingsCtx = inject(SettingsContextService);
    private readonly translate = inject(TranslateService);
    private readonly host = inject(ElementRef<HTMLElement>);
    private readonly injector = inject(Injector);
    private highlightTimeoutId: ReturnType<typeof setTimeout> | null = null;

    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    readonly query = toSignal(
        this.route.queryParamMap.pipe(
            map((params) => (params.get('q') ?? '').trim())
        ),
        { initialValue: '' }
    );
    readonly isSearching = computed(() => this.query().length > 0);
    readonly results = computed(() => {
        this.languageTick();
        return this.settingsSearch.search(this.query());
    });

    constructor() {
        inject(DestroyRef).onDestroy(
            this.settingsSearch.followEmbeddedMpvSupport()
        );

        effect(() => {
            if (!this.isSearching()) {
                this.settingsCtx.setMatchCounts(null);
                return;
            }

            const counts: Record<string, number> = {};
            for (const { entry } of this.results()) {
                counts[entry.section] = (counts[entry.section] ?? 0) + 1;
            }
            this.settingsCtx.setMatchCounts(counts);
        });

        inject(DestroyRef).onDestroy(() => {
            this.settingsCtx.setMatchCounts(null);
            this.clearHighlightTimer();
        });
    }

    select(entry: SettingsSearchEntry): void {
        this.settingsSearch.reveal(entry);
    }

    /** Starts handling reveal requests once the page can render them. */
    bindReveal({ activeSection, ready }: SettingsRevealBinding): void {
        effect(
            () => {
                const request = this.settingsSearch.pendingReveal();
                if (
                    !request ||
                    !ready() ||
                    this.isSearching() ||
                    activeSection() !== request.section
                ) {
                    return;
                }

                afterNextRender(() => this.revealRow(request), {
                    injector: this.injector,
                });
            },
            { injector: this.injector }
        );
    }

    private revealRow(request: SettingsRevealRequest): void {
        // A request superseded before this render is handled by its successor.
        if (this.settingsSearch.pendingReveal()?.nonce !== request.nonce) {
            return;
        }
        this.settingsSearch.completeReveal(request);

        const row =
            this.findRow(request.id) ??
            (request.fallbackId ? this.findRow(request.fallbackId) : null);
        if (!row) {
            return;
        }

        this.clearHighlight();
        row.scrollIntoView({
            block: 'center',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
        // Moving focus to the row lets keyboard and screen-reader users
        // continue from the setting they searched for; Tab reaches its
        // control next.
        if (!row.hasAttribute('tabindex')) {
            row.setAttribute('tabindex', '-1');
        }
        row.focus({ preventScroll: true });
        row.classList.add(SETTINGS_REVEALED_CLASS);
        this.highlightTimeoutId = setTimeout(
            () => this.clearHighlight(),
            SETTINGS_REVEAL_HIGHLIGHT_MS
        );
    }

    /** `id` comes from the static registry (`[a-z0-9-]`), never from input. */
    private findRow(id: string): HTMLElement | null {
        return (this.host.nativeElement as HTMLElement).querySelector(
            `[data-setting-id="${id}"]`
        );
    }

    private clearHighlight(): void {
        this.clearHighlightTimer();
        (this.host.nativeElement as HTMLElement)
            .querySelectorAll(`.${SETTINGS_REVEALED_CLASS}`)
            .forEach((element) =>
                element.classList.remove(SETTINGS_REVEALED_CLASS)
            );
    }

    private clearHighlightTimer(): void {
        if (this.highlightTimeoutId !== null) {
            clearTimeout(this.highlightTimeoutId);
            this.highlightTimeoutId = null;
        }
    }
}

function prefersReducedMotion(): boolean {
    return (
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
}
