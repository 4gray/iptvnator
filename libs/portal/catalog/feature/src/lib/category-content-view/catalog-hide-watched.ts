import { afterNextRender, computed, inject, Injector } from '@angular/core';
import { PortalCatalogFacade } from '@iptvnator/portal/shared/util';

/** Presentation of the optional exclusion filter; paging stays provider-owned. */
export function createCatalogHideWatched<C, I, S>(
    catalog: PortalCatalogFacade<C, I, S>,
    host: HTMLElement
) {
    const injector = inject(Injector);
    const supported = computed(
        () => catalog.contentType() === 'vod' && Boolean(catalog.hideWatched)
    );
    const active = computed(
        () => supported() && (catalog.hideWatched?.enabled() ?? false)
    );
    const ready = computed(
        () => supported() && (catalog.hideWatched?.hasSnapshot() ?? false)
    );
    const state = computed(() =>
        supported() ? (catalog.hideWatched?.loadState() ?? 'idle') : 'ready'
    );
    const paused = computed(
        () => active() && (catalog.hideWatched?.paused() ?? false)
    );
    const resumeVersion = computed(() =>
        active() ? (catalog.hideWatched?.resumeVersion() ?? 0) : 0
    );
    return {
        supported,
        active,
        ready,
        paused,
        resumeVersion,
        error: computed(() => state() === 'error'),
        loading: computed(() => state() === 'idle' || state() === 'loading'),
        set(value: boolean): void {
            if (!supported()) return;
            const focused = host.ownerDocument.activeElement?.closest(
                '.hide-watched-chip, .grid-filter-clear'
            );
            catalog.hideWatched?.setEnabled(value);
            if (!value && focused && host.contains(focused))
                afterNextRender(
                    () =>
                        host
                            .querySelector<HTMLButtonElement>('.refine-action')
                            ?.focus(),
                    { injector }
                );
        },
        retry(): void {
            catalog.hideWatched?.retryPositions();
        },
        pause(): void {
            catalog.hideWatched?.pauseAutomaticLoading();
        },
        continueLoading(): void {
            catalog.hideWatched?.continueLoading();
        },
    };
}
