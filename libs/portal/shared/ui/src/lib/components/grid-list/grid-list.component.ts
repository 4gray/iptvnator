import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { ProgressCapsuleComponent, WatchedBadgeComponent } from 'components';
import {
    buildMediaStreamMetadata,
    getMediaMetadataTags,
    mergeMediaStreamMetadata,
} from '@iptvnator/portal/shared/util';
import { MediaStreamMetadata } from 'shared-interfaces';
import { PlaylistErrorViewComponent } from '../playlist-error-view/playlist-error-view.component';

export interface GridListItem {
    id?: number | string;
    is_series?: number | string | boolean;
    xtream_id?: number | string;
    series_id?: number | string;
    stream_id?: number | string;
    category_id?: number | string;
    poster_url?: string;
    cover?: string;
    duplicateCount?: number;
    duplicateGroupKey?: string;
    duplicateQualityLabel?: string;
    title?: string;
    o_name?: string;
    name?: string;
    imdbRating?: string | number;
    imdbVotes?: number;
    imdbMatchedTitle?: string;
    imdbMatchedYear?: number;
    imdbMatchConfidence?: number;
    imdbMatchReason?: string;
    rating?: string | number;
    rating_imdb?: string | number;
    audioLanguages?: string[];
    subtitleLanguages?: string[];
    mediaMetadata?: MediaStreamMetadata;
    container_extension?: string;
    duplicateVariants?: GridListItem[];
    info?: Record<string, unknown> | [] | null;
    movie_data?: Record<string, unknown> | null;
    progress?: number;
    isWatched?: boolean;
    hasSeriesProgress?: boolean;
    [key: string]: unknown;
}

export function formatGridRating(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toFixed(1);
    }

    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    const numericRating = Number.parseFloat(trimmed);
    return Number.isFinite(numericRating) ? numericRating.toFixed(1) : trimmed;
}

export function resolveGridRating(
    item: Pick<GridListItem, 'imdbRating' | 'rating' | 'rating_imdb'>
): string | undefined {
    return (
        formatGridRating(item.imdbRating) ?? formatGridRating(item.rating_imdb)
    );
}

export function resolveGridRatingTooltip(
    item: Pick<
        GridListItem,
        | 'imdbRating'
        | 'rating_imdb'
        | 'imdbMatchedTitle'
        | 'imdbMatchedYear'
        | 'imdbMatchConfidence'
        | 'imdbMatchReason'
        | 'imdbVotes'
    >
): string {
    const rating = resolveGridRating(item);
    if (!rating) {
        return '';
    }

    const source =
        item.imdbMatchReason === 'provider-rating_imdb'
            ? 'IMDb provider'
            : 'IMDb';
    const details = [
        item.imdbMatchedTitle
            ? `${item.imdbMatchedTitle}${
                  item.imdbMatchedYear ? ` (${item.imdbMatchedYear})` : ''
              }`
            : undefined,
        typeof item.imdbMatchConfidence === 'number'
            ? `confidence ${Math.round(item.imdbMatchConfidence * 100)}%`
            : undefined,
        item.imdbMatchReason ? `match ${item.imdbMatchReason}` : undefined,
        typeof item.imdbVotes === 'number'
            ? `${item.imdbVotes.toLocaleString('en-US')} votes`
            : undefined,
    ].filter((value): value is string => Boolean(value));

    return details.length
        ? `${source} ${rating}: ${details.join(' - ')}`
        : `${source} ${rating}`;
}

export function resolveGridDuplicateTooltip(
    item: Pick<
        GridListItem,
        'duplicateCount' | 'duplicateGroupKey' | 'duplicateQualityLabel'
    >
): string {
    if (!item.duplicateCount || item.duplicateCount <= 1) {
        return '';
    }

    return [
        `${item.duplicateCount} variants`,
        item.duplicateQualityLabel
            ? `default ${item.duplicateQualityLabel}`
            : undefined,
        item.duplicateGroupKey ? `key ${item.duplicateGroupKey}` : undefined,
    ]
        .filter((value): value is string => Boolean(value))
        .join(' - ');
}

