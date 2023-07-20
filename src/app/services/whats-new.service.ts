import { Injectable } from '@angular/core';
import { ModalWindow } from 'ngx-whats-new/lib/modal-window.interface';
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
                text: 'Finally, the dark theme is now available. Check the settings page of the application to change the theme.',
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
                text: 'The channel list was extended with the visualization of logotypes (only visible if they are defined in the playlist)',
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
                text: 'Some IPTV providers need a specific user-agent in order to play their playlist. Support of custom user agent is available now.',
                button: {
                    text: 'GOT IT',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
        ],
        '0.7.0': [
            {
                imageHeight: 500,
                imageBgColor: '#333',
                imageSrc: './assets/updates/070/refresh-playlist.png',
                title: 'New in v0.7.0 - Refresh playlists 🎉',
                text: "Now you don't have to delete and re-add a playlist if it changes, you can simply update it directly from the user interface.",
                button: {
                    text: 'Nice!',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
            {
                imageHeight: 500,
                imageBgColor: '#333',
                imageSrc: './assets/updates/070/auto-refresh.png',
                title: 'Auto-refresh playlists 🎉',
                text: 'In addition, an auto-refresh playlist function is available so that the playlists will be updated automatically every time the app is started.',
                button: {
                    text: 'Okay',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
        ],
        '0.8.0': [
            {
                imageHeight: 310,
                imageBgColor: '#333',
                imageSrc: './assets/updates/080/translations.png',
                title: 'New in v0.8.0 - New translations 🎉',
                html: 'The new release includes the localization of the application into two new languages: Korean and Spanish. Many thanks to the contributors for the translation! (<a target="_blank" href="https://github.com/chaeya">@chaeya</a>, <a target="_blank" href="https://github.com/sguinetti">@sguinetti</a>, <a target="_blank" href="https://github.com/anthonyaxenov">anthonyaxenov</a>)',
                button: {
                    text: 'Nice!',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
            {
                title: 'User-Agent Support on Channel Level',
                html: 'Now user-agent support can be specified not only on the playlist level but also on the level of individual channels. For this purpose, support for Kodi <a target="_blank" href="https://github.com/4gray/iptvnator/issues/57">playlist format</a> was added to the application.',
                button: {
                    text: 'Next!',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
            {
                title: 'Information about current EPG program',
                html: 'Similarly to digital receivers, after you switch channels at the bottom of the screen you will see a pop-up window with information about the current program <a target="_blank" href="https://github.com/4gray/iptvnator/issues/51">#51</a>',
                imageHeight: 250,
                imageBgColor: '#333',
                imageSrc: './assets/updates/080/channel-info.png',
                button: {
                    text: 'Next!',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
            {
                title: 'This and that',
                html: 'In addition to the already mentioned new features, some bugs have been fixed and the internal dependencies of the application have been updated. Thanks for all the <a href="https://github.com/4gray/iptvnator/issues" target="_blank">ideas</a>, contributions and <a target="_blank" href="https://www.buymeacoffee.com/4gray">first donations.</a>',
                button: {
                    text: 'YAY!',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
        ],
        '0.9.0': [
            {
                imageHeight: 310,
                imageBgColor: '#333',
                imageSrc: './assets/updates/090/reorder-playlists.gif',
                title: '🎉 v0.9.0 - rearrange playlists',
                html: 'The new version of the app has an option to <a href="https://github.com/4gray/iptvnator/issues/77" target="_blank">sort the playlists</a> using drag&drop.',
                button: {
                    text: 'YAY!',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
            {
                imageHeight: 310,
                imageBgColor: '#333',
                imageSrc: './assets/updates/090/subtitle-option.png',
                title: 'Global subtitle display setting',
                html: 'The new version has the ability to enable/disable subtitles on a global level for all channels.',
                button: {
                    text: 'YAY!',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
            {
                imageHeight: 310,
                imageBgColor: '#333',
                imageSrc: './assets/updates/090/languages.png',
                title: 'Chinese translation',
                html: 'Thanks to <a target="_blank" href="https://github.com/JoJenH">@JoJenH</a> for the translation.',
                button: {
                    text: 'YAY!',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
            {
                title: 'This & That',
                html: `
                    * improved english translation (thanks to <a target="_blank" href="https://github.com/mbuett">@mbuett</a>)<br />
                    * bugfixes and visual improvements, see <a href="https://github.com/4gray/iptvnator/blob/master/CHANGELOG.md">changelog</a> for more details
                `,
                button: {
                    text: 'YAY!',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
        ],
        '0.10.0': [
            {
                title: "🎉 v0.10.0 - What's new",
                html: `
                    <h3>Playlist navigation from the sidebar</h3>
                    Switching between playlists is now possible directly from the sidebar and without interrupting channel viewing.
                    
                    <h3>Global favorites</h3>
                    Additional playlist has been added, which is generated on the fly and contains favorite channels from all existing playlists.

                    <h3>PWA</h3>
                    IPTVnator is now available as a <a href="https://iptvnator.vercel.app/" target="_blank">web-application</a>, which means that you can use it directly from the browser. This means that application can be run on smartphones, tablets, set-top boxes or smart tv browsers.

                    <h3>French localization</h3>
                    The app has been translated into another language and is now available in French. Many thanks to <a href="https://github.com/m-p-3" target="_blank">@m-p-3</a> for the translation!
                `,
                button: {
                    text: 'Close',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
        ],
        '0.11.0': [
            {
                imageHeight: 400,
                imageBgColor: '#333',
                imageSrc: './assets/updates/0110/multiple-epg-sources.png',
                title: 'Multiple EPG sources',
                html: 'In the new version of the application, you can add more than one URL as a source of the EPG program.',
                button: {
                    text: 'NEXT',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
            {
                imageHeight: 400,
                imageBgColor: '#333',
                imageSrc: './assets/updates/0110/multi-epg-view.png',
                title: '🎉 Multi-EPG view',
                html: 'The first version of multi-EPG view was developed, which is familiar to many users from set-top boxes. At this stage the view works in purely informative mode.',
                button: {
                    text: 'NEXT',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
            {
                imageHeight: 400,
                imageBgColor: '#333',
                imageSrc: './assets/updates/0110/import-playlist-as-text.png',
                title: 'Import playlist from plain text',
                html: 'Another playlist import option became available - import m3u(8) as text. Just copy the playlist to the clipboard and paste it into the application without having to save it to disk.',
                button: {
                    text: 'NEXT',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
            {
                title: 'This&that',
                html: `<h2>Improvements in PWA</h2> 
                A number of visual changes have been made to improve the experience of using the app on mobile devices.
                <br />
                <h2>Internalization</h2> The localization of the project has been improved, but help is still needed with the translation into different languages.
                <br />
                <h2>Dependencies updates</h2> 
                The basic libraries used in the application have been updated (angular, electron etc)`,
                button: {
                    text: 'CLOSE',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
        ],
        '0.13.0': [
            {
                imageHeight: 400,
                imageBgColor: '#333',
                imageSrc: './assets/updates/0130/mpv-player.png',
                title: '🚀 MPV player integration',
                html: 'Long-awaited mpv player support, which can now be selected from the settings. Before activating the player from the settings page, make sure it is installed on your system. For more details about mvp integration, check the <a target="_blank" href="https://github.com/4gray/iptvnator/wiki/What-is-mpv-video-player-and-how-to-install-it-on-different-operating-systems%3F">wiki page</a>.',
                button: {
                    text: 'YAY',
                    textColor: '#ccc',
                    bgColor: '#111',
                },
            },
        ],
        '0.14.0': [
            {
                title: '🚀 New in v0.14.0',
                html: `The main feature of this release is &mdash; Xtream Code IPTV support. The feature is also available in PWA, but works best in electron version of the application and combination with mpv player.<br />
                
                <h3>Other updates:</h3>
                * possibility to specify custom path for mpv player<br/>
                * fixed an annoying bug that appeared when reopening mpv player<br/>
                * updated libraries used under the hood<br/>
                * fixed bug related to user-agent handling`,
                button: {
                    text: 'GO!',
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

    /**
     * Returns modals with latest changes
     */
    getLatestChanges(): ModalWindow[] {
        const modalsLength = Object.keys(this.modals).length;
        const lastVersion = Object.keys(this.modals)[modalsLength - 1];
        return this.modals[lastVersion];
    }
}
