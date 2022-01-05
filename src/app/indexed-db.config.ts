import { DBConfig } from 'ngx-indexed-db';

/**
 * Contains names of the database stores
 */
export enum DbStores {
    Playlists = 'playlists',
}

/** Defines db tables and schema */
export const dbConfig: DBConfig = {
    name: 'iptvnator',
    version: 1,
    objectStoresMeta: [
        {
            store: DbStores.Playlists,
            storeConfig: { keyPath: '_id', autoIncrement: false },
            storeSchema: [
                {
                    name: '_id',
                    keypath: '_id',
                    options: { unique: false },
                },
                {
                    name: 'filename',
                    keypath: 'filename',
                    options: { unique: false },
                },
                { name: 'title', keypath: 'title', options: { unique: false } },
                { name: 'count', keypath: 'count', options: { unique: false } },
                {
                    name: 'playlist',
                    keypath: 'playlist',
                    options: { unique: false },
                },
                {
                    name: 'importDate',
                    keypath: 'importDate',
                    options: { unique: false },
                },
                {
                    name: 'lastUsage',
                    keypath: 'lastUsage',
                    options: { unique: false },
                },
                {
                    name: 'favorites',
                    keypath: 'favorites',
                    options: { unique: false },
                },
                {
                    name: 'autoRefresh',
                    keypath: 'autoRefresh',
                    options: { unique: false },
                },
                {
                    name: 'url',
                    keypath: 'url',
                    options: { unique: false },
                },
                {
                    name: 'filePath',
                    keypath: 'filePath',
                    options: { unique: false },
                },
            ],
        },
    ],
};
