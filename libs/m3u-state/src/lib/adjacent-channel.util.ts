import { Channel } from '@iptvnator/shared/interfaces';

/**
 * The channel a "next" or "previous" step lands on.
 *
 * The neighbours a viewer steps through are the list they see. On a split
 * playlist that is the live list: stepping through the stored array would
 * walk from the last radio station straight into the films filed behind
 * it. A row that is not in the live list — a film playing from Favorites —
 * keeps its neighbours in the file.
 *
 * Returns undefined past either end, as the stored array always has.
 */
export function resolveAdjacentChannel(
    direction: 'next' | 'previous',
    active: Channel | undefined,
    allChannels: readonly Channel[],
    liveChannels: readonly Channel[]
): Channel | undefined {
    const isActive = (channel: Channel) => channel.id === active?.id;
    const channels = liveChannels.some(isActive) ? liveChannels : allChannels;
    const index = channels.findIndex(isActive);

    return channels[direction === 'next' ? index + 1 : index - 1];
}
