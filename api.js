"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Api = void 0;
var electron_1 = require("electron");
var iptv_playlist_parser_1 = require("iptv-playlist-parser");
var axios_1 = require("axios");
var akita_1 = require("@datorama/akita");
var Datastore = require('nedb');
var db = new Datastore({ filename: 'data.db', autoload: true });
var Api = /** @class */ (function () {
    function Api() {
        var _this = this;
        electron_1.ipcMain.on('parse-playlist-by-url', function (event, args) {
            axios_1.default.get(args.url).then(function (result) {
                var array = result.data.split('\n');
                var parsedPlaylist = _this.parsePlaylist(array);
                var playlistObject = _this.createPlaylistObject(args.title, parsedPlaylist);
                _this.insertToDb(playlistObject);
                event.sender.send('parse-url-response', {
                    payload: playlistObject,
                });
            });
        });
        electron_1.ipcMain.on('parse-playlist', function (event, args) {
            var parsedPlaylist = _this.parsePlaylist(args.playlist);
            var playlistObject = _this.createPlaylistObject(args.title, parsedPlaylist);
            _this.insertToDb(playlistObject);
            event.sender.send('parse-response', { payload: playlistObject });
        });
        electron_1.ipcMain.on('playlists-all', function (event, args) {
            db.find({}, { count: 1, title: 1, _id: 1 }, function (err, playlists) {
                event.sender.send('playlist-all-result', {
                    payload: playlists,
                });
            });
        });
        electron_1.ipcMain.on('playlist-by-id', function (event, args) {
            db.findOne({ _id: args.id }, function (err, playlist) {
                event.sender.send('playlist-by-id-result', {
                    payload: playlist,
                });
            });
        });
        electron_1.ipcMain.on('playlist-remove-by-id', function (event, args) {
            db.remove({ _id: args.id }, function (err, playlist) {
                event.sender.send('playlist-remove-by-id-result', {
                    message: 'playlist was removed',
                });
            });
        });
    }
    /**
     * Saves playlist to the localStorage
     * @param name name of the playlist
     * @param playlist playlist to save
     */
    Api.prototype.createPlaylistObject = function (name, playlist) {
        return {
            id: akita_1.guid(),
            _id: akita_1.guid(),
            filename: name,
            title: name,
            count: playlist.items.length,
            playlist: playlist,
            importDate: new Date().getMilliseconds(),
            lastUsage: new Date().getMilliseconds(),
            favorites: [],
        };
    };
    /**
     * Parses string based array to playlist object
     * @param m3uArray m3u playlist as array with strings
     */
    Api.prototype.parsePlaylist = function (m3uArray) {
        var playlistAsString = m3uArray.join('\n');
        return iptv_playlist_parser_1.parse(playlistAsString);
    };
    /**
     * Inserts new playlist to the database
     * @param playlist playlist to add
     */
    Api.prototype.insertToDb = function (playlist) {
        db.insert(playlist, function (err, newrec) {
            console.log('playlist was saved...', newrec._id);
        });
    };
    return Api;
}());
exports.Api = Api;
//# sourceMappingURL=api.js.map