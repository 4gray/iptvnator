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
    return (
        <button
            {...attributes}
            class={`poster-card ${item.kind === 'live' ? 'is-live' : ''}`}
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
                        : item.kind === 'live'
                          ? 'LIVE'
                          : 'FILM'}
                </small>
            </span>
            <strong>{item.title}</strong>
            <span class="muted">
                {saved
                    ? '♥ Saved'
                    : item.year ||
                      (item.kind === 'live'
                          ? 'Live television'
                          : 'From your source')}
            </span>
        </button>
    );
}
export function Hero({
    item,
    open,
    compact = false,
}: {
    item?: Media;
    open: (m: Media) => void;
    compact?: boolean;
}) {
    return (
        <section class={`hero ${compact ? 'compact' : ''}`}>
            <div class="hero-copy">
                <span class="eyebrow">YOUR OWN CINEMA</span>
                <h1>{item?.title ?? 'Make yourself at home.'}</h1>
                <p>
                    {item?.description ||
                        'Live television, films and stories from your own sources. Pick something worth staying in for.'}
                </p>
                {item ? (
                    <button
                        class="primary"
                        data-focus="hero"
                        onClick={() => open(item)}
                    >
                        Explore title →
                    </button>
                ) : null}
            </div>
            <span class="hero-number">
                IPTV<span>NATOR</span>
                <small>TV EDITION</small>
            </span>
        </section>
    );
}
export function Empty({ children }: { children: preact.ComponentChildren }) {
    return <div class="empty">{children}</div>;
}
