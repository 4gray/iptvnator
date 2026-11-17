import type { EpgItem, EpgProgram } from '@iptvnator/shared/interfaces';

export function mapEpgProgramToEpgItem(
    program: EpgProgram,
    channelId: string
): EpgItem {
    return {
        id: `${channelId}|${program.start}`,
        epg_id: '',
        title: program.title ?? '',
        lang: '',
        start: program.start,
        end: program.stop,
        stop: program.stop,
        description: program.desc ?? '',
        channel_id: channelId,
        start_timestamp: epgTimestamp(program.startTimestamp, program.start),
        stop_timestamp: epgTimestamp(program.stopTimestamp, program.stop),
    };
}

function epgTimestamp(
    timestamp: number | null | undefined,
    date: string
): string {
    const ms = timestamp ? timestamp * 1000 : Date.parse(date);
    return Number.isFinite(ms) ? String(Math.floor(ms / 1000)) : '0';
}
