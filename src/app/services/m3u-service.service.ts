import { Injectable } from '@angular/core';
import { parse } from 'iptv-playlist-parser';

@Injectable({
    providedIn: 'root',
})
export class M3uService {
    /**
     * Parses string based array to playlist object
     * @param m3uArray m3u playlist as array with strings
     */
    parsePlaylist(m3uArray: any[]): any {
        const playlistAsString = m3uArray.join('\n');
        return parse(playlistAsString);
    }
}
