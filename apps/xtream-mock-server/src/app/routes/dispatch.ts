import { Request, Response } from 'express';
import { handleGetAccountInfo } from '../handlers/get-account-info.handler.js';
import { handleGetLiveCategories, handleGetVodCategories, handleGetSeriesCategories } from '../handlers/get-categories.handler.js';
import { handleGetLiveStreams, handleGetVodStreams, handleGetSeriesStreams } from '../handlers/get-streams.handler.js';
import { handleGetVodInfo } from '../handlers/get-vod-info.handler.js';
import { handleGetSeriesInfo } from '../handlers/get-series-info.handler.js';
import { handleGetShortEpg } from '../handlers/get-short-epg.handler.js';

export function dispatchAction(req: Request, res: Response): void {
    const action = (req.query['action'] as string) ?? '';

    switch (action) {
        case '':
        case 'get_account_info':
            handleGetAccountInfo(req, res);
            break;
        case 'get_live_categories':
            handleGetLiveCategories(req, res);
            break;
        case 'get_vod_categories':
            handleGetVodCategories(req, res);
            break;
        case 'get_series_categories':
            handleGetSeriesCategories(req, res);
            break;
        case 'get_live_streams':
            handleGetLiveStreams(req, res);
            break;
        case 'get_vod_streams':
            handleGetVodStreams(req, res);
            break;
        case 'get_series':
            handleGetSeriesStreams(req, res);
            break;
        case 'get_vod_info':
            handleGetVodInfo(req, res);
            break;
        case 'get_series_info':
            handleGetSeriesInfo(req, res);
            break;
        case 'get_short_epg':
            handleGetShortEpg(req, res);
            break;
        default:
            res.status(400).json({ error: `Unknown action: ${action}` });
    }
}
