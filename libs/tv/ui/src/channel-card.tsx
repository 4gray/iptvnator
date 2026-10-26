import { Media } from '@iptvnator/tv/util';
import { TvIcon } from './icon';
/** A local vector remains visible when a channel has no logo or its URL fails. */
export function ChannelLogo({ src }: { src?: string }) {
    return (
        <span class="channel-logo" aria-hidden="true">
            <TvIcon name="live" />
            {src ? (
                <img
                    key={src}
                    src={src}
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
export function ChannelCard({
    item,
    open,
    ...attributes
}: {
    item: Media;
    open: (item: Media) => void;
    'data-virtual-index'?: number;
}) {
    return (
        <button
            {...attributes}
            class="channel-card"
            data-focus={item.id}
            onClick={() => open(item)}
        >
            <ChannelLogo src={item.poster} />
            <span class="channel-card-copy">
                <strong>{item.title}</strong>
                <small>Live TV</small>
            </span>
        </button>
    );
}
