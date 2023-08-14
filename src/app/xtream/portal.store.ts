import { Injectable } from '@angular/core';
import { ComponentStore } from '@ngrx/component-store';

export interface PortalState {
    searchPhrase: string;
    content: any[];
}

@Injectable({ providedIn: 'root' })
export class PortalStore extends ComponentStore<PortalState> {
    constructor() {
        super({
            searchPhrase: '',
            content: [],
        });
    }

    // selectors
    readonly searchPhrase = this.selectSignal((state) => state.searchPhrase);

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
}
