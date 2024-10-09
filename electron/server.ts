import { IncomingMessage, ServerResponse } from "http";
import { REMOTE_CONTROL_CHANGE_CHANNEL } from "../shared/ipc-commands";

const http = require('http');
const Sqrl = require('squirrelly');
const fs = require('fs');
const path = require('path');

export class Server {
    /** Server instance */
    server: any;
    /** Api instance */
    api: any;

    /**
     * Creates a new server instance
     * @param port port number
     * @param api application instance
     */
    constructor(_api: any) {
        this.api = _api;
        this.server = http.createServer(this.requestListener.bind(this));
    }

    updateSettings() {
        if (this.api.settings.remoteControl && !this.server.listening) {
            this.server.listen(this.api.settings.remoteControlPort);
        } else if (this.server.listening && !this.api.settings.remoteControl) {
            this.server.close();
        }
    }

    async getTranslation() {
        const language = this.api.settings && this.api.settings.language ? this.api.settings.language : 'en';
        const languageFileContent = await fs.promises.readFile(path.join(__dirname, `../src/assets/i18n/${language}.json`), 'utf-8');
        return JSON.parse(languageFileContent);
    }

    getTranslationValue(key: string, translation: any, defaultValue: string) {
        if (translation && translation.REMOTE_CONTROL) {
            const translationValue = translation.REMOTE_CONTROL[key];
            if (translationValue) {
                return translationValue;
            }
        }
        return defaultValue;
    }

    async requestListener(request: IncomingMessage, response: ServerResponse) {
        const currentPage = request.url?.split('?')[0]?.split('/').splice(-1)[0];
        const translation = await this.getTranslation();
        switch (currentPage) {
            case '': {
                const indexFile = await fs.promises.readFile(path.join(__dirname, './remote-control/', 'index.sqrl'), 'utf-8');
                const renderedHtml = Sqrl.render(indexFile, {
                    headerText: this.getTranslationValue('HEADER', translation, 'Remote Control'),
                    upChannelText: this.getTranslationValue('UP_CHANNEL', translation, 'Up Channel'),
                    downChannelText: this.getTranslationValue('DOWN_CHANNEL', translation, 'Down Channel'),
                    upChannelUrl: '/upChannel',
                    downChannelUrl: '/downChannel',
                    title: this.getTranslationValue('TITLE', translation, 'IPTVNator'),
                    footer: this.getTranslationValue('FOOTER', translation, 'IPTVNator')
                  });
                response.writeHead(200, { 'Content-Type': 'text/html' });
                response.end(renderedHtml);
                break; 
            }
            case 'upChannel': {
                this.api.mainWindow.webContents.send(REMOTE_CONTROL_CHANGE_CHANNEL, { type: 'up' });
                response.writeHead(200, { 'Content-Type': 'text/html' });
                response.end('Up Channel');
                break;
            }
            case 'downChannel': {
                this.api.mainWindow.webContents.send(REMOTE_CONTROL_CHANGE_CHANNEL, { type: 'down' });
                response.writeHead(200, { 'Content-Type': 'text/html' });
                response.end('Down Channel');
                break;
            }
            default:
                response.writeHead(404, { 'Content-Type': 'text/html' });
                response.end('404');
                break;
        }
    }
}