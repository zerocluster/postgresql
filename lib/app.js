import App from "#core/app";

export default class extends App {

    // propeties
    get location () {
        return import.meta.url;
    }

    // protected
    async _init () {
        if ( process.cli?.options?.["migrate-from"] ) {
            const res = await this.postgresql.migrate( process.cli?.options?.["migrate-from"] );

            if ( !res.ok ) return res;

            process.exit();
        }
        else {
            return result( 200 );
        }
    }

    async _start () {
        return result( 200 );
    }
}
