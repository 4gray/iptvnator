import {
    computed,
    DestroyRef,
    inject,
    Injectable,
    signal,
    Signal,
} from '@angular/core';
import { SettingsStore } from '@iptvnator/services';

const HOVER_CAPABLE_QUERY = '(hover: hover)';

/**
 * Resolves whether cover grids should render as a posters-only wall.
 *
 * The wall hides the title row under every cover and reveals the title as a
 * hover/focus overlay instead. That overlay needs a pointer that can hover,
 * so on touch-only devices (`(hover: none)`) the preference is ignored and
 * the titles stay under the covers — a tap already opens the item, leaving
 * no gesture to peek at a hidden name.
 *
 * Consumers still apply their own exemptions (live grids, search results)
 * on top of this signal; it only answers "does the user want the wall AND
 * can this device show it".
 */
@Injectable({ providedIn: 'root' })
export class CoverTitlesService {
    private readonly settingsStore = inject(SettingsStore);
    private readonly hoverCapable = createHoverCapabilitySignal(
        inject(DestroyRef)
    );

    /** True when covers render without a title row. */
    readonly postersOnly = computed(
        () =>
            this.settingsStore.showCoverTitles?.() === false &&
            this.hoverCapable()
    );
}

function createHoverCapabilitySignal(destroyRef: DestroyRef): Signal<boolean> {
    // No `matchMedia` (SSR, some test hosts) means we cannot prove a hover
    // pointer exists; default to true so desktop keeps the feature in those
    // environments and the touch fallback only triggers on real evidence.
    if (typeof window === 'undefined' || !('matchMedia' in window)) {
        return signal(true).asReadonly();
    }

    const query = window.matchMedia(HOVER_CAPABLE_QUERY);
    const hoverCapable = signal(query.matches);
    const onChange = (event: MediaQueryListEvent): void => {
        hoverCapable.set(event.matches);
    };

    query.addEventListener('change', onChange);
    destroyRef.onDestroy(() => query.removeEventListener('change', onChange));

    return hoverCapable.asReadonly();
}
