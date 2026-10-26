import { inject, Injectable, signal } from '@angular/core';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, from, Observable, of } from 'rxjs';
import { catchError, map, tap, timeout } from 'rxjs/operators';
import {
    createDevLogger,
    EpgChannelMetadata,
    EpgProgram,
    epgProviderClockMs,
} from '@iptvnator/shared/interfaces';
import { EpgSourceSettingsService, SettingsStore } from '@iptvnator/services';
import {
    EpgLookupOptions,
    EpgRuntimeBridgeService,
} from './epg-runtime-bridge.service';
import { normalizeEpgPrograms } from './epg-program-normalization.util';
import { EpgProgramCache } from './epg-program-cache';
import { EpgChannelMetadataLookup } from './epg-channel-metadata.lookup';
import { EpgCurrentProgramsLookup } from './epg-current-programs.lookup';
import { EpgSingleProgramLookup } from './epg-single-program.lookup';
import { EpgScopedBatchLookup } from './epg-scoped-batch.lookup';
import type { EpgLookupContext } from './epg-lookup-context';
import {
    normalizeLookupChannelIds,
    normalizeLookupSourceUrls,
} from './epg-lookup-normalization.util';
import { normalizeEpgUrls } from '@iptvnator/shared/m3u-utils';
import { EpgChannelWindowLookup } from './epg-channel-window.lookup';

const debugEpgService = createDevLogger('EpgService');

@Injectable({
    providedIn: 'root',
})
export class EpgService {
    private snackBar = inject(LazySnackBar);
    private translate = inject(TranslateService);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly sourceSettings = inject(EpgSourceSettingsService);

    constructor() {
        this.sourceSettings.changed$.subscribe(() => {
            this.programRequestId++;
            this.sourceRevision.update((revision) => revision + 1);
            this.clearCache();
            this.currentEpgPrograms.next([]);
            this.currentChannelHasPrograms.next(false);
            this.epgAvailable.next(true);
        });
    }

    private epgAvailable = new BehaviorSubject<boolean>(false);
    private currentEpgPrograms = new BehaviorSubject<EpgProgram[]>([]);
    private currentChannelHasPrograms = new BehaviorSubject(false);
    private programRequestId = 0;
    readonly sourceRevision = signal(0);
    private readonly channelWindow = new EpgChannelWindowLookup(
        this.epgBridge,
        (excluding) => this.getGlobalEpgSourceUrls(excluding),
        () => this.epgOffsetMinutes()
    );

    /** Channel icons/display names; same scope ladder as the programmes. */
    private readonly channelMetadata = new EpgChannelMetadataLookup(
        this.epgBridge,
        () => this.sourceSettings.guard(),
        (excluding) => this.getGlobalEpgSourceUrls(excluding)
    );

    /** 60 s "currently airing" memory, keyed by scope + display offset. */
    private readonly programCache = new EpgProgramCache(
        () => this.epgOffsetMinutes(),
        () => this.sourceSettings.guard()
    );

    /** The whole "what is on air" scope ladder, single channel or batch. */
    private readonly lookupContext: EpgLookupContext = {
        bridge: this.epgBridge,
        cache: this.programCache,
        guard: () => this.sourceSettings.guard(),
        offsetMinutes: () => this.epgOffsetMinutes(),
        clockMs: () => this.epgClockMs(),
        globalSourceUrls: (excluding) => this.getGlobalEpgSourceUrls(excluding),
    };
    private readonly singleProgram = new EpgSingleProgramLookup(
        this.lookupContext
    );
    private readonly currentPrograms = new EpgCurrentProgramsLookup(
        this.lookupContext,
        this.singleProgram,
        new EpgScopedBatchLookup(this.lookupContext)
    );

    /** Display offset every "currently airing" decision in here is made with. */
    private epgOffsetMinutes(): number {
        return this.settingsStore.resolvedEpgOffsetMinutes();
    }

