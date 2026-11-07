import type { Media, Source } from './index';
import { availableChannel } from './recent-channels';

/** Connection identity stays in memory and must never be logged or persisted. */
const connection = (source: Source) =>
    JSON.stringify([
        source.id,
        source.provider,
        source.url,
        source.username,
        source.password,
        source.macAddress,
        source.serialNumber,
        source.deviceId1,
        source.deviceId2,
        source.signature1,
        source.signature2,
        source.userAgent,
        source.referrer,
        source.origin,
        source.m3uItems,
    ]);
interface ConfirmedChannel {
    item: Media;
    connection: string;
}

/** A session pair advances only after native playback confirmation, never intent. */
export class ConfirmedLiveChannels {
    private current?: ConfirmedChannel;
    private prior?: ConfirmedChannel;
    private valid(channel: ConfirmedChannel | undefined, sources: Source[]) {
        const source = channel && availableChannel(channel.item, sources);
        return source && connection(source) === channel?.connection
            ? channel
            : undefined;
    }
    confirm(item: Media, sources: Source[]) {
        const source = availableChannel(item, sources);
        if (!source) return;
        const next = { item, connection: connection(source) };
        this.prior = this.valid(this.prior, sources);
        this.current = this.valid(this.current, sources);
        if (this.current?.item.id === item.id) {
            this.current = next;
            return;
        }
        const previous = this.current ?? this.prior;
        this.prior = previous?.item.id === item.id ? undefined : previous;
        this.current = next;
    }
    previous(sources: Source[]): Media | undefined {
        return this.valid(this.prior, sources)?.item;
    }
}
