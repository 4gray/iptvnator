import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AppConfig } from '../../environments/environment';
import { Playlist } from '../../../shared/playlist.interface';

@Injectable({
  providedIn: 'root'
})
export class PWAExternalService {
  private baseUrl: string;

  constructor(private http: HttpClient) {
    this.baseUrl = AppConfig.BACKEND_URL;
  }

  insertPlaylist(data: Playlist): Observable<Playlist> {
    return this.http.post<Playlist>(`${this.baseUrl}/addPlaylist`, data);
  }

  getPlaylists(query: any = {}): Observable<Playlist[]> {
    return this.http.get<Playlist[]>(`${this.baseUrl}/getPlaylists`, { params: query });
  }

  getAllPlaylists(): Observable<Playlist[]> {
    return this.http.get<Playlist[]>(`${this.baseUrl}/getAllPlaylists`);
  }

  getPlaylistById(id: string): Observable<Playlist> {
    return this.http.get<Playlist>(`${this.baseUrl}/getPlaylist/${id}`);
  }

  deletePlaylist(playlistId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/deletePlaylist/${playlistId}`);
  }

  updatePlaylist(playlistId: string, updatedPlaylist: Partial<Playlist>): Observable<any> {
    return this.http.put(`${this.baseUrl}/updatePlaylist/${playlistId}`, updatedPlaylist);
  }

  addManyPlaylists(playlists: Playlist[]): Observable<any> {
    return this.http.post(`${this.baseUrl}/addManyPlaylists`, playlists);
  }

  removeAllPlaylists(): Observable<any> {
    return this.http.delete(`${this.baseUrl}/removeAllPlaylists`);
  }
}