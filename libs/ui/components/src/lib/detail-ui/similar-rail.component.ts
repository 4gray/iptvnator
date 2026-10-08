import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
    signal,
} from '@angular/core';
import { DetailRailComponent } from './detail-rail.component';

/** One poster of the "Similar" row. */
export interface SimilarRailItem {
    readonly key: string;
    readonly title: string;
    readonly posterUrl: string | null;
    readonly year: number | null;
    /** Tooltip detail such as the playlist a cross-portal match lives in. */
    readonly tooltip?: string | null;
}

/**
 * "Similar" row: 140px posters with the title and year. Hosts map their
 * TMDB and cross-portal matches to `SimilarRailItem` and react to clicks.
 */
@Component({
    selector: 'app-similar-rail',
    imports: [DetailRailComponent],
    templateUrl: './similar-rail.component.html',
    styleUrl: './similar-rail.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SimilarRailComponent {
    readonly title = input.required<string>();
    readonly items = input.required<readonly SimilarRailItem[]>();

    readonly selected = output<SimilarRailItem>();

    readonly failedPosters = signal<Record<string, true>>({});

    posterFor(item: SimilarRailItem): string | null {
        const url = item.posterUrl;
        return url && !this.failedPosters()[url] ? url : null;
    }

    markFailed(url: string): void {
        this.failedPosters.update((failed) => ({ ...failed, [url]: true }));
    }
}
