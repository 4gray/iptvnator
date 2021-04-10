import { Theme } from './../settings/theme.enum';
import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root',
})
export class SettingsService {
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
}
