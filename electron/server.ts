import { IncomingMessage, ServerResponse } from "http";

const http = require('http');
const Sqrl = require('squirrelly');
const fs = require('fs');
const path = require('path');

export class Server {
    /** Server instance */
    server: any;
    /** Port number */
    port: number;
    /** Api instance */
    api: any;
    
    /**
     * Creates a new server instance
     * @param port port number
     * @param api application instance
     */
    constructor(_port: number, _api: any) {
        this.api = _api;
        this.port = _port;
        this.server = http.createServer(this.requestListener.bind(this));
        this.server.listen(this.port);
    }

    async requestListener(request: IncomingMessage, response: ServerResponse) {
        const currentPage = request.url?.split('?')[0]?.split('/').splice(-1)[0];
        console.log(this.api.store);
        switch (currentPage) {
            case '': {
                const indexFile = await fs.promises.readFile(path.join(__dirname, './remote-control/', 'index.sqrl'), 'utf-8');
                const renderedHtml = Sqrl.render(indexFile, {
                    headerText: 'My Dynamic Header',
                    upChannelText: 'Up Channel',
                    downChannelText: 'Down Channel',
                    upChannelUrl: '/upChannel',
                    downChannelUrl: '/downChannel',
                    title: 'IPTVNator'
                  });
                response.writeHead(200, { 'Content-Type': 'text/html' });
                response.end(renderedHtml);
                break; 
            }
            case 'upChannel': {
                // this.api.upChannel();
                response.writeHead(200, { 'Content-Type': 'text/html' });
                response.end('Up Channel');
                break;
            }
            default:
                response.writeHead(404, { 'Content-Type': 'text/html' });
                response.end('404');
                break;
        }
    }
}