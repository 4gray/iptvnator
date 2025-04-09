import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { AppConfig } from '../../environments/environment';
import { Playlist } from '../../../shared/playlist.interface';


@Injectable({
  providedIn: 'root',
})
export class PWAExternalService {
  /** Proxy URL to avoid CORS issues */
  corsProxyUrl = AppConfig.BACKEND_URL;
  private token: string;
  // Store the token expiration timestamp
  private tokenExpiresAt: number;

  constructor(private http: HttpClient) {}

  /**
   * Fetches the OAuth token from the backend.
   */
  private fetchToken(): Observable<string> {
    const nonce = this.generateNonce();
    return from(this.createHmac(AppConfig.SECRET_KEY, nonce)).pipe(
      switchMap((encodedApiKey) => {
        const headers = new HttpHeaders({
          'x-api-key': encodedApiKey,
          'x-nonce': nonce,
        });

        return this.http
          .post<{ token: string; expiresIn: number }>(`${this.corsProxyUrl}/token`, {}, { headers })
          .pipe(
            map((response) => {
              this.token = response.token; // Cache the token
              this.tokenExpiresAt = Date.now() + response.expiresIn * 1000; // Calculate expiration time
              return response.token;
            })
          );
      })
    );
  }

  /**
   * Ensures the token is available and valid, and returns it.
   */
  private getToken(): Observable<string> {
    if (this.token && this.tokenExpiresAt > Date.now()) {
      // Return cached token if it's still valid
      return from(Promise.resolve(this.token));
    }
    // Fetch a new token if expired or not available
    return this.fetchToken();
  }

  /**
   * Creates an HMAC using the browser's SubtleCrypto API.
   */
  private async createHmac(secret: string, data: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(data);

    const cryptoKey = await window.crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await window.crypto.subtle.sign('HMAC', cryptoKey, messageData);
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Generates a unique nonce using `crypto.randomBytes`.
   */
  private generateNonce(): string {
    return ([1e7] as any + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c: any) =>
      (c ^ (window.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
  }

  /**
   * Fetches the database status from the backend.
   */
  getDatabaseStatus(): Observable<{ status: string; dbEnabled: boolean }> {
    return this.http.get<{ status: string; dbEnabled: boolean }>(`${this.corsProxyUrl}/connectionStatus`);
  }

  insertPlaylist(data: Playlist): Observable<Playlist> {
    return this.getToken().pipe(
      switchMap((token) => {
        const headers = new HttpHeaders({
          Authorization: `Bearer ${token}`,
        });
        return this.http.post<Playlist>(`${this.corsProxyUrl}/addPlaylist`, data, { headers });
      })
    );
  }

  getPlaylists(query: any = {}): Observable<Playlist[]> {
    return this.getToken().pipe(
      switchMap((token) => {
        const headers = new HttpHeaders({
          Authorization: `Bearer ${token}`,
        });
        return this.http.get<Playlist[]>(`${this.corsProxyUrl}/getPlaylists`, {
          headers,
          params: query,
        });
      })
    );
  }

  getAllPlaylists(): Observable<Playlist[]> {
    return this.getToken().pipe(
      switchMap((token) => {
        const headers = new HttpHeaders({
          Authorization: `Bearer ${token}`,
        });
        return this.http.get<Playlist[]>(`${this.corsProxyUrl}/getAllPlaylists`, { headers });
      })
    );
  }

  getPlaylistById(id: string): Observable<Playlist> {
    return this.getToken().pipe(
      switchMap((token) => {
        const headers = new HttpHeaders({
          Authorization: `Bearer ${token}`,
        });
        return this.http.get<Playlist>(`${this.corsProxyUrl}/getPlaylist/${id}`, { headers });
      })
    );
  }

  deletePlaylist(playlistId: string): Observable<any> {
    return this.getToken().pipe(
      switchMap((token) => {
        const headers = new HttpHeaders({
          Authorization: `Bearer ${token}`,
        });
        return this.http.delete(`${this.corsProxyUrl}/deletePlaylist/${playlistId}`, { headers });
      })
    );
  }

  updatePlaylist(playlistId: string, updatedPlaylist: Partial<Playlist>): Observable<any> {
    return this.getToken().pipe(
      switchMap((token) => {
        const headers = new HttpHeaders({
          Authorization: `Bearer ${token}`,
        });
        return this.http.put(`${this.corsProxyUrl}/updatePlaylist/${playlistId}`, updatedPlaylist, {
          headers,
        });
      })
    );
  }

  addManyPlaylists(playlists: Playlist[]): Observable<any> {
    return this.getToken().pipe(
      switchMap((token) => {
        const headers = new HttpHeaders({
          Authorization: `Bearer ${token}`,
        });
        return this.http.post(`${this.corsProxyUrl}/addManyPlaylists`, playlists, { headers });
      })
    );
  }

  deleteAllPlaylists(): Observable<any> {
    return this.getToken().pipe(
      switchMap((token) => {
        const headers = new HttpHeaders({
          Authorization: `Bearer ${token}`,
        });
        return this.http.delete(`${this.corsProxyUrl}/deleteAllPlaylists`, { headers });
      })
    );
  }
}