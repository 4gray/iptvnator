import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import * as M3U8FileParser from 'm3u8-file-parser';

@Injectable({
    providedIn: 'root'
})
export class M3uService {
    m3u8FileParser = new M3U8FileParser();

    constructor(private http: HttpClient) {}

    /**
     * Returns playlist object
     */
    /* getPlaylist(): Observable<any> {
        return this.http.get('../your.json');
    } */

    convertArrayToPlaylist(m3uArray: any[]): any {
        this.m3u8FileParser.read(m3uArray.join('\n'));
        return this.m3u8FileParser.getResult();
    }
}
