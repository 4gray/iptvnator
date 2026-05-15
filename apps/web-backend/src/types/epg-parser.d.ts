declare module 'epg-parser' {
    const parser: {
        parse(xml: string): unknown;
    };

    export default parser;
}
