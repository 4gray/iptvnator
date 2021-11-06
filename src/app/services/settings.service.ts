import { Theme } from './../settings/theme.enum';
import { Injectable } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { STORE_KEY } from '../shared/enums/store-keys.enum';

@Injectable({
    providedIn: 'root',
})
export class SettingsService {
    /** Creates an instance of SettingsService */
    constructor(private storage: StorageMap) {}

    /**
     * Changes the visual theme of the application
     * @param selectedTheme theme to set
     */
    changeTheme(selectedTheme: Theme): void {
        if (selectedTheme === Theme.LightTheme) {
            document.body.classList.remove('dark-theme');
        } else if (selectedTheme === Theme.DarkTheme) {
            document.body.classList.add('dark-theme');
        }
    }

    /**
     * Returns the value of the given key from the local storage
     * @param key key to get
     * @returns returns the value of the given key
     */
    getValueFromLocalStorage(key: STORE_KEY) {
        return this.storage.get(key);
    }

    /**
     * Sets the given key/value pair in the local storage
     * @param key key to set
     * @param value value to set
     */
    setValueToLocalStorage(key: STORE_KEY, value: string) {
        this.storage.set(key, value).subscribe(() => {});
    }
}
