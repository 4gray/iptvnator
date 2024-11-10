import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  private externalDB: boolean;

  constructor() {
    this.externalDB = process.env.EXTERNAL_DB === 'true';
  }

  setExternalDB(value: boolean): void {
    this.externalDB = value;
  }

  getExternalDB(): boolean {
    return this.externalDB;
  }
}