export function resolveGridMediaTags(item: GridListItem): string[] {
    const variants =
        item.duplicateVariants && item.duplicateVariants.length > 0
            ? item.duplicateVariants
            : [item];
    const metadata = variants.reduce<MediaStreamMetadata | null>(
        (mergedMetadata, variant) =>
            mergeGridMediaMetadata(
                mergedMetadata,
                resolveSingleGridItemMetadata(variant)
            ),
        null
    );

    return getMediaMetadataTags(metadata).slice(0, 3);
}

function resolveSingleGridItemMetadata(
    item: GridListItem
): MediaStreamMetadata | null {
    const info = item.info && !Array.isArray(item.info) ? item.info : null;
    const movieData = item.movie_data ?? null;
    const containerExtension =
        item.container_extension ??
        readString(movieData, 'container_extension') ??
        readString(info, 'container_extension');
    const title = [
        item.title,
        item.o_name,
        item.name,
        readString(movieData, 'title'),
        readString(movieData, 'name'),
        readString(info, 'title'),
        readString(info, 'name'),
    ]
        .filter((value): value is string => Boolean(value))
        .join(' ');
    const titleHints = `${title} ${containerExtension ?? ''}`;
    const videoCodec = extractVideoCodecFromTitle(titleHints);
    const audioLanguages =
        item.audioLanguages?.length || readValue(info, 'audio')
            ? (item.audioLanguages ?? readValue(info, 'audio'))
            : extractAudioLanguageTagsFromTitle(titleHints);
    const subtitleLanguages =
        item.subtitleLanguages?.length ||
        readValue(info, 'subtitles') ||
        readValue(info, 'subtitle')
            ? (item.subtitleLanguages ??
              readValue(info, 'subtitles') ??
              readValue(info, 'subtitle'))
            : extractSubtitleLanguageTagsFromTitle(titleHints);

    const staticMetadata = buildMediaStreamMetadata({
        video: [
            readValue(info, 'video'),
            videoCodec ? { codec: videoCodec } : null,
        ],
        audio: audioLanguages ?? readValue(movieData, 'audio'),
        subtitles: subtitleLanguages ?? readValue(movieData, 'subtitles'),
        title,
        containerExtension,
    });

    return mergeMediaStreamMetadata(item.mediaMetadata, staticMetadata);
}

function mergeGridMediaMetadata(
    current: MediaStreamMetadata | null,
    next: MediaStreamMetadata | null
): MediaStreamMetadata | null {
    const merged = mergeMediaStreamMetadata(current, next);
    if (!current || !next || !merged) {
        return merged;
    }

    const currentHeight = resolveMetadataHeight(current);
    const nextHeight = resolveMetadataHeight(next);
    if (nextHeight <= currentHeight) {
        return merged;
    }

    return {
        ...merged,
        qualityLabel: next.qualityLabel ?? merged.qualityLabel,
        width: next.width ?? merged.width,
        height: next.height ?? merged.height,
        videoCodec: next.videoCodec ?? merged.videoCodec,
    };
}

function resolveMetadataHeight(metadata: MediaStreamMetadata): number {
    if (
        typeof metadata.height === 'number' &&
        Number.isFinite(metadata.height)
    ) {
        return metadata.height;
    }

    const match = metadata.qualityLabel?.match(/\b(\d{3,4})p\b/i);
    return match ? Number.parseInt(match[1], 10) : 0;
}

function readValue(
    record: Record<string, unknown> | null,
    key: string
): unknown {
    return record?.[key];
}

function readString(
    record: Record<string, unknown> | null,
    key: string
): string | null {
    const value = readValue(record, key);
    return typeof value === 'string' && value.trim() ? value : null;
}

function extractVideoCodecFromTitle(text: string): string | null {
    const normalized = text.toLowerCase();
    if (/\b(?:x265|h265|h\.265|hevc)\b/.test(normalized)) {
        return 'hevc';
    }
    if (/\b(?:x264|h264|h\.264|avc)\b/.test(normalized)) {
        return 'h264';
    }
    if (/\bav1\b/.test(normalized)) {
        return 'av1';
    }
    return null;
}

