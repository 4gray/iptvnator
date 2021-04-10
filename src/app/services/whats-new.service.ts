import { ModalWindow } from 'ngx-whats-new/lib/modal-window.interface';
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
    providedIn: 'root',
})
export class WhatsNewService {
    /** Visibility state of the modal */
    dialogState$ = new BehaviorSubject<boolean>(false);

    /** Array with all available modals */
    modals = {
        '0.6.0': [
            {
                imageHeight: 470,
                imageBgColor: '#333',
                imageSrc: './assets/updates/060/dark-theme.png',
                title: 'New in v0.6.0 - Dark theme 🎉',
                text:
                    'Finally, the dark theme is now available. Check the settings page of the application to change the theme.',
                button: {
                    text: 'OKAY',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
            {
                imageHeight: 470,
                imageBgColor: '#333',
                imageSrc: './assets/updates/060/channel-logos.png',
                title: 'Channel logos 📺',
                text:
                    'The channel list was extended with the visualization of logotypes (only visible if they are defined in the playlist)',
                button: {
                    text: 'OKAY',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
            {
                imageHeight: 470,
                imageBgColor: '#333',
                imageSrc: './assets/updates/060/custom-user-agent.png',
                title: 'Custom user agent 🕵️‍♂️',
                text:
                    'Some IPTV providers need a specific user-agent in order to play their playlist. Support of custom user agent is available now.',
                button: {
                    text: 'GOT IT',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
        ],
    };

    /** Options for the "what is new" modal dialogs */
    options = {
        width: '500px',
        customStyle: {
            boxShadow: '0px 0px 10px 5px #111',
            backgroundColor: '#333',
            textColor: '#eee',
        },
    };

    /**
     * Changes the visibility state of the modal dialog
     * @param value flag to set
     */
    changeDialogVisibleState(value: boolean): void {
        this.dialogState$.next(value);
    }

    /**
     * Returns an array with modals for the provided version of the application
     * @param version version string
     */
    getModalsByVersion(version: string): ModalWindow[] {
        return this.modals[version] || [];
    }
}
