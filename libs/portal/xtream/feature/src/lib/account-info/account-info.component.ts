import {
    ChangeDetectionStrategy,
    Component,
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
    getXtreamLanguageOptions,
    getXtreamVodQualityInfo,
    groupXtreamVodDuplicates,
    XtreamAccountInfo,
    XtreamApiService,
    XtreamStore,
    type XtreamLanguageFilterCandidate,
    type XtreamVodDuplicateDecorated,
} from '@iptvnator/portal/xtream/data-access';
import { createLogger } from '@iptvnator/portal/shared/util';
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
type VodOverviewGroup =
    XtreamVodDuplicateDecorated<XtreamAccountInfoVodStreamItem>;

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

interface VodOverviewDescriptor {
    audioLanguages: string[];
    qualityBuckets: Array<Exclude<VodOverviewQualityFilter, 'all'>>;
    sourceModes: Array<Exclude<VodOverviewSourceFilter, 'all'>>;
    subtitleLanguages: string[];
    variants: XtreamAccountInfoVodStreamItem[];
}

interface VodOverviewStats {
    audioOptions: VodOverviewLanguageOption[];
    directUnique: number;
    filteredUnique: number;
    hasData: boolean;
    indirectUnique: number;
    metadataKnownUnique: number;
    metadataUnknownUnique: number;
    qualityOptions: VodOverviewQualityOption[];
    sourceOptions: VodOverviewSourceOption[];
    subtitleOptions: VodOverviewLanguageOption[];
    totalUnique: number;
}

const ALL_FILTER_VALUE = 'all';
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
        label: 'Non rilevata',
    },
];

