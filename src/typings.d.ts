/* SystemJS module definition */
declare const nodeModule: NodeModule;
interface NodeModule {
    id: string;
}
interface Window {
    process: any;
    require: any;
}
