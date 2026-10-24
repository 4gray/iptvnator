import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { M3uContentIndex, M3uContentKind } from '@iptvnator/shared/m3u-utils';

/** Source-local navigation. Existing global workspace navigation stays intact. */
@Component({
    selector: 'app-m3u-content-navigation',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink],
    template: `
        <nav class="m3u-content-navigation" aria-label="M3U content sections">
            <div class="m3u-content-navigation__kinds">
                @for (kind of kinds; track kind.key) {
                    <a
                        class="m3u-content-navigation__item"
                        [class.m3u-content-navigation__item--active]="currentKind() === kind.key"
                        [routerLink]="['/workspace/playlists', playlistId(), sectionPath(kind.key)]"
                        [attr.aria-current]="currentKind() === kind.key ? 'page' : null"
                    >
                        <span>{{ kind.label }}</span>
                        <span class="m3u-content-navigation__count">{{ index()[kind.key].length }}</span>
                    </a>
                }
            </div>
            <div class="m3u-content-navigation__modes">
                <a
                    [routerLink]="['/workspace/playlists', playlistId(), currentBase()]"
                    [class.m3u-content-navigation__mode--active]="!isGroups()"
                >All</a>
                <a
                    [routerLink]="['/workspace/playlists', playlistId(), currentBase() === 'all' ? 'groups' : currentBase() + '-groups']"
                    [class.m3u-content-navigation__mode--active]="isGroups()"
                >Groups</a>
                <a
                    [routerLink]="['/workspace/playlists', playlistId(), 'all']"
                    [class.m3u-content-navigation__legacy--active]="currentKind() === null"
                    class="m3u-content-navigation__legacy"
                >Browse All Content ({{ total() }})</a>
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
        }
        .m3u-content-navigation__item:hover, .m3u-content-navigation__modes a:hover {
            background: color-mix(in srgb, currentColor 9%, transparent);
        }
        .m3u-content-navigation__item--active, .m3u-content-navigation__mode--active {
            color: var(--app-primary-color, #437bff) !important;
            background: color-mix(in srgb, #437bff 12%, transparent) !important;
        }
        .m3u-content-navigation__count { font-size: 11px; opacity: 0.8; font-variant-numeric: tabular-nums; }
        .m3u-content-navigation__modes { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
        .m3u-content-navigation__modes a {
            padding: 4px 6px;
            color: inherit;
            text-decoration: none;
            border-radius: 5px;
            font-size: 11px;
        }
        .m3u-content-navigation__legacy { margin-left: auto; }
        .m3u-content-navigation__legacy--active { font-weight: 700; }
    `],
})
export class M3uContentNavigationComponent {
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
    readonly currentKind = computed<M3uContentKind | null>(() => {
        const base = this.activeView().replace(/-groups$/, '');
        return this.kinds.find((kind) => kind.key === base)?.key ?? null;
    });
    readonly currentBase = computed(() => this.currentKind() ?? 'all');

    sectionPath(kind: M3uContentKind): string {
        return kind + (this.isGroups() ? '-groups' : '');
    }
}
