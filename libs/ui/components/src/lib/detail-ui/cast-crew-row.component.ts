import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    output,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { TmdbEnrichedCastMember } from '@iptvnator/shared/interfaces';
import { buildCastCrewEntries, type CastCrewEntry } from './cast-crew.util';
import { DetailRailComponent } from './detail-rail.component';

/** Scrolls the page to the Cast & crew row ("and more" in the credits). */
export function scrollToCastCrewRow(): void {
    document
        .getElementById('detail-cast-crew')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * "Cast & crew" row under the hero: 72px round avatars with the full name
 * and the character (or "Director"), the director first, initials when a
 * person has no photo. A click on a person with a TMDB id opens the actor
 * page through the host; a host without one renders plain entries.
 */
@Component({
    selector: 'app-cast-crew-row',
    imports: [DetailRailComponent, TranslatePipe],
    templateUrl: './cast-crew-row.component.html',
    styleUrl: './cast-crew-row.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CastCrewRowComponent {
    readonly cast = input<readonly TmdbEnrichedCastMember[]>([]);
    readonly directors = input<readonly TmdbEnrichedCastMember[]>([]);
    readonly headingId = input<string | null>('detail-cast-crew');
    /** False when the host has no actor page: nobody becomes a button that does nothing. */
    readonly interactive = input(true);

    readonly personSelected = output<TmdbEnrichedCastMember>();

    private readonly translate = inject(TranslateService);

    readonly entries = computed<CastCrewEntry[]>(() =>
        buildCastCrewEntries(
            this.cast(),
            this.directors(),
            this.translate.instant('XTREAM.DIRECTOR')
        )
    );

    isClickable(entry: CastCrewEntry): boolean {
        return this.interactive() && !!entry.member.tmdbPersonId;
    }

    select(entry: CastCrewEntry): void {
        if (this.isClickable(entry)) {
            this.personSelected.emit(entry.member);
        }
    }
}
