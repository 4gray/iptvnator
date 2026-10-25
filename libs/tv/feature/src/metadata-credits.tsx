import type { Media } from '@iptvnator/tv/util';

export function MetadataCredits({ item }: { item: Media }) {
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
                                    {person.profileUrl ? (
                                        <img
                                            src={person.profileUrl}
                                            alt=""
                                            loading="lazy"
                                            onError={(e) => {
                                                e.currentTarget.style.display =
                                                    'none';
                                            }}
                                        />
                                    ) : null}
                                    <span>
                                        <strong>{person.name}</strong>
                                        {person.character ? (
                                            <small>{person.character}</small>
                                        ) : null}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null;
            })}
        </section>
    );
}
