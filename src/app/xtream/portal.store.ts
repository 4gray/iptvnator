import { Injectable } from '@angular/core';
import { ComponentStore } from '@ngrx/component-store';

export interface PortalState {
    searchPhrase: string;
    content: any[];
    hideExternalInfoDialog: boolean;
    currentVod: any;
    currentSerial: any;
    sortType: string;
}

@Injectable({ providedIn: 'root' })
export class PortalStore extends ComponentStore<PortalState> {
    constructor() {
        super({
            searchPhrase: '',
            currentVod: undefined,
            currentSerial: undefined,
            content: [],
            hideExternalInfoDialog:
                localStorage.getItem('hideExternalInfoDialog') === 'true',
            sortType: undefined
        });
    }

    // selectors
    readonly searchPhrase = this.selectSignal((state) => state.searchPhrase);
    readonly currentSerial = this.selectSignal((state) => state.currentSerial);
    readonly currentVod = this.selectSignal((state) => state.currentVod);
    
    readonly hideExternalInfoDialog = this.selectSignal(
        (state) => state.hideExternalInfoDialog
    );

    readonly sortType = this.selectSignal((state) => state.sortType);

    readonly getContentById = (id: string) =>
        this.selectSignal((state) => state.content.find((i) => i.id === id));

    // reducers
    readonly setSearchPhrase = this.updater(
        (state, searchPhrase: string): PortalState => ({
            ...state,
            searchPhrase,
        })
    );

    readonly setContent = this.updater(
        (state, content: any[]): PortalState => ({
            ...state,
            content,
        })
    );

    readonly setCurrentSerial = this.updater(
        (state, currentSerial: any): PortalState => ({
            ...state,
            currentSerial,
        })
    );

    readonly setCurrentVod = this.updater(
        (state, currentVod: any): PortalState => ({
            ...state,
            currentVod,
        })
    );

    readonly setHideExternalInfoDialog = this.updater(
        (state, hideExternalInfoDialog: boolean): PortalState => {
            localStorage.setItem(
                'hideExternalInfoDialog',
                hideExternalInfoDialog.toString()
            );
            return { ...state, hideExternalInfoDialog };
        }
    );

    readonly setSortType = this.updater(
        (state, sortType: string): PortalState => ({
            ...state,
            sortType,
        })
    );
}
