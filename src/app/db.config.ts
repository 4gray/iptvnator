import { DBConfig } from 'ngx-indexed-db';

export const PLAYLISTS_STORE = 'playlists'; 

export const dbConfig: DBConfig  = {
  name: 'MyIptvDb',
  version: 1,
  objectStoresMeta: [{
    store: PLAYLISTS_STORE,
    storeConfig: { keyPath: 'id', autoIncrement: true },
    storeSchema: [
      { name: 'title', keypath: 'title', options: { unique: false } },
      { name: 'filename', keypath: 'filename', options: { unique: false } },
      { name: 'playlist', keypath: 'playlist', options: { unique: false } },
      { name: 'importDate', keypath: 'importDate', options: { unique: false } },
      { name: 'lastUsage', keypath: 'lastUsage', options: { unique: false } },
    ]
  }]
};