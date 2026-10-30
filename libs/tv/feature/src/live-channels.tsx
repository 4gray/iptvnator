import { ChannelLogo, Empty, VirtualCollection } from '@iptvnator/tv/ui';
import type { TvModel } from './use-tv';
import { categoryKey, useLiveBrowse } from './use-live-browse';
export function LiveChannels({
    tv,
    browse,
    overlay = false,
}: {
    tv: TvModel;
    overlay?: boolean;
    browse: ReturnType<typeof useLiveBrowse>;
}) {
    const pinned =
        overlay &&
        tv.playing &&
        tv.route.category === tv.playingCategory &&
        !tv.catalog.items.some((item) => item.id === tv.playing?.id)
            ? tv.playing
            : undefined;
    const items = pinned ? [pinned, ...tv.catalog.items] : tv.catalog.items;
    return (
        <section
            class="channel-pane"
            aria-label={
                browse.categoriesOpen ? 'Channel categories' : 'Channels'
            }
        >
            <div class="channel-pane-header">
                {browse.categoriesOpen ? (
                    <h2>Categories</h2>
                ) : (
                    <button
                        data-focus="live-categories"
                        onClick={browse.back}
                        aria-label="Back to categories"
                    >
                        <span aria-hidden="true">← </span>
                        {browse.categoryName}
                    </button>
                )}
                <span class="muted">
                    {browse.categoriesOpen
                        ? 'Choose a category'
                        : overlay
                          ? 'OK: switch channel · Back: close'
                          : 'OK: preview · OK again: fullscreen'}
                </span>
            </div>
            <div
                class="channels"
                key={browse.categoriesOpen ? 'categories' : tv.catalogKey}
            >
                {browse.categoriesOpen ? (
                    <VirtualCollection
                        layout="channels"
                        items={browse.categories}
                        restoreKey={categoryKey(tv.route.category)}
                        restoreScroll={browse.categoryScroll}
                        render={(category) => (
                            <button
                                class="live-category"
                                data-focus={category.id}
                                aria-pressed={
                                    category.categoryId === tv.route.category
                                }
                                onClick={() =>
                                    browse.choose(category.categoryId)
                                }
                            >
                                <strong>{category.name}</strong>
                                <span aria-hidden="true">→</span>
                            </button>
                        )}
                    />
                ) : (
                    <VirtualCollection
                        layout="channels"
                        items={items}
                        more={tv.hasMore}
                        busy={tv.catalogBusy}
                        error={tv.catalogError}
                        loadMore={tv.loadMore}
                        restoreKey={browse.channelKey}
                        restoreScroll={browse.channelScroll}
                        render={(item, n) => (
                            <button
                                class={`channel ${tv.playing?.id === item.id && tv.player.current?.hasConfirmedPlayback ? 'is-playing' : ''}`}
                                data-focus={item.id}
                                aria-pressed={tv.selected?.id === item.id}
                                onFocus={() => tv.setSelected(item)}
                                onClick={() => {
                                    tv.setSelected(item);
                                    void tv.play(item);
                                }}
                            >
                                <span class="channel-number">
                                    {item === pinned
                                        ? '●'
                                        : String(
                                              n + 1 - (pinned ? 1 : 0)
                                          ).padStart(2, '0')}
                                </span>
                                <ChannelLogo src={item.poster} />
                                <span>
                                    <strong>{item.title}</strong>
                                    <small>
                                        {tv.playing?.id === item.id
                                            ? tv.player.current
                                                  ?.hasConfirmedPlayback
                                                ? '● Playing'
                                                : 'Starting / paused'
                                            : 'Live channel'}
                                    </small>
                                </span>
                            </button>
                        )}
                    />
                )}
                {!browse.categoriesOpen &&
                !tv.busy &&
                !tv.catalogError &&
                !items.length ? (
                    <Empty>No channels in this category.</Empty>
                ) : null}
                {browse.categoriesOpen && tv.catalogError ? (
                    <div role="alert" class="load-more-status">
                        {tv.catalogError}{' '}
                        <button onClick={tv.loadMore}>Retry loading</button>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
