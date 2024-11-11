import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AppConfig } from '../../environments/environment';
import { Playlist } from '../../../shared/playlist.interface';

@Injectable({
  providedIn: 'root'
})
export class PWAExternalService {
  /** Proxy URL to avoid CORS issues */
  corsProxyUrl = AppConfig.BACKEND_URL;

  constructor(private http: HttpClient) {
  }

  insertPlaylist(data: Playlist): Observable<Playlist> {
    return this.http.post<Playlist>(`${this.corsProxyUrl}/addPlaylist`, data);
  }

  getPlaylists(query: any = {}): Observable<Playlist[]> {
    return this.http.get<Playlist[]>(`${this.corsProxyUrl}/getPlaylists`, { params: query });
  }

  getAllPlaylists(): Observable<Playlist[]> {
    return this.http.get<Playlist[]>(`${this.corsProxyUrl}/getAllPlaylists`);
  }

  getPlaylistById(id: string): Observable<Playlist> {
    return this.http.get<Playlist>(`${this.corsProxyUrl}/getPlaylist/${id}`);
  }

  deletePlaylist(playlistId: string): Observable<any> {
    return this.http.delete(`${this.corsProxyUrl}/deletePlaylist/${playlistId}`);
  }

  updatePlaylist(playlistId: string, updatedPlaylist: Partial<Playlist>): Observable<any> {
    return this.http.put(`${this.corsProxyUrl}/updatePlaylist/${playlistId}`, updatedPlaylist);
  }

  addManyPlaylists(playlists: Playlist[]): Observable<any> {
    return this.http.post(`${this.corsProxyUrl}/addManyPlaylists`, playlists);
  }

  deleteAllPlaylists(): Observable<any> {
    return this.http.delete(`${this.corsProxyUrl}/deleteAllPlaylists`);
  }
}