@Component({
    selector: 'app-account-info',
    imports: [MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
    templateUrl: './account-info.component.html',
    styleUrl: './account-info.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountInfoComponent {
    readonly data =
        inject<XtreamAccountInfoDialogData | null>(MAT_DIALOG_DATA, {
            optional: true,
        }) ?? {};
    private readonly xtreamApiService = inject(XtreamApiService);
    private readonly xtreamStore = inject(XtreamStore);
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
    readonly uniqueVodGroups = computed<VodOverviewGroup[]>(() =>
        groupXtreamVodDuplicates(this.data.vodStreams ?? [])
    );
    readonly vodOverview = computed<VodOverviewStats>(() => {
        const groups = this.uniqueVodGroups().map((item) =>
            this.describeVodGroup(item)
        );
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

        return {
            audioOptions: this.buildLanguageOptions(groups, 'audio'),
            directUnique: this.countGroups(groups, (group) =>
                group.sourceModes.includes('direct')
            ),
            filteredUnique: filteredGroups.length,
            hasData: Array.isArray(this.data.vodStreams),
            indirectUnique: this.countGroups(groups, (group) =>
                group.sourceModes.includes('indirect')
            ),
            metadataKnownUnique: this.countGroups(groups, (group) =>
                this.hasKnownVodMetadata(group)
            ),
            metadataUnknownUnique: this.countGroups(
                groups,
                (group) => !this.hasKnownVodMetadata(group)
            ),
            qualityOptions: this.buildQualityOptions(groups),
            sourceOptions: this.buildSourceOptions(groups),
            subtitleOptions: this.buildLanguageOptions(groups, 'subtitle'),
            totalUnique: groups.length,
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
        void this.reload();
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
        const descriptors = this.uniqueVodGroups().map((group) => ({
            key: group.duplicateGroupKey ?? this.resolveVariantId(group),
            title: group.name ?? group.title ?? group.o_name ?? '',
            defaultVariantId: this.resolveVariantId(group),
            duplicateCount: group.duplicateCount ?? 1,
            quality: group.duplicateQualityLabel ?? '',
            variants: this.getVodVariants(group).map((variant) => {
                const metadata = getXtreamItemLanguageMetadata(
                    this.asLanguageCandidate(variant)
                );

                return {
                    id: this.resolveVariantId(variant),
                    title: variant.name ?? variant.title ?? '',
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

    private describeVodGroup(item: VodOverviewGroup): VodOverviewDescriptor {
        const variants = this.getVodVariants(item);
        const audioLanguages: string[] = [];
        const subtitleLanguages: string[] = [];
        const qualityBuckets: Array<Exclude<VodOverviewQualityFilter, 'all'>> =
            [];
        const sourceModes: Array<Exclude<VodOverviewSourceFilter, 'all'>> = [];

        for (const variant of variants) {
            const metadata = getXtreamItemLanguageMetadata(
                this.asLanguageCandidate(variant)
            );
            audioLanguages.push(...metadata.audioLanguages);
            subtitleLanguages.push(...metadata.subtitleLanguages);
            qualityBuckets.push(this.getVodQualityBucket(variant));
            sourceModes.push(this.getVodSourceMode(variant));
        }

        return {
            audioLanguages: this.uniqueStrings(audioLanguages),
            qualityBuckets: this.uniqueStrings(qualityBuckets),
            sourceModes: this.uniqueStrings(sourceModes),
            subtitleLanguages: this.uniqueStrings(subtitleLanguages),
            variants,
        };
    }

    private getVodVariants(
        item: VodOverviewGroup
    ): XtreamAccountInfoVodStreamItem[] {
        if (item.duplicateVariants?.length) {
            return item.duplicateVariants;
        }

        return [item];
    }

    private buildLanguageOptions(
        groups: readonly VodOverviewDescriptor[],
        axis: 'audio' | 'subtitle'
    ): VodOverviewLanguageOption[] {
        const counts = new Map<string, number>();

        for (const group of groups) {
            const languages =
                axis === 'audio'
                    ? group.audioLanguages
                    : group.subtitleLanguages;

            for (const language of languages) {
                counts.set(language, (counts.get(language) ?? 0) + 1);
            }
        }

        const labelsByCode = new Map(
            getXtreamLanguageOptions(
                (this.data.vodStreams ??
                    []) as unknown as XtreamLanguageFilterCandidate[]
            ).map((option) => [option.code, option.label])
        );

        return [...counts.entries()]
            .map(([code, count]) => ({
                code,
                count,
                label: labelsByCode.get(code) ?? code.toUpperCase(),
            }))
            .sort((a, b) =>
                a.label.localeCompare(b.label, undefined, {
                    sensitivity: 'base',
                })
            );
    }

    private buildQualityOptions(
        groups: readonly VodOverviewDescriptor[]
    ): VodOverviewQualityOption[] {
        return QUALITY_FILTER_OPTIONS.map((option) => ({
            ...option,
            count: this.countGroups(groups, (group) =>
                group.qualityBuckets.includes(option.value)
            ),
        })).filter((option) => option.count > 0);
    }

    private buildSourceOptions(
        groups: readonly VodOverviewDescriptor[]
    ): VodOverviewSourceOption[] {
        return SOURCE_FILTER_OPTIONS.map((option) => ({
            ...option,
            count: this.countGroups(groups, (group) =>
                group.sourceModes.includes(option.value)
            ),
        }));
    }

    private countGroups(
        groups: readonly VodOverviewDescriptor[],
        predicate: (group: VodOverviewDescriptor) => boolean
    ): number {
        return groups.reduce(
            (count, group) => count + (predicate(group) ? 1 : 0),
            0
        );
    }

    private hasKnownVodMetadata(group: VodOverviewDescriptor): boolean {
        return (
            group.audioLanguages.length > 0 ||
            group.subtitleLanguages.length > 0 ||
            group.qualityBuckets.some((quality) => quality !== 'unknown')
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

    private getVodQualityBucket(
        item: XtreamAccountInfoVodStreamItem
    ): Exclude<VodOverviewQualityFilter, 'all'> {
        const metadataHeight = item.mediaMetadata?.height;
        const height =
            typeof metadataHeight === 'number' &&
            Number.isFinite(metadataHeight) &&
            metadataHeight > 0
                ? metadataHeight
                : getXtreamVodQualityInfo(item).height;

        if (!height) {
            return 'unknown';
        }

        if (height >= 2160) {
            return '2160p';
        }

        if (height >= 1440) {
            return '1440p';
        }

        if (height >= 1080) {
            return '1080p';
        }

        if (height >= 720) {
            return '720p';
        }

        return 'sd';
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
