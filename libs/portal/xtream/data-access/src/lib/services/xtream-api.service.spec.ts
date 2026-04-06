import { TestBed } from '@angular/core/testing';
import { DataService } from 'services';
import { XTREAM_REQUEST } from 'shared-interfaces';
import { XtreamApiService, XtreamCredentials } from './xtream-api.service';

describe('XtreamApiService', () => {
    let service: XtreamApiService;
    let dataService: {
        sendIpcEvent: jest.Mock<Promise<unknown>, [string, unknown]>;
    };

    const credentials: XtreamCredentials = {
        serverUrl: 'http://demo.example',
        username: 'demo',
        password: 'secret',
    };

    beforeEach(() => {
        dataService = {
            sendIpcEvent: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                XtreamApiService,
                { provide: DataService, useValue: dataService },
            ],
        });

        service = TestBed.inject(XtreamApiService);
    });

    it('falls back to the legacy full-epg action and normalizes the response', async () => {
        dataService.sendIpcEvent.mockImplementation(
            async (_type: string, payload: unknown) => {
                const action = (
                    payload as {
                        params: { action: string };
                    }
                ).params.action;

                if (action === 'get_simple_data_table') {
                    return { payload: { epg_listings: [] } };
                }

                return {
                    payload: {
                        epg_listings: [
                            {
                                id: 'later',
                                epg_id: 'channel-101.mock',
                                title: Buffer.from('Later Show').toString(
                                    'base64'
                                ),
                                description: Buffer.from(
                                    'Later description'
                                ).toString('base64'),
                                start: '2026-04-04 11:00:00',
                                end: '2026-04-04 11:30:00',
                                start_timestamp: '1775300400',
                                stop_timestamp: '1775302200',
                                channel_id: 'channel-101.mock',
                            },
                            {
                                id: 'current',
                                epg_id: 'channel-101.mock',
                                title: Buffer.from('Current Show').toString(
                                    'base64'
                                ),
                                description: Buffer.from(
                                    'Current description'
                                ).toString('base64'),
                                start: '2026-04-04 10:30:00',
                                end: '2026-04-04 11:00:00',
                                start_timestamp: '1775298600',
                                stop_timestamp: '1775300400',
                                channel_id: 'channel-101.mock',
                            },
                        ],
                    },
                };
            }
        );

        const items = await service.getFullEpg(credentials, 101);

        expect(dataService.sendIpcEvent).toHaveBeenNthCalledWith(
            1,
            XTREAM_REQUEST,
            expect.objectContaining({
                url: 'http://demo.example',
                params: expect.objectContaining({
                    action: 'get_simple_data_table',
                    stream_id: '101',
                    username: 'demo',
                    password: 'secret',
                }),
            })
        );
        expect(dataService.sendIpcEvent).toHaveBeenNthCalledWith(
            2,
            XTREAM_REQUEST,
            expect.objectContaining({
                params: expect.objectContaining({
                    action: 'get_simple_date_table',
                }),
            })
        );
        expect(items).toHaveLength(2);
        expect(items.map((item) => item.title)).toEqual([
            'Current Show',
            'Later Show',
        ]);
        expect(items[0]).toEqual(
            expect.objectContaining({
                description: 'Current description',
                start: '2026-04-04T10:30:00.000Z',
                stop: '2026-04-04T11:00:00.000Z',
                start_timestamp: '1775298600',
                stop_timestamp: '1775300400',
            })
        );
    });

    it('normalizes short epg items from unix timestamps for display', async () => {
        const startTimestamp = Math.floor(
            Date.parse('2026-04-05T05:30:00.000Z') / 1000
        );
        const stopTimestamp = Math.floor(
            Date.parse('2026-04-05T06:00:00.000Z') / 1000
        );

        dataService.sendIpcEvent.mockResolvedValue({
            payload: {
                epg_listings: [
                    {
                        id: 'current',
                        epg_id: 'channel-101.mock',
                        title: Buffer.from('Current Show').toString('base64'),
                        description: Buffer.from(
                            'Current description'
                        ).toString('base64'),
                        start: '2026-04-05 03:00:00',
                        end: '2026-04-05 03:30:00',
                        start_timestamp: String(startTimestamp),
                        stop_timestamp: String(stopTimestamp),
                        channel_id: 'channel-101.mock',
                    },
                ],
            },
        });

        const items = await service.getShortEpg(credentials, 101, 4);

        expect(items).toEqual([
            expect.objectContaining({
                title: 'Current Show',
                description: 'Current description',
                start: '2026-04-05T05:30:00.000Z',
                stop: '2026-04-05T06:00:00.000Z',
                start_timestamp: String(startTimestamp),
                stop_timestamp: String(stopTimestamp),
            }),
        ]);
    });

    it('falls back to parsed short epg date strings when unix timestamps are absent', async () => {
        const rawStart = '2026-04-05 03:00:00';
        const rawStop = '2026-04-05 03:30:00';

        dataService.sendIpcEvent.mockResolvedValue({
            payload: {
                epg_listings: [
                    {
                        id: 'current',
                        epg_id: 'channel-101.mock',
                        title: Buffer.from('Current Show').toString('base64'),
                        description: Buffer.from(
                            'Current description'
                        ).toString('base64'),
                        start: rawStart,
                        end: rawStop,
                        channel_id: 'channel-101.mock',
                    },
                ],
            },
        });

        const items = await service.getShortEpg(credentials, 101, 4);

        expect(items).toEqual([
            expect.objectContaining({
                start: new Date(rawStart.replace(' ', 'T')).toISOString(),
                stop: new Date(rawStop.replace(' ', 'T')).toISOString(),
                start_timestamp: '',
                stop_timestamp: '',
            }),
        ]);
    });

    it('normalizes short and full epg items consistently for the same timestamps', async () => {
        const startTimestamp = Math.floor(
            Date.parse('2026-04-05T05:30:00.000Z') / 1000
        );
        const stopTimestamp = Math.floor(
            Date.parse('2026-04-05T06:00:00.000Z') / 1000
        );

        dataService.sendIpcEvent.mockImplementation(
            async (_type: string, payload: unknown) => {
                const action = (
                    payload as {
                        params: { action: string };
                    }
                ).params.action;

                const listing = {
                    id: 'current',
                    epg_id: 'channel-101.mock',
                    title: Buffer.from('Current Show').toString('base64'),
                    description: Buffer.from('Current description').toString(
                        'base64'
                    ),
                    start: '2026-04-05 03:00:00',
                    end: '2026-04-05 03:30:00',
                    start_timestamp: String(startTimestamp),
                    stop_timestamp: String(stopTimestamp),
                    channel_id: 'channel-101.mock',
                };

                if (action === 'get_short_epg') {
                    return { payload: { epg_listings: [listing] } };
                }

                return {
                    payload: {
                        epg_listings: [listing],
                    },
                };
            }
        );

        const shortItems = await service.getShortEpg(credentials, 101, 4);
        const fullItems = await service.getFullEpg(credentials, 101);

        expect(shortItems[0].start).toBe(fullItems[0].start);
        expect(shortItems[0].stop).toBe(fullItems[0].stop);
        expect(shortItems[0].start_timestamp).toBe(fullItems[0].start_timestamp);
        expect(shortItems[0].stop_timestamp).toBe(fullItems[0].stop_timestamp);
    });
});
