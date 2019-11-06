import { Injectable } from '@angular/core';
import * as M3U8FileParser from 'm3u8-file-parser';

@Injectable({
    providedIn: 'root',
})
export class M3uService {
    /**
     * m3u8 parser
     */
    m3u8FileParser = new M3U8FileParser();

    /**
     * Converts string based array to playlist object
     * @param m3uArray m3u playlist as array with strings
     */
    convertArrayToPlaylist(m3uArray: any[]): any {
        this.m3u8FileParser.read(m3uArray.join('\n'));
        return this.m3u8FileParser.getResult();
    }

    /**
     * Converts string to playlist structure
     * @param m3uString playlist as string
     */
    convertStringToPlaylist(m3uString: string): any {
        this.m3u8FileParser.read(m3uString);
        return this.m3u8FileParser.getResult();
    }
}