    /**
     * Wall-clock now expressed in the provider's uncorrected EPG clock. Raw
     * programme rows are compared against this instant, so the row picked
     * as "now" is the one the UI also renders as "now" once it shifts the
     * times for display (`epg-display-offset.util.ts`, clock form).
     */
    private epgClockMs(): number {
        return epgProviderClockMs(Date.now(), this.epgOffsetMinutes());
    }

    readonly epgAvailable$ = this.epgAvailable.asObservable();
    readonly currentEpgPrograms$ = this.currentEpgPrograms.asObservable();
    readonly currentChannelHasPrograms$ =
        this.currentChannelHasPrograms.asObservable();

    /**
     * Fetches EPG from the given URLs
     */
    async fetchEpg(urls: string[]): Promise<void> {
        if (!this.epgBridge.supportsImport) return;

        // Filter out empty and duplicate URLs and send all URLs at once.
        const revision = this.sourceSettings.revision();
        await this.settingsStore.loadSettings();
        await this.sourceSettings.waitForReconciliation();
        const validUrls = this.sourceSettings.retainCurrentSources(
            normalizeEpgUrls(urls),
            revision
        );
        if (validUrls.length === 0) return;

        from(
            this.epgBridge.fetchEpg(
                validUrls,
                this.settingsStore.getTrustOptions()
            )
        )
            .pipe(
                this.sourceSettings.guard(),
                tap((result) => {
                    if (result === null) return;

                    if (result.success) {
                        this.clearCache();
                        this.epgAvailable.next(true);
                    } else {
                        this.epgAvailable.next(false);
                        // With progress reporting, every failed source is a
                        // row of the import panel, with its error and a
                        // Retry; a toast would repeat the backend's text
                        // beside that row. A runtime that imports without
                        // reporting progress has no row, so it keeps the
                        // generic toast.
                        if (!this.epgBridge.supportsProgress) {
                            this.showErrorSnackbar();
                        }
                    }
                }),
                catchError((err) => {
                    console.error('EPG fetch error:', err);
                    this.epgAvailable.next(false);
                    this.showErrorSnackbar();
                    return of(null);
                })
            )
            .subscribe();
    }

    /**
     * Gets EPG programs for a specific channel
     */
    getChannelPrograms(channelId: string): void {
        if (!this.epgBridge.supportsProgramLookup) return;
        debugEpgService('Fetching EPG for channel ID:', channelId);

        from(this.epgBridge.getChannelPrograms(channelId))
            .pipe(
                this.sourceSettings.guard(),
                timeout(3000),
                map((programs) => normalizeEpgPrograms(programs ?? [])),
                catchError((err) => {
                    console.error('EPG get programs error:', err);
                    this.showErrorSnackbar();
                    this.currentEpgPrograms.next([]);
                    this.epgAvailable.next(false);
                    return of([]);
                })
            )
            .subscribe((programs) => {
                this.epgAvailable.next(programs.length > 0);
                this.currentEpgPrograms.next(programs);
            });
    }

