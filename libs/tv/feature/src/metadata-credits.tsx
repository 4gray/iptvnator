import type { Media } from '@iptvnator/tv/util';
import { PersonAvatar } from './person-avatar';

export function MetadataCredits({
    item,
    open,
}: {
    item: Media;
    open: (person: { tmdbId: number; name: string }) => void;
}) {
    const metadata = item.metadata;
    if (!metadata) return null;
    const groups: [string, NonNullable<Media['metadata']>['cast']][] = [
        [metadata.authorRole, metadata.authors],
        ['Cast', metadata.cast],
    ];
    return (
        <section class="metadata-credits" aria-label="TMDB credits">
            {groups.map(([label, members]) => {
                return members.length ? (
                    <div>
                        <h2>{label}</h2>
                        <ul class="people-list">
                            {members.map((person) => (
                                <li>
                                    <button
                                        class="person-chip"
                                        data-focus={`person:${label}:${person.tmdbPersonId}`}
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
                                            {person.character ? (
                                                <small>
                                                    {person.character}
                                                </small>
                                            ) : null}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null;
            })}
        </section>
    );
}
