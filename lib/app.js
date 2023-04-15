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
        var res;

        res = await super._init();
        if ( !res.ok ) return res;

        return result( 200 );
    }

    async _run () {
        this.#pgsql = new Pgsql();

        this.#pgsql.on( "exit", code => process.shutdownController.gracefulShutDown( { code } ) );

        await this.#pgsql.run( this.config );

        return super._run();
    }

    async _getHealthCheckStatus () {
        return result( this.#pgsql?.cron?.isConnected ? 200 : 500 );
    }
}
