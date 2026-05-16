import {
    ChangeDetectionStrategy,
    Component,
    OnDestroy,
    computed,
    inject,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
    getXtreamItemLanguageMetadata,
    getXtreamItemVideoQualityBuckets,
    getXtreamLanguageOptionsFromCodes,
    getXtreamVideoQualityLabel,
    getXtreamVodDuplicateKey,
    getXtreamVodQualityInfo,
    XtreamAccountInfo,
    XtreamApiService,
    XtreamStore,
    type XtreamLanguageFilterCandidate,
} from '@iptvnator/portal/xtream/data-access';
import { createLogger } from '@iptvnator/portal/shared/util';
import { SettingsStore } from 'services';
import type {
    XtreamAccountInfoDialogData,
    XtreamAccountInfoVodStreamItem,
} from 'shared-interfaces';

type AccountLoadState = 'loading' | 'ready' | 'error';
type VodOverviewSourceFilter = 'all' | 'direct' | 'indirect';
type VodOverviewQualityFilter =
    | 'all'
    | '2160p'
    | '1440p'
    | '1080p'
    | '720p'
    | 'sd'
    | 'unknown';
interface AccountStat {
    icon: string;
    labelKey: string;
    value: string;
    meter: number | null;
}

interface AccountDetailRow {
    labelKey: string;
    value: string;
    mono?: boolean;
    tone?: 'accent' | 'positive' | 'warning';
    translateValue?: boolean;
}

interface AccountPort {
    labelKey: string;
    value: string;
}

interface VodOverviewLanguageOption {
    code: string;
    label: string;
    count: number;
}

interface VodOverviewSourceOption {
    value: Exclude<VodOverviewSourceFilter, 'all'>;
    labelKey: string;
    count: number;
}

interface VodOverviewQualityOption {
    value: Exclude<VodOverviewQualityFilter, 'all'>;
    label: string;
    count: number;
}

interface VodOverviewDiagnosticCard {
    descriptionKey: string;
    icon: string;
    labelKey: string;
    percent: number;
    tone: 'neutral' | 'warning' | 'danger';
    total: number;
    value: number;
}

interface VodOverviewDescriptor {
    audioLanguages: string[];
    qualityBuckets: Array<Exclude<VodOverviewQualityFilter, 'all'>>;
    sourceModes: Array<Exclude<VodOverviewSourceFilter, 'all'>>;
    subtitleLanguages: string[];
    variants: XtreamAccountInfoVodStreamItem[];
}

interface VodOverviewStats {
    audioOptions: VodOverviewLanguageOption[];
    audioUnknownUnique: number;
    diagnosticCards: VodOverviewDiagnosticCard[];
    diagnosticIssueUnique: number;
    directUnique: number;
    filteredItems: number;
    filteredUnique: number;
    hasData: boolean;
    indexPercent: number;
    indexProcessed: number;
    indexStatus: 'idle' | 'running' | 'ready';
    indexTotal: number;
    indirectUnique: number;
    metadataAbsentUnique: number;
    metadataKnownUnique: number;
    metadataUnknownUnique: number;
    metadataUnavailableUnique: number;
    qualityOptions: VodOverviewQualityOption[];
    qualityUnknownUnique: number;
    sourceOptions: VodOverviewSourceOption[];
    subtitleOptions: VodOverviewLanguageOption[];
    subtitleUnknownUnique: number;
    totalItems: number;
    totalUnique: number;
}

interface VodOverviewIndex {
    audioOptions: VodOverviewLanguageOption[];
    groups: VodOverviewDescriptor[];
    processedItems: number;
    qualityOptions: VodOverviewQualityOption[];
    sourceOptions: VodOverviewSourceOption[];
    status: 'idle' | 'running' | 'ready';
    subtitleOptions: VodOverviewLanguageOption[];
    totalItems: number;
    variants: VodOverviewDescriptor[];
}

interface VodOverviewAccumulator {
    audioCounts: Map<string, number>;
    groupsByKey: Map<string, VodOverviewDescriptor>;
    qualityCounts: Map<Exclude<VodOverviewQualityFilter, 'all'>, number>;
    sourceCounts: Map<Exclude<VodOverviewSourceFilter, 'all'>, number>;
    subtitleCounts: Map<string, number>;
    variants: VodOverviewDescriptor[];
}

interface VodOverviewDiagnosticSummary {
    audioUnknownUnique: number;
    diagnosticIssueUnique: number;
    directUnique: number;
    indirectUnique: number;
    metadataAbsentUnique: number;
    metadataKnownUnique: number;
    metadataUnavailableUnique: number;
    qualityUnknownUnique: number;
    subtitleUnknownUnique: number;
}

