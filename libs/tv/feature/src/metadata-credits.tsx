import { HorizontalRail } from '@iptvnator/tv/ui';
import { detailPeople, type Media } from '@iptvnator/tv/util';
import { PersonAvatar } from './person-avatar';

export function MetadataCredits({
    item,
    open,
}: {
    item: Media;
    open: (person: { tmdbId: number; name: string }) => void;
}) {
    const metadata = item.metadata;
    const people = detailPeople(item);
    if (!metadata || !people.length) return null;
    return (
        <section class="metadata-credits" aria-label="TMDB credits">
            <h2>{metadata.authorRole} &amp; cast</h2>
            <HorizontalRail label={`${metadata.authorRole} & cast`}>
                <ul class="people-list" data-tv-horizontal>
                    {people.map((person) => (
                        <li key={person.tmdbPersonId ?? person.name}>
                            <button
                                class="person-chip"
                                data-focus={`person:${person.tmdbPersonId ?? person.name}`}
                                disabled={!person.tmdbPersonId}
                                aria-label={`View filmography: ${person.name}`}
                                onClick={() => {
                                    if (person.tmdbPersonId)
                                        open({
                                            tmdbId: person.tmdbPersonId,
                                            name: person.name,
                                        });
                                }}
                            >
                                <PersonAvatar
                                    name={person.name}
                                    photo={person.profileUrl}
                                />
                                <span>
                                    <strong>{person.name}</strong>
                                    <small>{person.role}</small>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </HorizontalRail>
        </section>
    );
}
