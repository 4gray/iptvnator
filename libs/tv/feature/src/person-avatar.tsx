export function PersonAvatar({
    name,
    photo,
}: {
    name: string;
    photo?: string | null;
}) {
    return (
        <span class="person-avatar" aria-hidden="true">
            <span>
                {name
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join('')}
            </span>
            {photo ? (
                <img
                    key={photo}
                    src={photo}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                        event.currentTarget.style.display = 'none';
                    }}
                />
            ) : null}
        </span>
    );
}
