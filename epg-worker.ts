const electron = require('electron');
const ipcRenderer = electron.ipcRenderer;
const zlib = require('zlib');
const parser = require('epg-parser');
const axios = require('axios');
import { EpgChannel } from './src/app/player/models/epg-channel.model';
import { EpgProgram } from './src/app/player/models/epg-program.model';
import {
    EPG_ERROR,
    EPG_FETCH,
    EPG_FETCH_DONE,
    EPG_GET_PROGRAM,
    EPG_GET_PROGRAM_DONE,
} from './shared/ipc-commands';

// EPG data store
let EPG_DATA: { channels: EpgChannel[]; programs: EpgProgram[] };
const loggerLabel = '[EPG Worker]';

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
    EPG_DATA = parser.parse(xmlString.toString());
    ipcRenderer.send(EPG_FETCH_DONE);
    console.log(loggerLabel, 'done, parsing was finished...');
};

// fetches epg data from the provided URL
ipcRenderer.on(EPG_FETCH, (event, arg) => {
    console.log(loggerLabel, 'epg fetch command was triggered');
    fetchEpgDataFromUrl(arg);
});

// returns the epg data for the provided channel name and date
ipcRenderer.on(EPG_GET_PROGRAM, (event, args) => {
    if (!EPG_DATA || !EPG_DATA.channels) return;
    const foundChannel = EPG_DATA?.channels?.find((epgChannel) => {
        if (
            epgChannel.name.find((nameObj) => {
                if (nameObj.value.trim() === args.channelName.trim())
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
        ipcRenderer.send(EPG_GET_PROGRAM_DONE, {
            payload: { channel: {}, items: [] },
        });
    }
});
