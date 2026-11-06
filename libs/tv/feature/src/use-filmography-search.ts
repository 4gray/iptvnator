import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ActorFilmographyCredit } from '@iptvnator/shared/tmdb';
import {
    findFilmographyTitle,
    FilmographyMatch,
} from '@iptvnator/tv/data-access';
import { restoreFocus } from '@iptvnator/tv/ui';
import type { TvModel } from './use-tv';
import type { NavigationOrigin } from './use-route-history';

export const filmographyKey = (credit: ActorFilmographyCredit) =>
    `filmography:${credit.mediaType}:${credit.tmdbId}`;
interface SearchState {
    credit: ActorFilmographyCredit;
    origin: NavigationOrigin;
    busy: boolean;
    result?: FilmographyMatch;
    error?: boolean;
}
/** Only settled choices survive detail navigation; a new person visit retires them. */
export type FilmographyMemory = WeakMap<
    NonNullable<TvModel['route']['person']>,
    SearchState
>;
export function useFilmographySearch(tv: TvModel, memory: FilmographyMemory) {
    const request = useRef<AbortController>();
    const person = tv.route.person;
    const initial = useRef(person ? memory.get(person) : undefined);
    const [state, setState] = useState<SearchState | undefined>(
        initial.current
    );
    const provider = tv.guideClient;
    useLayoutEffect(() => {
        if (person) {
            if (state?.result?.status === 'choices') memory.set(person, state);
            else memory.delete(person);
        }
        if (state !== initial.current && state?.result?.status === 'choices') {
            const first = state.result.items[0];
            if (first) restoreFocus(first.id);
        }
    }, [state, person, memory]);
    useLayoutEffect(() => {
        setState((current) =>
            current?.busy ? { ...current, busy: false, error: true } : current
        );
        return () => {
            request.current?.abort();
            request.current = undefined;
        };
    }, [provider, tv.data.activeId, tv.route.person?.tmdbId]);
    async function search(
        credit: ActorFilmographyCredit,
        origin: NavigationOrigin = {
            focus: filmographyKey(credit),
            scroll: document.querySelector('main')?.scrollTop ?? 0,
        }
    ) {
        request.current?.abort();
        const abort = new AbortController();
        request.current = abort;
        setState({ credit, origin, busy: true });
        const deadline = setTimeout(() => {
            if (request.current === abort) {
                setState({ credit, origin, busy: false, error: true });
                request.current = undefined;
                abort.abort();
            }
        }, 15000);
        try {
            if (!provider) throw new Error('Provider unavailable.');
            const result = await findFilmographyTitle(
                provider,
                tv.data.activeId,
                credit,
                abort.signal
            );
            if (request.current !== abort || abort.signal.aborted) return;
            if (result.status === 'found') tv.open(result.item, origin);
            else setState({ credit, origin, busy: false, result });
        } catch {
            if (request.current === abort)
                setState({ credit, origin, busy: false, error: true });
        } finally {
            clearTimeout(deadline);
        }
    }
    return {
        state,
        search,
        cancel: () => {
            request.current?.abort();
            request.current = undefined;
            setState(undefined);
            if (state) restoreFocus(filmographyKey(state.credit));
        },
    };
}
