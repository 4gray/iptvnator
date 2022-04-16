export class IpcCommand {
    constructor(public id: string, public callback: (payload) => void) {
        this.id = id;
        this.callback = callback;
    }
}
