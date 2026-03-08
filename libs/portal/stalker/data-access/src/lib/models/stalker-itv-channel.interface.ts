import { StalkerVodSource } from './stalker-favorite-item.interface';

/**
 * ITV/live channel shape used by Stalker live TV flow.
 * Stalker channel payloads are heterogeneous, so this extends the shared source shape.
 */
export interface StalkerItvChannel extends StalkerVodSource {
    id: string | number;
    cmd: string;
    name?: string;
    o_name?: string;
    logo?: string;
}
