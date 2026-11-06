import { ChannelCard, HorizontalRail } from '@iptvnator/tv/ui';
import { recentChannels, type Media, type UserData } from '@iptvnator/tv/util';

export function RecentChannels({
    data,
    play,
}: {
    data: UserData;
    play: (item: Media) => void;
}) {
    const channels = recentChannels(data);
    if (!channels.length) return null;
    return (
        <section aria-label="Recent channels">
            <h2>Recent channels</h2>
            <HorizontalRail label="Recent channels">
                <div class="rail" data-tv-horizontal>
                    {channels.map((item) => (
                        <ChannelCard
                            key={item.id}
                            item={item}
                            open={play}
                            focusKey={JSON.stringify([
                                'home',
                                'recent-channels',
                                item.id,
                            ])}
                            sourceName={
                                data.sources.find(
                                    (source) => source.id === item.sourceId
                                )?.name
                            }
                        />
                    ))}
                </div>
            </HorizontalRail>
        </section>
    );
}