function extractAudioLanguageTagsFromTitle(text: string): string[] {
    const normalized = normalizeTitleTagText(text);
    const tags = new Set<string>();

    for (const [pattern, label] of STRICT_LANGUAGE_TAGS) {
        if (
            pattern.test(normalized) &&
            !isSubtitleOnlyTag(normalized, pattern)
        ) {
            tags.add(label);
        }
    }

    if (/\b(?:multi|multiaudio|dual\s*audio)\b/.test(normalized)) {
        tags.add('MULTI');
    }

    return [...tags];
}

function extractSubtitleLanguageTagsFromTitle(text: string): string[] {
    const normalized = normalizeTitleTagText(text);
    const tags = new Set<string>();

    for (const [pattern, label] of STRICT_LANGUAGE_TAGS) {
        if (
            new RegExp(
                `\\b(?:sub|subs|subtitle|subtitles|sottotitoli|vost|vose)\\s*[-_.: ]*${pattern.source}\\b`
            ).test(normalized) ||
            new RegExp(`\\bvost${pattern.source}\\b`).test(normalized)
        ) {
            tags.add(label);
        }
    }

    return [...tags];
}

const STRICT_LANGUAGE_TAGS: Array<[RegExp, string]> = [
    [/\bita\b/, 'ITA'],
    [/\beng\b/, 'ENG'],
    [/\ben\b/, 'ENG'],
    [/\bspa\b/, 'SPA'],
    [/\bes\b/, 'SPA'],
    [/\bfra\b/, 'FRA'],
    [/\bfre\b/, 'FRA'],
    [/\bfr\b/, 'FRA'],
    [/\bdeu\b/, 'DEU'],
    [/\bger\b/, 'DEU'],
    [/\bde\b/, 'DEU'],
    [/\bpor\b/, 'POR'],
    [/\bpt\b/, 'POR'],
    [/\brus\b/, 'RUS'],
    [/\bru\b/, 'RUS'],
    [/\bjpn\b/, 'JPN'],
    [/\bjp\b/, 'JPN'],
    [/\bkor\b/, 'KOR'],
    [/\bkr\b/, 'KOR'],
];

