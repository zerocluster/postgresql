import App from "#core/app";
import Pgsql from "#lib/pgsql";

export default class extends App {
    #pgsql;

    // propeties
    get location () {
        return import.meta.url;
    }

    // protected
    async _init () {
        return result( 200 );
    }

    async _run () {
        this.#pgsql = new Pgsql( this );

        this.#pgsql.on( "exit", code => process.shutDown( { code } ) );

        const res = await this.#pgsql.run( this.config );
        if ( !res.ok ) return res;

        return result( 200 );
    }

    async _shutDown () {
        await this.#pgsql.fastShutDown();
    }

    async _checkHealth () {
        return result( this.#pgsql?.cron?.isConnected ? 200 : 500 );
    }
}
