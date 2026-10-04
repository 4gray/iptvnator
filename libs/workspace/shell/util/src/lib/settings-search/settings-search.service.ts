import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { VodSourceDiscoveryService } from '@iptvnator/portal/shared/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    EmbeddedMpvSupport,
    watchEmbeddedMpvSupport,
} from '@iptvnator/shared/interfaces';
import { SETTINGS_SEARCH_ENTRIES } from './settings-search-entries';
import { rankSearchMatch, tokenizeSearchQuery } from './settings-search-rank';
import {
    meetsSettingsRequirements,
    SETTINGS_SECTION_DEFINITIONS,
} from './settings-search-sections';
import {
    SettingsRevealRequest,
    SettingsSearchCapabilities,
    SettingsSearchEntry,
    SettingsSearchResult,
    SettingsSectionDefinition,
} from './settings-search.types';

/**
 * Searchable index of the settings page, shared by the settings page search
 * and the command palette so both return the same results in the same
 * order. Also owns "reveal": navigating to a row's section page and asking
 * the page to scroll to and highlight it.
 */
@Injectable({ providedIn: 'root' })
export class SettingsSearchService {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly vodSourceDiscovery = inject(VodSourceDiscoveryService);
    private readonly router = inject(Router);
    private readonly translate = inject(TranslateService);

    private readonly revealRequest = signal<SettingsRevealRequest | null>(null);
    private revealNonce = 0;
    private readonly revealListeners = new Set<() => void>();
    private readonly embeddedMpvSupport = signal<EmbeddedMpvSupport | null>(
        null
    );
    private embeddedMpvSupportChecked = false;
    private embeddedMpvSupportLoad: Promise<void> | undefined;
    private stopEmbeddedMpvSupportWatch: (() => void) | undefined;

    constructor() {
        inject(DestroyRef).onDestroy(() =>
            this.stopEmbeddedMpvSupportWatch?.()
        );
    }

    /** Row the settings page should scroll to and highlight next. */
    readonly pendingReveal = this.revealRequest.asReadonly();

    capabilities(): SettingsSearchCapabilities {
        const runtime = this.runtime;
        return {
            desktop: runtime.isElectron,
            epg: runtime.supportsEpgImport && runtime.supportsEpgDataManagement,
            'remote-control': runtime.supportsRemoteControl,
            'startup-window-mode': runtime.supportsStartupWindowMode,
            'portal-connectivity-guard':
                runtime.supportsPortalConnectivityGuard,
            'managed-external-players': runtime.supportsManagedExternalPlayers,
            'external-player-paths': runtime.supportsExternalPlayerPathSettings,
            'vod-multi-source': this.vodSourceDiscovery.isAvailable,
            'embedded-mpv': !!this.embeddedMpvSupport()?.supported,
            'embedded-mpv-frame-copy':
                !!this.embeddedMpvSupport()?.frameCopyAvailable,
        };
    }

    /**
     * Probes embedded MPV support so rows that need it become searchable.
     * Returns the pending probe, or `undefined` when there is nothing to
     * wait for. Call it lazily (palette open, settings page), never from
     * shell bootstrap: supported desktop builds may load the native addon
     * while answering. A final answer is kept. An inconclusive one keeps
     * being followed, so an open settings page updates by itself, and the
     * next call asks again at once.
     */
    ensureEmbeddedMpvSupportLoaded(): Promise<void> | undefined {
        if (this.embeddedMpvSupportChecked) {
            return undefined;
        }

        const electron =
            typeof window === 'undefined' ? undefined : window.electron;
        if (
            !this.runtime.supportsEmbeddedMpv ||
            typeof electron?.getEmbeddedMpvSupport !== 'function'
        ) {
            this.embeddedMpvSupportChecked = true;
            return undefined;
        }

        this.embeddedMpvSupportLoad ??= this.followEmbeddedMpvSupport(() =>
            electron.getEmbeddedMpvSupport()
        );
        return this.embeddedMpvSupportLoad;
    }

    /** Follows the answer afresh; resolves with its first one. */
    private followEmbeddedMpvSupport(
        getSupport: () => Promise<EmbeddedMpvSupport>
    ): Promise<void> {
        this.stopEmbeddedMpvSupportWatch?.();
        return new Promise<void>((answered) => {
            const take = (support: EmbeddedMpvSupport | null) => {
                this.embeddedMpvSupport.set(support);
                this.embeddedMpvSupportChecked = !support?.inconclusive;
                this.embeddedMpvSupportLoad = undefined;
                answered();
            };
            this.stopEmbeddedMpvSupportWatch = watchEmbeddedMpvSupport(
                getSupport,
                take,
                () => take(null)
            );
        });
    }

    /**
     * Runs `listener` synchronously before every reveal navigation, so the
     * shell can drop a search keystroke still waiting for its debounce: if
     * it applied later, its `q` navigation would supersede the reveal.
     */
    onReveal(listener: () => void): () => void {
        this.revealListeners.add(listener);
        return () => this.revealListeners.delete(listener);
    }

    visibleSections(): SettingsSectionDefinition[] {
        const capabilities = this.capabilities();
        return SETTINGS_SECTION_DEFINITIONS.filter((section) =>
            meetsSettingsRequirements(section.requires, capabilities)
        );
    }

    /** Entries whose section and row render on this runtime. */
    visibleEntries(): SettingsSearchEntry[] {
        const capabilities = this.capabilities();
        const sectionIds = new Set(
            this.visibleSections().map((section) => section.id)
        );
        return SETTINGS_SEARCH_ENTRIES.filter(
            (entry) =>
                sectionIds.has(entry.section) &&
                meetsSettingsRequirements(entry.requires, capabilities)
        );
    }

    /**
     * Ranked matches for `query` in the current UI language; best first,
     * ties in settings page order. Empty for a blank query.
     */
    search(query: string, limit = Infinity): SettingsSearchResult[] {
        const tokens = tokenizeSearchQuery(query);
        if (tokens.length === 0) {
            return [];
        }

        const sections = new Map(
            SETTINGS_SECTION_DEFINITIONS.map((section) => [section.id, section])
        );
        const results: SettingsSearchResult[] = [];

        for (const entry of this.visibleEntries()) {
            const section = sections.get(entry.section);
            if (!section) {
                continue;
            }

            const label = this.translate.instant(entry.labelKey);
            const description = entry.descriptionKey
                ? this.translate.instant(entry.descriptionKey)
                : '';
            const sectionLabel = this.translate.instant(section.navLabelKey);
            const score = rankSearchMatch(tokens, {
                label,
                keywords: entry.keywords,
                context: [description, sectionLabel],
            });

            if (score > 0) {
                results.push({
                    entry,
                    section,
                    label,
                    description,
                    sectionLabel,
                    score,
                });
            }
        }

        // Array#sort is stable, so equal scores keep settings page order.
        return results.sort((a, b) => b.score - a.score).slice(0, limit);
    }

    /** Opens the row's section page and asks it to highlight the row. */
    reveal(entry: SettingsSearchEntry): void {
        this.revealListeners.forEach((listener) => listener());
        this.revealNonce += 1;
        this.revealRequest.set({
            id: entry.id,
            section: entry.section,
            fallbackId: entry.fallbackId,
            nonce: this.revealNonce,
        });
        void this.router.navigate(['/workspace/settings', entry.section]);
    }

    /** Called by the settings page once it has handled `request`. */
    completeReveal(request: SettingsRevealRequest): void {
        if (this.revealRequest()?.nonce === request.nonce) {
            this.revealRequest.set(null);
        }
    }
}