function normalizeTitleTagText(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[\u2019']/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function isSubtitleOnlyTag(text: string, pattern: RegExp): boolean {
    return new RegExp(
        `\\b(?:sub|subs|subtitle|subtitles|sottotitoli|vost|vose)\\s*[-_.: ]*${pattern.source}\\b`
    ).test(text);
}

@Component({
    selector: 'app-grid-list',
    template: `<div class="grid-list__grid">
            @if (isLoading()) {
                @for (row of skeletonRows(); track row) {
                    <div class="grid-skeleton-card" aria-hidden="true">
                        <div class="grid-skeleton-thumb">
                            <span class="grid-skeleton-badge"></span>
                        </div>
                        <div class="grid-skeleton-title">
                            <span
                                class="grid-skeleton-line grid-skeleton-line--primary"
                            ></span>
                            <span
                                class="grid-skeleton-line grid-skeleton-line--secondary"
                            ></span>
                        </div>
                    </div>
                }
            } @else {
                @for (item of items(); track $index) {
                    @let i = $any(item);
                    <mat-card (click)="itemClicked.emit(item)">
                        @let poster = i.poster_url ?? i.cover;
                        <div class="card-thumbnail-container">
                            <img
                                class="stream-icon"
                                [src]="
                                    poster ||
                                    './assets/images/default-poster.png'
                                "
                                (error)="
                                    $event.target.src =
                                        './assets/images/default-poster.png'
                                "
                                loading="lazy"
                                alt="logo"
                            />
                            @if (i.progress && i.progress > 0) {
                                <app-progress-capsule [progress]="i.progress" />
                            }
                            @if (i.isWatched) {
                                <app-watched-badge
                                    [isWatched]="true"
                                    icon="check_circle"
                                />
                            } @else if (i.hasSeriesProgress) {
                                <app-watched-badge
                                    [isWatched]="true"
                                    icon="remove_red_eye"
                                />
                            }
                            @if (i.duplicateCount && i.duplicateCount > 1) {
                                <div
                                    class="duplicate-badge"
                                    [matTooltip]="resolveDuplicateTooltip(i)"
                                >
                                    <mat-icon>filter_none</mat-icon>
                                    {{ i.duplicateCount }}
                                </div>
                            }
                            @let mediaTags = resolveMediaTags(i);
                            @if (mediaTags.length > 0) {
                                <div class="media-tags">
                                    @for (tag of mediaTags; track tag) {
                                        <span>{{ tag }}</span>
                                    }
                                </div>
                            }
                        </div>
                        @let rating = resolveRating(i);
                        @if (rating) {
                            <div
                                class="rating"
                                [matTooltip]="
                                    resolveRatingTooltip(i) ||
                                    ('XTREAM.IMDB_RATING' | translate)
                                "
                            >
                                <mat-icon>star</mat-icon>{{ rating }}
                            </div>
                        }
                        @let title = i.title ?? i.o_name ?? i.name;
                        <mat-card-actions>
                            <div class="title">
                                {{ title || 'No name' }}
                            </div>
                        </mat-card-actions>
                    </mat-card>
                } @empty {
                    <div class="grid-empty-state">
                        @if (hasActiveSearch()) {
                            <app-playlist-error-view
                                [title]="
                                    'PORTALS.SEARCH_VIEW.NO_RESULTS_FOR'
                                        | translate: { term: searchTerm() }
                                "
                                [description]="
                                    'PORTALS.EMPTY_LIST_VIEW.NO_SEARCH_RESULTS'
                                        | translate
                                "
                                [showActionButtons]="false"
                                [viewType]="'NO_SEARCH_RESULTS'"
                            />
                        } @else {
                            <app-playlist-error-view
                                [title]="
                                    'PORTALS.ERROR_VIEW.EMPTY_CATEGORY.TITLE'
                                        | translate
                                "
                                [description]="
                                    'PORTALS.ERROR_VIEW.EMPTY_CATEGORY.DESCRIPTION'
                                        | translate
                                "
                                [showActionButtons]="false"
                                [viewType]="'EMPTY_CATEGORY'"
                            />
                        }
                    </div>
                }
            }
        </div>
        @if (showPaginator() && items()?.length > 0) {
            <mat-paginator
                [pageIndex]="pageIndex()"
                [length]="totalPages() * limit()"
                [pageSize]="limit()"
                [pageSizeOptions]="pageSizeOptions()"
                (page)="pageChange.emit($event)"
                aria-label="Select page"
            />
        } `,
    styleUrl: './grid-list.component.scss',
    imports: [
        TranslatePipe,
        PlaylistErrorViewComponent,
        MatCardModule,
        MatIcon,
        MatTooltip,
        MatPaginatorModule,
        ProgressCapsuleComponent,
        WatchedBadgeComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridListComponent {
    readonly items = input<GridListItem[]>();
    readonly isLoading = input<boolean>();
    readonly showPaginator = input(true);
    readonly searchTerm = input<string>('');
    readonly itemClicked = output<GridListItem>();
    readonly pageChange = output<PageEvent>();

    readonly pageIndex = input<number>();
    readonly totalPages = input<number>();
    readonly limit = input<number>();
    readonly pageSizeOptions = input<number[]>();
    protected readonly resolveRating = resolveGridRating;
    protected readonly resolveRatingTooltip = resolveGridRatingTooltip;
    protected readonly resolveDuplicateTooltip = resolveGridDuplicateTooltip;
    protected readonly resolveMediaTags = resolveGridMediaTags;
    protected readonly hasActiveSearch = computed(
        () => (this.searchTerm() ?? '').trim().length > 0
    );

    readonly skeletonRows = computed(() => {
        const preferredCount = this.limit() ?? 12;
        const count = Math.max(8, Math.min(18, preferredCount));
        return Array.from({ length: count }, (_, index) => index);
    });
}
