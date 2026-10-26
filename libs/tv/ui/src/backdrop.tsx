import { Media } from '@iptvnator/tv/util';

/** Paint-only stage: no clipping/filter layer on the page scroller. */
export function Backdrop({ item }: { item?: Media }) {
    const src = item?.backdrop || item?.poster;
    return (
        <div class="page-backdrop" aria-hidden="true">
            {src ? (
                <img
                    key={src}
                    src={src}
                    alt=""
                    onError={(event) => {
                        event.currentTarget.style.display = 'none';
                    }}
                />
            ) : null}
            <div class="backdrop-scrim" />
        </div>
    );
}
