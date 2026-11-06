import { detailChips, type Media } from '@iptvnator/tv/util';

export function MetadataChips({ item }: { item: Media }) {
    const chips = detailChips(item);
    if (!chips.length) return null;
    return (
        <ul class="metadata-chips" aria-label="Title information">
            {chips.map(({ label, value }) => (
                <li key={`${label}:${value}`} aria-label={`${label}: ${value}`}>
                    {value}
                </li>
            ))}
        </ul>
    );
}