    /** Load one displayed day through the guide's uncapped overlap query. */
    async loadChannelProgramsForWindow(
        channelId: string,
        fromMs: number,
        toMs: number,
        playlistSourceUrls: string[] = [],
        currentDayWindow?: { fromMs: number; toMs: number }
    ): Promise<void> {
        const requestId = ++this.programRequestId;
        this.currentEpgPrograms.next([]);
        this.currentChannelHasPrograms.next(false);
        const lookupKey = channelId.trim();
        if (!this.epgBridge.supportsGuide || !lookupKey) {
            return;
        }

        try {
            const programs = await this.channelWindow.programs(
                lookupKey,
                fromMs,
                toMs,
                playlistSourceUrls
            );
            if (requestId !== this.programRequestId) return;
            const currentPrograms = currentDayWindow
                ? await this.channelWindow.programs(
                      lookupKey,
                      currentDayWindow.fromMs,
                      currentDayWindow.toMs,
                      playlistSourceUrls
                  )
                : [];
            if (requestId !== this.programRequestId) return;
            const combined = Array.from(
                new Map(
                    [...programs, ...currentPrograms].map((program) => [
                        `${program.channel}\n${program.start}\n${program.title}`,
                        program,
                    ])
                ).values()
            ).sort((left, right) => left.start.localeCompare(right.start));
            this.currentEpgPrograms.next(combined);
            this.epgAvailable.next(combined.length > 0);
            const hasAny =
                combined.length > 0 ||
                (await this.channelWindow.hasAnyPrograms(
                    lookupKey,
                    playlistSourceUrls
                ));
            if (requestId !== this.programRequestId) return;
            this.currentChannelHasPrograms.next(hasAny);
        } catch (error) {
            if (requestId !== this.programRequestId) return;
            console.error('EPG guide programme lookup error:', error);
            this.showErrorSnackbar();
            this.epgAvailable.next(false);
        }
    }

    /** Raw provider-clock window for archive seek-bar programmes. */
    getChannelProgramsForProviderWindow(
        channelId: string,
        fromMs: number,
        toMs: number,
        playlistSourceUrls: string[] = []
    ): Promise<EpgProgram[]> {
        if (!this.epgBridge.supportsGuide || !channelId.trim()) {
            return Promise.resolve([]);
        }
        return this.channelWindow.programs(
            channelId.trim(),
            fromMs,
            toMs,
            playlistSourceUrls,
            true
        );
    }

    /**
     * The generic EPG failure toast, for failures no import panel row
     * reports (the bridge call itself, a programme lookup). Material's
     * default bottom-centre position, as every other toast.
     */
    private showErrorSnackbar(): void {
        void this.snackBar.open(
            this.translate.instant('EPG.ERROR'),
            this.translate.instant('CLOSE'),
            { duration: 3000 }
        );
    }

    /**
     * Gets the current EPG program for a specific channel (with caching)
     * @param channelId Channel ID (tvg-id or channel name)
     * @returns Observable of current program or null
     */
    getCurrentProgramForChannel(
        channelId: string,
        options?: EpgLookupOptions
    ): Observable<EpgProgram | null> {
        if (!this.epgBridge.supportsProgramLookup || !channelId) {
            return of(null);
        }
        return this.singleProgram.forChannel(channelId, options);
    }

    /**
     * Gets current programs for multiple channels (batch operation)
     * @param channelIds Array of channel IDs
     * @returns Observable of Map with channelId -> current program
     */
    getCurrentProgramsForChannels(
        channelIds: string[],
        options?: EpgLookupOptions
    ): Observable<Map<string, EpgProgram | null>> {
        if (!this.epgBridge.supportsProgramLookup) {
            return of(new Map());
        }
        if (!channelIds || channelIds.length === 0) {
            return of(new Map());
        }
        return this.currentPrograms.forChannels(channelIds, options);
    }

    getChannelMetadataForChannels(
        channelIds: string[],
        options?: EpgLookupOptions
    ): Observable<Map<string, EpgChannelMetadata | null>> {
        if (!this.epgBridge.supportsChannelMetadata) {
            return of(new Map());
        }

        const normalizedChannelIds = normalizeLookupChannelIds(channelIds);
        if (normalizedChannelIds.length === 0) {
            return of(new Map());
        }

        return this.channelMetadata.forChannels(
            normalizedChannelIds,
            normalizeLookupSourceUrls(options)
        );
    }

    private getGlobalEpgSourceUrls(excluding: string[] = []): string[] {
        const excludedUrls = new Set(excluding);
        return normalizeEpgUrls(
            this.settingsStore.getSettings().epgUrl ?? []
        ).filter((url) => !excludedUrls.has(url));
    }

    /**
     * Clears the program cache (useful when EPG is refreshed)
     */
    clearCache(): void {
        this.programCache.clear();
    }
}
