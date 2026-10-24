import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import type { M3uContentIndex, M3uContentKind } from '@iptvnator/shared/m3u-utils';

/** Source-local navigation. Existing global workspace navigation stays intact. */
@Component({
    selector: 'app-m3u-content-navigation',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <nav class="m3u-content-navigation" aria-label="M3U content sections">
            <div class="m3u-content-navigation__kinds">
                @for (kind of kinds; track kind.key) {
                    <button
                        type="button"
                        class="m3u-content-navigation__item"
                        [class.m3u-content-navigation__item--active]="currentKind() === kind.key"
                        (click)="navigate(sectionPath(kind.key))"
                        [attr.aria-current]="currentKind() === kind.key ? 'page' : null"
                    >
                        <span>{{ kind.label }}</span>
                        <span class="m3u-content-navigation__count">{{ index()[kind.key].length }}</span>
                    </button>
                }
            </div>
            <div class="m3u-content-navigation__modes">
                <button
                    type="button"
                    (click)="navigate(currentBase())"
                    [class.m3u-content-navigation__mode--active]="!isGroups() && !isFavorites()"
                >All</button>
                <button
                    type="button"
                    (click)="navigate(currentBase() === 'all' ? 'groups' : currentBase() + '-groups')"
                    [class.m3u-content-navigation__mode--active]="isGroups()"
                >Groups</button>
                <button
                    type="button"
                    (click)="navigate(currentBase() === 'all' ? 'favorites' : currentBase() + '-favorites')"
                    [class.m3u-content-navigation__mode--active]="isFavorites()"
                >Favorites</button>
                <button
                    type="button"
                    (click)="navigate('all')"
                    [class.m3u-content-navigation__legacy--active]="currentKind() === null"
                    class="m3u-content-navigation__legacy"
                >Browse All Content ({{ total() }})</button>
            </div>
        </nav>
    `,
    styles: [`
        .m3u-content-navigation {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 8px;
            flex: 0 0 auto;
            border-bottom: 1px solid var(--app-separator);
        }
        .m3u-content-navigation__kinds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
        .m3u-content-navigation__item {
            display: flex;
            min-width: 0;
            justify-content: space-between;
            align-items: center;
            gap: 4px;
            padding: 7px 8px;
            border-radius: 7px;
            color: inherit;
            text-decoration: none;
            background: color-mix(in srgb, currentColor 4%, transparent);
            font-size: 12px;
            font-weight: 600;
            border: 0;
            cursor: pointer;
            text-align: left;
            font-family: inherit;
        }
        .m3u-content-navigation__item:hover, .m3u-content-navigation__modes button:hover {
            background: color-mix(in srgb, currentColor 9%, transparent);
        }
        .m3u-content-navigation__item--active, .m3u-content-navigation__mode--active {
            color: var(--app-primary-color, #437bff) !important;
            background: color-mix(in srgb, #437bff 12%, transparent) !important;
        }
        .m3u-content-navigation__count { font-size: 11px; opacity: 0.8; font-variant-numeric: tabular-nums; }
        .m3u-content-navigation__modes { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
        .m3u-content-navigation__modes button {
            padding: 4px 6px;
            color: inherit;
            text-decoration: none;
            border-radius: 5px;
            font-size: 11px;
            border: 0;
            cursor: pointer;
            font-family: inherit;
            background: transparent;
        }
        .m3u-content-navigation__legacy { margin-left: auto; }
        .m3u-content-navigation__legacy--active { font-weight: 700; }
    `],
})
export class M3uContentNavigationComponent {
    private readonly router = inject(Router);
    readonly playlistId = input<string | null>(null);
    readonly activeView = input('live');
    readonly index = input.required<M3uContentIndex>();

    protected readonly kinds: ReadonlyArray<{ key: M3uContentKind; label: string }> = [
        { key: 'live', label: 'Live TV' },
        { key: 'movies', label: 'Movies' },
        { key: 'series', label: 'Series' },
        { key: 'unclassified', label: 'Unclassified' },
    ];

    readonly total = computed(() =>
        Object.values(this.index()).reduce((sum, entries) => sum + entries.length, 0)
    );
    readonly isGroups = computed(() => {
        const view = this.activeView();
        return view === 'groups' || view.endsWith('-groups');
    });
    readonly isFavorites = computed(() => this.activeView().endsWith('-favorites'));
    readonly currentKind = computed<M3uContentKind | null>(() => {
        const base = this.activeView().replace(/-(?:groups|favorites)$/, '');
        return this.kinds.find((kind) => kind.key === base)?.key ?? null;
    });
    readonly currentBase = computed(() => this.currentKind() ?? 'all');

    navigate(section: string): void {
        const id = this.playlistId();
        if (id) void this.router.navigate(['/workspace/playlists', id, section]);
    }

    sectionPath(kind: M3uContentKind): string {
        return kind + (this.isGroups() ? '-groups' : this.isFavorites() ? '-favorites' : '');
    }
}
