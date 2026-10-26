import { useEffect, useMemo } from 'preact/hooks';
import { mapPersonFilmography, mapPersonProfile } from '@iptvnator/shared/tmdb';
import { TvMetadata } from '@iptvnator/tv/data-access';
import { Empty, Poster, VirtualCollection } from '@iptvnator/tv/ui';
import type { TvModel } from './use-tv';
import { PersonAvatar } from './person-avatar';
import { usePerson } from './use-person';
import {
    filmographyKey,
    useFilmographySearch,
    type FilmographyMemory,
} from './use-filmography-search';

export function PersonPage({
    tv,
    client,
    memory,
}: {
    tv: TvModel;
    client: TvMetadata;
    memory: FilmographyMemory;
}) {
    const selected = tv.route.person;
    const resource = usePerson(selected?.tmdbId, client);
    const lookup = useFilmographySearch(tv, memory);
    const person = resource.person;
    const profile = person ? mapPersonProfile(person) : undefined;
    const credits = useMemo(
        () =>
            person
                ? mapPersonFilmography(person, Infinity).map((credit) => ({
                      ...credit,
                      id: filmographyKey(credit),
                  }))
                : [],
        [person]
    );
    useEffect(() => {
        if (!resource.loading) tv.finishFocus();
    }, [resource.loading, person]);
    if (!selected || selected.sourceId !== tv.data.activeId) return null;
    if (!tv.data.tmdb.enabled)
        return (
            <Empty>
                Enable TMDB metadata in Settings to view filmographies.
            </Empty>
        );
    return (
        <section class="person-page" aria-label="Person filmography">
            <div class="person-profile">
                <PersonAvatar
                    name={profile?.name || selected.name}
                    photo={profile?.photoUrl}
                />
                <div>
                    <span class="eyebrow">FILMS & SERIES</span>
                    <h1>{profile?.name || selected.name}</h1>
                    {profile?.biography ? (
                        <p
                            data-tv-scroll
                            data-focus="person-biography"
                            tabIndex={0}
                            aria-label="Biography"
                            onKeyDown={(event) => {
                                const direction =
                                    event.key === 'ArrowDown' ||
                                    event.keyCode === 40
                                        ? 1
                                        : event.key === 'ArrowUp' ||
                                            event.keyCode === 38
                                          ? -1
                                          : 0;
                                const pane = event.currentTarget;
                                const previous = pane.scrollTop;
                                pane.scrollTop += direction * 120;
                                if (pane.scrollTop !== previous) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                }
                            }}
                        >
                            {profile.biography}
                        </p>
                    ) : null}
                </div>
            </div>
            {resource.loading ? (
                <p role="status">Loading filmography…</p>
            ) : !person ? (
                <div role="alert">
                    Filmography is unavailable.{' '}
                    <button onClick={resource.retry}>Retry filmography</button>
                </div>
            ) : (
                <>
                    <div class="section-title">
                        <h2>
                            Filmography{' '}
                            <span class="muted">{credits.length}</span>
                        </h2>
                        <span class="muted">
                            Choose a title to find it in this portal
                        </span>
                    </div>
                    {lookup.state ? (
                        <div
                            class="filmography-status"
                            role="status"
                            aria-live="polite"
                        >
                            {lookup.state.busy ? (
                                <>
                                    Searching this portal for “
                                    {lookup.state.credit.title}”…{' '}
                                    <button onClick={lookup.cancel}>
                                        Cancel search
                                    </button>
                                </>
                            ) : lookup.state.error ? (
                                <>
                                    Could not finish the portal search. Check
                                    the connection and retry.{' '}
                                    <button
                                        onClick={() =>
                                            lookup.state &&
                                            void lookup.search(
                                                lookup.state.credit,
                                                lookup.state.origin
                                            )
                                        }
                                    >
                                        Retry portal search
                                    </button>
                                </>
                            ) : lookup.state.result?.status === 'missing' ? (
                                <>
                                    “{lookup.state.credit.title}” is not
                                    available in this portal.
                                </>
                            ) : lookup.state.result?.status === 'choices' ? (
                                'Choose a version available in this portal:'
                            ) : null}
                        </div>
                    ) : null}
                    {lookup.state?.result?.status === 'choices' ? (
                        <div class="rail" aria-label="Available versions">
                            {lookup.state.result.items.map((item) => (
                                <Poster
                                    key={item.id}
                                    item={item}
                                    open={tv.open}
                                />
                            ))}
                        </div>
                    ) : null}
                    <VirtualCollection
                        items={credits}
                        restoreKey={tv.restoreKey}
                        restoreScroll={tv.restoreScroll}
                        render={(credit) => (
                            <button
                                class="poster-card filmography-card"
                                data-focus={credit.id}
                                onClick={() => void lookup.search(credit)}
                            >
                                <span class="poster-art">
                                    {credit.posterUrl ? (
                                        <img
                                            key={credit.posterUrl}
                                            src={credit.posterUrl}
                                            alt=""
                                            loading="lazy"
                                            onError={(event) => {
                                                event.currentTarget.style.display =
                                                    'none';
                                            }}
                                        />
                                    ) : null}
                                    <span class="poster-fallback">
                                        {credit.title}
                                    </span>
                                    <small>
                                        {credit.mediaType === 'movie'
                                            ? 'FILM'
                                            : 'SERIES'}
                                    </small>
                                </span>
                                <strong>{credit.title}</strong>
                                <span class="muted">
                                    {credit.year || 'Year unavailable'}
                                    {credit.crewJob
                                        ? ` · ${credit.crewJob}`
                                        : credit.character
                                          ? ` · ${credit.character}`
                                          : ''}
                                </span>
                            </button>
                        )}
                    />
                    {!credits.length ? (
                        <Empty>
                            No filmography is available for this person.
                        </Empty>
                    ) : null}
                </>
            )}
        </section>
    );
}
