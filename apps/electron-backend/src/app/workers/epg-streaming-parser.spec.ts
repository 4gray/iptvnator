import {
    parseXmltvDate,
    StreamingEpgParser,
    type ParsedChannel,
    type ParsedProgram,
} from './epg-streaming-parser';

describe('parseXmltvDate', () => {
    it('normalizes XMLTV timestamps with timezone offsets', () => {
        expect(parseXmltvDate('20260415053700 +0000')).toBe(
            '2026-04-15T05:37:00+00:00'
        );
    });
});

describe('StreamingEpgParser', () => {
    it('flushes pending channels before the first programme batch', () => {
        const callbackOrder: string[] = [];
        const channelIdsByBatch: string[][] = [];
        const programmeChannelsByBatch: string[][] = [];

        const parser = new StreamingEpgParser(
            (channels: ParsedChannel[]) => {
                callbackOrder.push('channels');
                channelIdsByBatch.push(channels.map((channel) => channel.id));
            },
            (programs: ParsedProgram[]) => {
                callbackOrder.push('programs');
                programmeChannelsByBatch.push(
                    programs.map((program) => program.channel)
                );
            },
            () => undefined
        );

        const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<tv>',
            ...Array.from({ length: 101 }, (_, index) => {
                const id = `channel-${index + 1}`;
                return `<channel id="${id}"><display-name>${id}</display-name></channel>`;
            }),
            '<programme start="20260415053700 +0000" stop="20260415062100 +0000" channel="channel-101"><title>Late channel</title></programme>',
            '</tv>',
        ].join('');

        parser.write(xml);
        parser.finish();

        expect(callbackOrder).toEqual(['channels', 'channels', 'programs']);
        expect(channelIdsByBatch).toEqual([
            Array.from({ length: 100 }, (_, index) => `channel-${index + 1}`),
            ['channel-101'],
        ]);
        expect(programmeChannelsByBatch).toEqual([['channel-101']]);
    });
});
