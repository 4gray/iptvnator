export class IpcCommand {
    constructor(public id: string, public callback: () => void) {
        this.id = id;
        this.callback = callback;
    }
}
