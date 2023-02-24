const electron = require('electron');
const ipcRenderer = electron.ipcRenderer;
const zlib = require('zlib');
const parser = require('epg-parser');
const axios = require('axios');
import {
    EPG_ERROR,
    EPG_FETCH,
    EPG_FETCH_DONE,
    EPG_FORCE_FETCH,
    EPG_GET_CHANNELS,
    EPG_GET_CHANNELS_BY_RANGE,
    EPG_GET_CHANNELS_BY_RANGE_RESPONSE,
    EPG_GET_CHANNELS_DONE,
    EPG_GET_PROGRAM,
    EPG_GET_PROGRAM_DONE,
} from '../shared/ipc-commands';
import { EpgChannel } from '../src/app/player/models/epg-channel.model';
import { EpgProgram } from '../src/app/player/models/epg-program.model';

// EPG data store
let EPG_DATA: { channels: EpgChannel[]; programs: EpgProgram[] } = {
    channels: [],
    programs: [],
};
let EPG_DATA_MERGED: {
    [id: string]: EpgChannel & { programs: EpgProgram[] };
} = {};
const loggerLabel = '[EPG Worker]';

/** List with fetched EPG URLs */
const fetchedUrls: string[] = [];

/**
 * Fetches the epg data from the given url
 * @param epgUrl url of the epg file
 */
const fetchEpgDataFromUrl = (epgUrl: string) => {
    try {
        let axiosConfig = {};
        if (epgUrl.endsWith('.gz')) {
            axiosConfig = {
                responseType: 'arraybuffer',
            };
        }
        axios
            .get(epgUrl.trim(), axiosConfig)
            .then((response) => {
                console.log(loggerLabel, 'url content was fetched...');
                const { data } = response;
                if (epgUrl.endsWith('.gz')) {
                    console.log(loggerLabel, 'start unzipping...');
                    zlib.gunzip(data, (_err, output) => {
                        parseAndSetEpg(output);
                    });
                } else {
                    parseAndSetEpg(data);
                }
            })
            .catch((err) => {
                console.log(loggerLabel, err);
                ipcRenderer.send(EPG_ERROR);
            });
    } catch (error) {
        console.log(loggerLabel, error);
        ipcRenderer.send(EPG_ERROR);
    }
};

/**
 * Parses and sets the epg data
 * @param xmlString xml file content from the fetched url as string
 */
const parseAndSetEpg = (xmlString) => {
    console.log(loggerLabel, 'start parsing...');
    const parsedEpg = parser.parse(xmlString.toString());
    EPG_DATA = {
        channels: [...EPG_DATA.channels, ...parsedEpg.channels],
        programs: [...EPG_DATA.programs, ...parsedEpg.programs],
    };
    // map programs to channels
    EPG_DATA_MERGED = convertEpgData();
    ipcRenderer.send(EPG_FETCH_DONE);
    console.log(loggerLabel, 'done, parsing was finished...');
};

const convertEpgData = () => {
    const result: {
        [id: string]: EpgChannel & { programs: EpgProgram[] };
    } = {};

    EPG_DATA?.programs?.forEach((program) => {
        if (!result[program.channel]) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            const channel = EPG_DATA?.channels?.find(
                (channel) => channel.id === program.channel
            ) as EpgChannel;
            result[program.channel] = {
                ...channel,
                programs: [program],
            };
        } else {
            result[program.channel] = {
                ...result[program.channel],
                programs: [...result[program.channel].programs, program],
            };
        }
    });
    return result;
};

// fetches epg data from the provided URL
ipcRenderer.on(EPG_FETCH, (event, epgUrl: string) => {
    console.log(loggerLabel, 'epg fetch command was triggered');
    if (fetchedUrls.indexOf(epgUrl) > -1) {
        ipcRenderer.send(EPG_FETCH_DONE);
        return;
    }
    fetchedUrls.push(epgUrl);
    fetchEpgDataFromUrl(epgUrl);
});

// returns the epg data for the provided channel name and date
ipcRenderer.on(EPG_GET_PROGRAM, (event, args) => {
    const channelName = args.channel?.name;
    const tvgId = args.channel?.tvg?.id;
    if (!EPG_DATA || !EPG_DATA.channels) return;
    const foundChannel = EPG_DATA?.channels?.find((epgChannel) => {
        if (tvgId && tvgId === epgChannel.id) {
            return epgChannel;
        } else if (
            epgChannel.name.find((nameObj) => {
                if (
                    nameObj.value &&
                    nameObj.value.trim() === channelName.trim()
                )
                    return nameObj;
            })
        ) {
            return epgChannel;
        }
    });

    if (foundChannel) {
        const programs = EPG_DATA?.programs?.filter(
            (ch) => ch.channel === foundChannel.id
        );
        ipcRenderer.send(EPG_GET_PROGRAM_DONE, {
            payload: { channel: foundChannel, items: programs },
        });
    } else {
        console.log('EPG program for the channel was not found...');
        ipcRenderer.send(EPG_GET_PROGRAM_DONE, {
            payload: { channel: {}, items: [] },
        });
    }
});

ipcRenderer.on(EPG_GET_CHANNELS, () => {
    ipcRenderer.send(EPG_GET_CHANNELS_DONE, {
        payload: EPG_DATA,
    });
});

ipcRenderer.on(EPG_GET_CHANNELS_BY_RANGE, (event, args) => {
    ipcRenderer.send(EPG_GET_CHANNELS_BY_RANGE_RESPONSE, {
        payload: Object.entries(EPG_DATA_MERGED)
            .slice(args.skip, args.limit)
            .map((entry) => entry[1]),
    });
});

ipcRenderer.on(EPG_FORCE_FETCH, (event, url: string) => {
    fetchEpgDataFromUrl(url);
});
