import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  private enableExternalDB: boolean;

  constructor() {
    this.enableExternalDB = false;
  }

  setExternalDB(value: boolean): void {
    this.enableExternalDB = value;
  }

  isExternalDBEnabled(): boolean {
    return this.enableExternalDB;
  }
}