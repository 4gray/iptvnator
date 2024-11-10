import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AppConfig } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  private externalDB: boolean;
  private baseUrl: string;

  constructor(private http: HttpClient) {
    this.baseUrl = AppConfig.BACKEND_URL;
    this.checkDatabaseConnection();
  }

  private checkDatabaseConnection(): void {
    this.http.get<{ status: string }>(`${this.baseUrl}/check-db-connection`).subscribe({
      next: (response) => {
        this.externalDB = response.status === 'success';
      },
      error: (error) => {
        console.error('Error checking database connection:', error);
        this.externalDB = false;
      }
    });
  }

  setExternalDB(value: boolean): void {
    this.externalDB = value;
  }

  getExternalDB(): boolean {
    return this.externalDB;
  }
}