const ALL_FILTER_VALUE = 'all';
const VOD_OVERVIEW_INDEX_CHUNK_SIZE = 300;
const VOD_OVERVIEW_INDEX_IDLE_DELAY_MS = 16;
const SOURCE_FILTER_OPTIONS: readonly Omit<VodOverviewSourceOption, 'count'>[] =
    [
        {
            value: 'direct',
            labelKey: 'XTREAM.ACCOUNT_INFO.DIRECT_SOURCE',
        },
        {
            value: 'indirect',
            labelKey: 'XTREAM.ACCOUNT_INFO.INDIRECT_SOURCE',
        },
    ];
const QUALITY_FILTER_OPTIONS: readonly Omit<
    VodOverviewQualityOption,
    'count'
>[] = [
    {
        value: '2160p',
        label: '2160p+',
    },
    {
        value: '1440p',
        label: '1440p',
    },
    {
        value: '1080p',
        label: '1080p',
    },
    {
        value: '720p',
        label: '720p',
    },
    {
        value: 'sd',
        label: 'SD',
    },
    {
        value: 'unknown',
        label: 'Not detected',
    },
];

@Component({
    selector: 'app-account-info',
    imports: [MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
    templateUrl: './account-info.component.html',
    styleUrl: './account-info.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountInfoComponent implements OnDestroy {
    readonly data =
        inject<XtreamAccountInfoDialogData | null>(MAT_DIALOG_DATA, {
            optional: true,
        }) ?? {};
    private readonly xtreamApiService = inject(XtreamApiService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly settingsStore = inject(SettingsStore, { optional: true });
    private readonly logger = createLogger('XtreamAccountInfo');

    readonly currentPlaylist = computed(
        () => this.data.playlist ?? this.xtreamStore.currentPlaylist()
    );
    readonly loadState = signal<AccountLoadState>('loading');
    readonly accountInfo = signal<XtreamAccountInfo | null>(null);
    readonly skeletonStats = [1, 2, 3, 4];
    readonly skeletonPanels = [1, 2];
    readonly selectedAudioLanguage = signal(ALL_FILTER_VALUE);
    readonly selectedQuality = signal<VodOverviewQualityFilter>('all');
    readonly selectedSourceMode = signal<VodOverviewSourceFilter>('all');
    readonly selectedSubtitleLanguage = signal(ALL_FILTER_VALUE);
    readonly vodOverviewIndex = signal<VodOverviewIndex>(
        this.createEmptyVodOverviewIndex()
    );
    private vodOverviewIndexRunId = 0;
    private vodOverviewIndexTimer: ReturnType<typeof setTimeout> | null = null;

    readonly isActive = computed(
        () => this.accountInfo()?.user_info?.status === 'Active'
    );
    readonly isTrial = computed(
        () => this.accountInfo()?.user_info?.is_trial === '1'
    );
    readonly playlistLabel = computed(() => {
        const playlist = this.currentPlaylist();
        const info = this.accountInfo();

        return (
            playlist?.title ||
            playlist?.name ||
            info?.server_info?.url ||
            info?.user_info?.username ||
            '-'
        );
    });
    readonly serverHost = computed(
        () => this.accountInfo()?.server_info?.url || '-'
    );
    readonly activeConnections = computed(() =>
        this.parseNumber(this.accountInfo()?.user_info?.active_cons)
    );
    readonly maxConnections = computed(() =>
        this.parseNumber(this.accountInfo()?.user_info?.max_connections)
    );
    readonly connectionUsagePercent = computed(() => {
        const maxConnections = this.maxConnections();

        if (maxConnections <= 0) {
            return 0;
        }

        return Math.min(
            100,
            Math.round((this.activeConnections() / maxConnections) * 100)
        );
    });
    readonly activeConnectionsLabel = computed(
        () =>
            `${this.activeConnections()}/${Math.max(this.maxConnections(), 0)}`
    );
    readonly formattedExpDate = computed(() =>
        this.formatUnixDate(this.accountInfo()?.user_info?.exp_date)
    );
    readonly formattedCreatedDate = computed(() =>
        this.formatUnixDate(this.accountInfo()?.user_info?.created_at)
    );
    readonly allowedFormats = computed(
        () => this.accountInfo()?.user_info?.allowed_output_formats ?? []
    );
    readonly ports = computed<AccountPort[]>(() => {
        const serverInfo = this.accountInfo()?.server_info;

        return [
            {
                labelKey: 'XTREAM.ACCOUNT_INFO.HTTP_PORT',
                value: serverInfo?.port || '-',
            },
            {
                labelKey: 'XTREAM.ACCOUNT_INFO.HTTPS_PORT',
                value: serverInfo?.https_port || '-',
            },
            {
                labelKey: 'XTREAM.ACCOUNT_INFO.RTMP_PORT',
                value: serverInfo?.rtmp_port || '-',
            },
        ];
    });
    readonly heroStats = computed<AccountStat[]>(() => [
        {
            icon: 'bolt',
            labelKey: 'XTREAM.ACCOUNT_INFO.ACTIVE_CONNECTIONS',
            value: this.activeConnectionsLabel(),
            meter: this.connectionUsagePercent(),
        },
        {
            icon: 'live_tv',
            labelKey: 'XTREAM.ACCOUNT_INFO.LIVE_TV',
            value: this.formatOptionalCount(this.data.liveStreamsCount),
            meter: null,
        },
        {
            icon: 'movie',
            labelKey: 'XTREAM.ACCOUNT_INFO.MOVIES',
            value: this.formatOptionalCount(this.data.vodStreamsCount),
            meter: null,
        },
        {
            icon: 'tv',
            labelKey: 'XTREAM.ACCOUNT_INFO.TV_SERIES',
            value: this.formatOptionalCount(this.data.seriesCount),
            meter: null,
        },
    ]);
    readonly vodOverview = computed<VodOverviewStats>(() => {
        const index = this.vodOverviewIndex();
        const groups = index.groups;
        const variants = index.variants;
        const audioLanguage = this.selectedAudioLanguage();
        const subtitleLanguage = this.selectedSubtitleLanguage();
        const sourceMode = this.selectedSourceMode();
        const quality = this.selectedQuality();
        const filteredGroups = groups.filter((group) =>
            this.matchesVodOverviewFilters(
                group,
                audioLanguage,
                subtitleLanguage,
                sourceMode,
                quality
            )
        );
        const filteredVariants = variants.filter((variant) =>
            this.matchesVodOverviewFilters(
                variant,
                audioLanguage,
                subtitleLanguage,
                sourceMode,
                quality
            )
        );
        const indexPercent =
            index.totalItems > 0
                ? Math.min(
                      100,
                      Math.round(
                          (index.processedItems / index.totalItems) * 100
                      )
                  )
                : index.status === 'ready'
                  ? 100
                  : 0;
        const diagnosticSummary = this.summarizeVodOverviewGroups(groups);
        const totalUnique = groups.length;

        return {
            audioOptions: this.relabelLanguageOptions(index.audioOptions),
            audioUnknownUnique: diagnosticSummary.audioUnknownUnique,
            diagnosticCards: this.buildVodDiagnosticCards(
                diagnosticSummary,
                totalUnique
            ),
            diagnosticIssueUnique: diagnosticSummary.diagnosticIssueUnique,
            directUnique: diagnosticSummary.directUnique,
            filteredItems: filteredVariants.length,
            filteredUnique: filteredGroups.length,
            hasData: Array.isArray(this.data.vodStreams),
            indexPercent,
            indexProcessed: index.processedItems,
            indexStatus: index.status,
            indexTotal: index.totalItems,
            indirectUnique: diagnosticSummary.indirectUnique,
            metadataAbsentUnique: diagnosticSummary.metadataAbsentUnique,
            metadataKnownUnique: diagnosticSummary.metadataKnownUnique,
            metadataUnknownUnique:
                totalUnique - diagnosticSummary.metadataKnownUnique,
            metadataUnavailableUnique:
                diagnosticSummary.metadataUnavailableUnique,
            qualityOptions: this.relabelQualityOptions(index.qualityOptions),
            qualityUnknownUnique: diagnosticSummary.qualityUnknownUnique,
            sourceOptions: index.sourceOptions,
            subtitleOptions: this.relabelLanguageOptions(index.subtitleOptions),
            subtitleUnknownUnique: diagnosticSummary.subtitleUnknownUnique,
            totalItems: variants.length,
            totalUnique,
        };
    });
    readonly hasActiveVodOverviewFilters = computed(
        () =>
            this.selectedAudioLanguage() !== ALL_FILTER_VALUE ||
            this.selectedSubtitleLanguage() !== ALL_FILTER_VALUE ||
            this.selectedSourceMode() !== 'all' ||
            this.selectedQuality() !== 'all'
    );
    readonly userDetails = computed<AccountDetailRow[]>(() => [
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.STATUS',
            value: this.accountInfo()?.user_info?.status || '-',
            tone: this.isActive() ? 'positive' : undefined,
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.USERNAME',
            value: this.accountInfo()?.user_info?.username || '-',
            mono: true,
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.ACTIVE_CONNECTIONS',
            value: this.activeConnectionsLabel(),
            tone: 'accent',
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.CREATED',
            value: this.formattedCreatedDate(),
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.EXPIRES',
            value: this.formattedExpDate(),
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.TRIAL_ACCOUNT',
            value: this.isTrial()
                ? 'XTREAM.ACCOUNT_INFO.YES'
                : 'XTREAM.ACCOUNT_INFO.NO',
            translateValue: true,
            tone: this.isTrial() ? 'warning' : undefined,
        },
    ]);
    readonly serverDetails = computed<AccountDetailRow[]>(() => [
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.URL',
            value: this.accountInfo()?.server_info?.url || '-',
            mono: true,
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.PROTOCOL',
            value: this.accountInfo()?.server_info?.server_protocol || '-',
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.TIMEZONE',
            value: this.accountInfo()?.server_info?.timezone || '-',
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.SERVER_TIME',
            value: this.accountInfo()?.server_info?.time_now || '-',
            mono: true,
        },
    ]);

    constructor() {
        this.startVodOverviewIndex();
        void this.reload();
    }

    ngOnDestroy(): void {
        this.vodOverviewIndexRunId++;
        if (this.vodOverviewIndexTimer) {
            clearTimeout(this.vodOverviewIndexTimer);
            this.vodOverviewIndexTimer = null;
        }
    }

    async reload(): Promise<void> {
        const playlist = this.currentPlaylist();

        if (!playlist?.serverUrl || !playlist.username || !playlist.password) {
            this.loadState.set('error');
            this.accountInfo.set(null);
            return;
        }

        this.loadState.set('loading');

        try {
            const accountInfo = await this.xtreamApiService.getAccountInfo({
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
            });

            this.accountInfo.set(accountInfo);
            this.loadState.set('ready');
        } catch (error) {
            this.logger.error('Failed to fetch account info', error);
            this.accountInfo.set(null);
            this.loadState.set('error');
        }
    }

    resetVodOverviewFilters(): void {
        this.selectedAudioLanguage.set(ALL_FILTER_VALUE);
        this.selectedSubtitleLanguage.set(ALL_FILTER_VALUE);
        this.selectedSourceMode.set('all');
        this.selectedQuality.set('all');
    }

    exportVodOverview(format: 'json' | 'csv'): void {
        const descriptors = this.vodOverviewIndex().groups.map((group) => ({
            key: this.resolveGroupKey(group),
            title: this.resolveVariantTitle(group.variants[0]),
            defaultVariantId: this.resolveVariantId(group.variants[0]),
            duplicateCount: group.variants.length,
            quality: this.resolveVariantQualityLabel(group.variants[0]),
            variants: group.variants.map((variant) => {
                const metadata = getXtreamItemLanguageMetadata(
                    this.asLanguageCandidate(variant)
                );

                return {
                    id: this.resolveVariantId(variant),
                    title: this.resolveVariantTitle(variant),
                    quality: getXtreamVodQualityInfo(variant).label,
                    sourceMode: this.getVodSourceMode(variant),
                    audioLanguages: metadata.audioLanguages,
                    subtitleLanguages: metadata.subtitleLanguages,
                    container: variant.container_extension ?? '',
                };
            }),
        }));
        const overview = this.vodOverview();

        if (format === 'json') {
            this.downloadTextFile(
                'iptvnator-vod-overview.json',
                JSON.stringify({ overview, items: descriptors }, null, 2),
                'application/json'
            );
            return;
        }

        const rows = descriptors.reduce<unknown[][]>((acc, item) => {
            item.variants.forEach((variant) => {
                acc.push([
                    item.key,
                    item.title,
                    item.duplicateCount,
                    variant.id,
                    variant.title,
                    variant.quality,
                    variant.sourceMode,
                    variant.audioLanguages.join('|'),
                    variant.subtitleLanguages.join('|'),
                    variant.container,
                ]);
            });
            return acc;
        }, []);
        this.downloadTextFile(
            'iptvnator-vod-overview.csv',
            this.toCsv([
                [
                    'groupKey',
                    'groupTitle',
                    'duplicateCount',
                    'variantId',
                    'variantTitle',
                    'quality',
                    'sourceMode',
                    'audioLanguages',
                    'subtitleLanguages',
                    'container',
                ],
                ...rows,
            ]),
            'text/csv'
        );
    }

    setAudioLanguage(code: string): void {
        this.selectedAudioLanguage.set(code || ALL_FILTER_VALUE);
    }

    setAudioLanguageFromEvent(event: Event): void {
        this.setAudioLanguage(this.readSelectValue(event));
    }

    setQualityFilter(value: VodOverviewQualityFilter): void {
        this.selectedQuality.set(value);
    }

    setQualityFilterFromEvent(event: Event): void {
        const value = this.readSelectValue(event);

        this.selectedQuality.set(this.isQualityFilter(value) ? value : 'all');
    }

    setSourceMode(value: VodOverviewSourceFilter): void {
        this.selectedSourceMode.set(value);
    }

    setSourceModeFromEvent(event: Event): void {
        const value = this.readSelectValue(event);

        this.selectedSourceMode.set(this.isSourceFilter(value) ? value : 'all');
    }

    setSubtitleLanguage(code: string): void {
        this.selectedSubtitleLanguage.set(code || ALL_FILTER_VALUE);
    }

    setSubtitleLanguageFromEvent(event: Event): void {
        this.setSubtitleLanguage(this.readSelectValue(event));
    }

    private startVodOverviewIndex(): void {
        const streams = this.data.vodStreams ?? [];
        const runId = ++this.vodOverviewIndexRunId;
        const accumulator = this.createVodOverviewAccumulator();
        let processedItems = 0;

        if (this.vodOverviewIndexTimer) {
            clearTimeout(this.vodOverviewIndexTimer);
            this.vodOverviewIndexTimer = null;
        }

        this.publishVodOverviewIndex(
            accumulator,
            streams.length > 0 ? 'running' : 'ready',
            processedItems,
            streams.length
        );

        const processChunk = (): void => {
            if (runId !== this.vodOverviewIndexRunId) {
                return;
            }

            const chunkEnd = Math.min(
                processedItems + VOD_OVERVIEW_INDEX_CHUNK_SIZE,
                streams.length
            );
            for (let index = processedItems; index < chunkEnd; index++) {
                this.processVodOverviewItem(accumulator, streams[index]);
            }
            processedItems = chunkEnd;

            const isComplete = processedItems >= streams.length;
            this.publishVodOverviewIndex(
                accumulator,
                isComplete ? 'ready' : 'running',
                processedItems,
                streams.length
            );

            if (isComplete) {
                return;
            }

            this.vodOverviewIndexTimer = setTimeout(
                processChunk,
                VOD_OVERVIEW_INDEX_IDLE_DELAY_MS
            );
        };

        processChunk();
    }

    private createVodOverviewAccumulator(): VodOverviewAccumulator {
        return {
            audioCounts: new Map<string, number>(),
            groupsByKey: new Map<string, VodOverviewDescriptor>(),
            qualityCounts: new Map<
                Exclude<VodOverviewQualityFilter, 'all'>,
                number
            >(),
            sourceCounts: new Map<
                Exclude<VodOverviewSourceFilter, 'all'>,
                number
            >(),
            subtitleCounts: new Map<string, number>(),
            variants: [],
        };
    }

    private processVodOverviewItem(
        accumulator: VodOverviewAccumulator,
        item: XtreamAccountInfoVodStreamItem
    ): void {
        const descriptor = this.describeVodVariant(item);
        accumulator.variants.push(descriptor);
        descriptor.audioLanguages.forEach((code) =>
            this.incrementCount(accumulator.audioCounts, code)
        );
        descriptor.subtitleLanguages.forEach((code) =>
            this.incrementCount(accumulator.subtitleCounts, code)
        );
        descriptor.qualityBuckets.forEach((bucket) =>
            this.incrementCount(accumulator.qualityCounts, bucket)
        );
        descriptor.sourceModes.forEach((mode) =>
            this.incrementCount(accumulator.sourceCounts, mode)
        );

        const groupKey =
            getXtreamVodDuplicateKey(item) ?? this.resolveVariantId(item);
        const existing = accumulator.groupsByKey.get(groupKey);
        if (existing) {
            this.mergeVodOverviewDescriptor(existing, descriptor);
        } else {
            accumulator.groupsByKey.set(groupKey, { ...descriptor });
        }
    }

    private describeVodVariant(
        item: XtreamAccountInfoVodStreamItem
    ): VodOverviewDescriptor {
        const metadata = getXtreamItemLanguageMetadata(
            this.asLanguageCandidate(item)
        );

        return {
            audioLanguages: metadata.audioLanguages,
            qualityBuckets: this.getVodQualityBuckets(item),
            sourceModes: [this.getVodSourceMode(item)],
            subtitleLanguages: metadata.subtitleLanguages,
            variants: [item],
        };
    }

    private mergeVodOverviewDescriptor(
        target: VodOverviewDescriptor,
        source: VodOverviewDescriptor
    ): void {
        target.audioLanguages = this.uniqueStrings([
            ...target.audioLanguages,
            ...source.audioLanguages,
        ]);
        target.subtitleLanguages = this.uniqueStrings([
            ...target.subtitleLanguages,
            ...source.subtitleLanguages,
        ]);
        target.qualityBuckets = this.uniqueStrings([
            ...target.qualityBuckets,
            ...source.qualityBuckets,
        ]);
        target.sourceModes = this.uniqueStrings([
            ...target.sourceModes,
            ...source.sourceModes,
        ]);
        target.variants = [...target.variants, ...source.variants];
    }

    private publishVodOverviewIndex(
        accumulator: VodOverviewAccumulator,
        status: VodOverviewIndex['status'],
        processedItems: number,
        totalItems: number
    ): void {
        this.vodOverviewIndex.set({
            audioOptions: this.buildLanguageOptionsFromCounts(
                accumulator.audioCounts
            ),
            groups: [...accumulator.groupsByKey.values()],
            processedItems,
            qualityOptions: this.buildQualityOptionsFromCounts(
                accumulator.qualityCounts
            ),
            sourceOptions: this.buildSourceOptionsFromCounts(
                accumulator.sourceCounts
            ),
            status,
            subtitleOptions: this.buildLanguageOptionsFromCounts(
                accumulator.subtitleCounts
            ),
            totalItems,
            variants: [...accumulator.variants],
        });
    }

    private createEmptyVodOverviewIndex(): VodOverviewIndex {
        return {
            audioOptions: [],
            groups: [],
            processedItems: 0,
            qualityOptions: [],
            sourceOptions: this.buildSourceOptionsFromCounts(new Map()),
            status: 'idle',
            subtitleOptions: [],
            totalItems: 0,
            variants: [],
        };
    }

    private buildLanguageOptionsFromCounts(
        counts: ReadonlyMap<string, number>
    ): VodOverviewLanguageOption[] {
        const labelsByCode = new Map(
            getXtreamLanguageOptionsFromCodes(
                counts.keys(),
                undefined,
                this.appLanguage()
            ).map((option) => [option.code, option.label])
        );

        return [...counts.entries()]
            .map(([code, count]) => ({
                code,
                count,
                label: labelsByCode.get(code) ?? code.toUpperCase(),
            }))
            .sort((a, b) =>
                a.label.localeCompare(b.label, this.appLanguage(), {
                    sensitivity: 'base',
                })
            );
    }

    private relabelLanguageOptions(
        options: readonly VodOverviewLanguageOption[]
    ): VodOverviewLanguageOption[] {
        const labelsByCode = new Map(
            getXtreamLanguageOptionsFromCodes(
                options.map((option) => option.code),
                undefined,
                this.appLanguage()
            ).map((option) => [option.code, option.label])
        );

        return options
            .map((option) => ({
                ...option,
                label:
                    labelsByCode.get(option.code) ?? option.code.toUpperCase(),
            }))
            .sort((a, b) =>
                a.label.localeCompare(b.label, this.appLanguage(), {
                    sensitivity: 'base',
                })
            );
    }

    private appLanguage(): string {
        return String(this.settingsStore?.language?.() ?? 'en');
    }

    private buildQualityOptionsFromCounts(
        counts: ReadonlyMap<Exclude<VodOverviewQualityFilter, 'all'>, number>
    ): VodOverviewQualityOption[] {
        return QUALITY_FILTER_OPTIONS.map((option) => ({
            ...option,
            label: getXtreamVideoQualityLabel(option.value, this.appLanguage()),
            count: counts.get(option.value) ?? 0,
        })).filter((option) => option.count > 0);
    }

    private relabelQualityOptions(
        options: readonly VodOverviewQualityOption[]
    ): VodOverviewQualityOption[] {
        return options.map((option) => ({
            ...option,
            label: getXtreamVideoQualityLabel(option.value, this.appLanguage()),
        }));
    }

    private buildSourceOptionsFromCounts(
        counts: ReadonlyMap<Exclude<VodOverviewSourceFilter, 'all'>, number>
    ): VodOverviewSourceOption[] {
        return SOURCE_FILTER_OPTIONS.map((option) => ({
            ...option,
            count: counts.get(option.value) ?? 0,
        }));
    }

    private summarizeVodOverviewGroups(
        groups: readonly VodOverviewDescriptor[]
    ): VodOverviewDiagnosticSummary {
        const summary: VodOverviewDiagnosticSummary = {
            audioUnknownUnique: 0,
            diagnosticIssueUnique: 0,
            directUnique: 0,
            indirectUnique: 0,
            metadataAbsentUnique: 0,
            metadataKnownUnique: 0,
            metadataUnavailableUnique: 0,
            qualityUnknownUnique: 0,
            subtitleUnknownUnique: 0,
        };

        for (const group of groups) {
            const audioUnknown = group.audioLanguages.length === 0;
            const subtitleUnknown = group.subtitleLanguages.length === 0;
            const qualityUnknown = !this.hasKnownVodQuality(group);
            const metadataAbsent = !this.hasAnyVodMediaMetadata(group);
            const metadataUnavailable =
                this.hasUnavailableVodMediaMetadata(group);

            if (group.sourceModes.includes('direct')) {
                summary.directUnique++;
            }
            if (group.sourceModes.includes('indirect')) {
                summary.indirectUnique++;
            }
            if (this.hasKnownVodMetadata(group)) {
                summary.metadataKnownUnique++;
            }
            if (audioUnknown) {
                summary.audioUnknownUnique++;
            }
            if (subtitleUnknown) {
                summary.subtitleUnknownUnique++;
            }
            if (qualityUnknown) {
                summary.qualityUnknownUnique++;
            }
            if (metadataAbsent) {
                summary.metadataAbsentUnique++;
            }
            if (metadataUnavailable) {
                summary.metadataUnavailableUnique++;
            }
            if (
                audioUnknown ||
                subtitleUnknown ||
                qualityUnknown ||
                metadataAbsent ||
                metadataUnavailable
            ) {
                summary.diagnosticIssueUnique++;
            }
        }

        return summary;
    }

    private buildVodDiagnosticCards(
        summary: VodOverviewDiagnosticSummary,
        totalUnique: number
    ): VodOverviewDiagnosticCard[] {
        return [
            this.createVodDiagnosticCard({
                descriptionKey:
                    'XTREAM.ACCOUNT_INFO.DIAGNOSTIC_AUDIO_MISSING_HINT',
                icon: 'record_voice_over',
                labelKey: 'XTREAM.ACCOUNT_INFO.DIAGNOSTIC_AUDIO_MISSING',
                totalUnique,
                value: summary.audioUnknownUnique,
            }),
            this.createVodDiagnosticCard({
                descriptionKey:
                    'XTREAM.ACCOUNT_INFO.DIAGNOSTIC_SUBTITLE_MISSING_HINT',
                icon: 'subtitles',
                labelKey: 'XTREAM.ACCOUNT_INFO.DIAGNOSTIC_SUBTITLE_MISSING',
                totalUnique,
                value: summary.subtitleUnknownUnique,
            }),
            this.createVodDiagnosticCard({
                descriptionKey:
                    'XTREAM.ACCOUNT_INFO.DIAGNOSTIC_QUALITY_MISSING_HINT',
                icon: 'high_quality',
                labelKey: 'XTREAM.ACCOUNT_INFO.DIAGNOSTIC_QUALITY_MISSING',
                totalUnique,
                value: summary.qualityUnknownUnique,
            }),
            this.createVodDiagnosticCard({
                descriptionKey:
                    'XTREAM.ACCOUNT_INFO.DIAGNOSTIC_METADATA_ABSENT_HINT',
                icon: 'storage',
                labelKey: 'XTREAM.ACCOUNT_INFO.DIAGNOSTIC_METADATA_ABSENT',
                totalUnique,
                value: summary.metadataAbsentUnique,
            }),
            this.createVodDiagnosticCard({
                descriptionKey:
                    'XTREAM.ACCOUNT_INFO.DIAGNOSTIC_PROBE_UNAVAILABLE_HINT',
                icon: 'report_problem',
                labelKey: 'XTREAM.ACCOUNT_INFO.DIAGNOSTIC_PROBE_UNAVAILABLE',
                totalUnique,
                value: summary.metadataUnavailableUnique,
            }),
        ];
    }

    private createVodDiagnosticCard(params: {
        descriptionKey: string;
        icon: string;
        labelKey: string;
        totalUnique: number;
        value: number;
    }): VodOverviewDiagnosticCard {
        const percent =
            params.totalUnique > 0
                ? Math.round((params.value / params.totalUnique) * 100)
                : 0;

        return {
            descriptionKey: params.descriptionKey,
            icon: params.icon,
            labelKey: params.labelKey,
            percent,
            tone:
                params.value === 0
                    ? 'neutral'
                    : percent >= 25
                      ? 'danger'
                      : 'warning',
            total: params.totalUnique,
            value: params.value,
        };
    }

    private hasKnownVodMetadata(group: VodOverviewDescriptor): boolean {
        return (
            group.audioLanguages.length > 0 ||
            group.subtitleLanguages.length > 0 ||
            this.hasKnownVodQuality(group)
        );
    }

    private hasKnownVodQuality(group: VodOverviewDescriptor): boolean {
        return group.qualityBuckets.some((quality) => quality !== 'unknown');
    }

    private hasAnyVodMediaMetadata(group: VodOverviewDescriptor): boolean {
        return group.variants.some((variant) => Boolean(variant.mediaMetadata));
    }

    private hasUnavailableVodMediaMetadata(
        group: VodOverviewDescriptor
    ): boolean {
        const hasAvailable = group.variants.some(
            (variant) => variant.mediaMetadata?.available === true
        );
        if (hasAvailable) {
            return false;
        }

        return group.variants.some(
            (variant) => variant.mediaMetadata?.available === false
        );
    }

    private matchesVodOverviewFilters(
        group: VodOverviewDescriptor,
        audioLanguage: string,
        subtitleLanguage: string,
        sourceMode: VodOverviewSourceFilter,
        quality: VodOverviewQualityFilter
    ): boolean {
        return (
            this.matchesLanguageSelection(
                group.audioLanguages,
                audioLanguage
            ) &&
            this.matchesLanguageSelection(
                group.subtitleLanguages,
                subtitleLanguage
            ) &&
            (sourceMode === 'all' || group.sourceModes.includes(sourceMode)) &&
            (quality === 'all' || group.qualityBuckets.includes(quality))
        );
    }

    private matchesLanguageSelection(
        availableLanguages: readonly string[],
        selectedLanguage: string
    ): boolean {
        return (
            selectedLanguage === ALL_FILTER_VALUE ||
            availableLanguages.includes(selectedLanguage)
        );
    }

    private getVodQualityBuckets(
        item: XtreamAccountInfoVodStreamItem
    ): Array<Exclude<VodOverviewQualityFilter, 'all'>> {
        return getXtreamItemVideoQualityBuckets(
            item as unknown as Record<string, unknown>
        ) as Array<Exclude<VodOverviewQualityFilter, 'all'>>;
    }

    private getVodSourceMode(
        item: XtreamAccountInfoVodStreamItem
    ): Exclude<VodOverviewSourceFilter, 'all'> {
        return this.hasDirectSource(item.direct_source) ? 'direct' : 'indirect';
    }

    private hasDirectSource(value: unknown): boolean {
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();

            return (
                normalized.length > 0 &&
                normalized !== 'null' &&
                normalized !== 'undefined'
            );
        }

        return Boolean(value);
    }

    private resolveVariantId(item: XtreamAccountInfoVodStreamItem): string {
        return String(
            item.stream_id ??
                item.xtream_id ??
                item.id ??
                item.movie_data?.stream_id ??
                ''
        );
    }

    private resolveGroupKey(group: VodOverviewDescriptor): string {
        const firstVariant = group.variants[0];
        return firstVariant
            ? (getXtreamVodDuplicateKey(firstVariant) ??
                  this.resolveVariantId(firstVariant))
            : '';
    }

    private resolveVariantTitle(item?: XtreamAccountInfoVodStreamItem): string {
        return String(item?.name ?? item?.title ?? item?.o_name ?? '');
    }

    private resolveVariantQualityLabel(
        item?: XtreamAccountInfoVodStreamItem
    ): string {
        return item ? getXtreamVodQualityInfo(item).label : '';
    }

    private incrementCount<T extends string>(
        counts: Map<T, number>,
        key: T
    ): void {
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    private downloadTextFile(
        filename: string,
        contents: string,
        type: string
    ): void {
        if (typeof document === 'undefined') {
            return;
        }

        const blob = new Blob([contents], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    private toCsv(rows: readonly unknown[][]): string {
        return rows
            .map((row) =>
                row
                    .map((cell) => {
                        const value = String(cell ?? '');
                        return `"${value.replace(/"/g, '""')}"`;
                    })
                    .join(',')
            )
            .join('\r\n');
    }

    private readSelectValue(event: Event): string {
        return (event.target as HTMLSelectElement | null)?.value ?? 'all';
    }

    private isQualityFilter(value: string): value is VodOverviewQualityFilter {
        return (
            value === 'all' ||
            QUALITY_FILTER_OPTIONS.some((option) => option.value === value)
        );
    }

    private isSourceFilter(value: string): value is VodOverviewSourceFilter {
        return (
            value === 'all' ||
            SOURCE_FILTER_OPTIONS.some((option) => option.value === value)
        );
    }

    private uniqueStrings<T extends string>(values: readonly T[]): T[] {
        return [...new Set(values.filter(Boolean))];
    }

    private asLanguageCandidate(
        item: XtreamAccountInfoVodStreamItem
    ): XtreamLanguageFilterCandidate {
        return item as unknown as XtreamLanguageFilterCandidate;
    }

    private formatUnixDate(timestamp?: string): string {
        const value = Number.parseInt(timestamp ?? '', 10);

        if (!Number.isFinite(value) || value <= 0) {
            return '-';
        }

        return new Date(value * 1000).toLocaleDateString();
    }

    private parseNumber(value?: string): number {
        const parsed = Number.parseInt(value ?? '', 10);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    private formatOptionalCount(value?: number): string {
        return Number.isFinite(value) ? String(value) : '-';
    }
}
