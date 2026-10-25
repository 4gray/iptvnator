import { ChannelCard } from './channel-card';
import { Media } from '@iptvnator/tv/util';
export * from './focus';
export function Poster({
    item,
    open,
    saved,
    ...attributes
}: {
    item: Media;
    open: (m: Media) => void;
    saved?: boolean;
    'data-virtual-index'?: number;
}) {
    if (item.kind === 'live')
        return <ChannelCard item={item} open={open} {...attributes} />;
    return (
        <button
            {...attributes}
            class="poster-card"
            data-focus={item.id}
            onClick={() => open(item)}
        >
            <span class="poster-art">
                {item.poster ? (
                    <img
                        src={item.poster}
                        loading="lazy"
                        alt=""
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                        }}
                    />
                ) : null}
                <span class="poster-fallback">{item.title}</span>
                <small>
                    {item.kind === 'series'
                        ? 'SERIES'
                        : item.kind === 'episode'
                          ? 'EPISODE'
                          : 'FILM'}
                </small>
            </span>
            <strong>{item.title}</strong>
            <span class="muted">
                {saved ? '♥ Saved' : item.year || 'From your source'}
            </span>
        </button>
    );
}
export function Empty({ children }: { children: preact.ComponentChildren }) {
    return <div class="empty">{children}</div>;
}
