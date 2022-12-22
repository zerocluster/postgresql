import App from "#core/app";
import Pgsql from "#lib/pgsql";

export default class extends App {
    #pgsql;

    // propeties
    get location () {
        return import.meta.url;
    }

    get cron () {
        return this.#pgsql.cron;
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

        this.#pgsql.on( "exit", code => global.shutdown.gracefulShutdown( code ) );

        await this.#pgsql.run( this.config );

        return super._run();
    }

    // XXX
    async _createRpc ( Rpc, options ) {
        return super._createRpc(
            class extends Rpc {
                async healthCheck () {
                    return result( this.app.cron.isConnected ? 200 : 500 );
                }
            },
            options
        );
    }
}
