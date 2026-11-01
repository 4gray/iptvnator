import {
    EMPTY,
    Observable,
    catchError,
    defer,
    from,
    of,
    switchMap,
} from 'rxjs';
import type { EpgLookupContext } from './epg-lookup-context';
import type { EpgLookups } from './epg-lookups';

/** Shares a lazy read module while retaining each request's source ownership. */
export class EpgLookupLoader {
    private lookups?: Promise<EpgLookups>;

    constructor(
        private readonly context: EpgLookupContext,
        private readonly enabled: () => boolean,
        private readonly revision: () => number,
        private readonly importLookups = () => import('./epg-lookups')
    ) {}

    run<T>(
        query: (lookups: EpgLookups) => Observable<T>,
        empty: T
    ): Observable<T> {
        const revision = this.revision();
        const current = () => this.enabled() && revision === this.revision();
        return defer(() => {
            if (!current()) return EMPTY;
            return from(this.load()).pipe(
                switchMap((lookups) => (current() ? query(lookups) : EMPTY))
            );
        }).pipe(
            catchError(() => of(empty)),
            this.context.guard()
        );
    }

    private load(): Promise<EpgLookups> {
        return (this.lookups ??= this.importLookups()
            .then(({ createEpgLookups }) => createEpgLookups(this.context))
            .catch((error) => {
                this.lookups = undefined;
                throw error;
            }));
    }
}
