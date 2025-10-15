export class IpcCommand {
    constructor(
        public id: string,
        public callback: (payload: any) => void
    ) {
        this.id = id;
        this.callback = callback;
    }
}
