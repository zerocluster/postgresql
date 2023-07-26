import App from "#core/app";
import PostgreSql from "#lib/postgresql";

export default class extends App {
    #postgreSql;

    // propeties
    get location () {
        return import.meta.url;
    }

    // protected
    async _init () {
        return result( 200 );
    }

    async _start () {
        this.#postgreSql = new PostgreSql( this, this.config, {
            "standby": process.cli.options.standby,
        } );

        this.#postgreSql.on( "exit", code => process.shutDown( { code } ) );

        const res = await this.#postgreSql.start();
        if ( !res.ok ) return res;

        return result( 200 );
    }

    async _shutDown () {
        await this.#postgreSql.fastShutDown();
    }
}
