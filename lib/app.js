import App from "#core/app";
import config from "#lib/app.config";
import Pgsql from "#lib/pgsql";

export default class extends App {
    #pgsql;

    constructor () {
        super( import.meta.url, config );
    }

    // static
    static cli () {
        return {
            "options": {},
            "arguments": {},
        };
    }

    // properties
    get cron () {
        return this.#pgsql.cron;
    }

    // public
    async run () {
        const res = await super.run();

        if ( !res.ok ) return res;

        this.#pgsql = new Pgsql();

        this.#pgsql.on( "exit", code => global.shutdown.gracefulShutdown( code ) );

        await this.#pgsql.run( this.env );

        return res;
    }

    // protected
    async _createRpc ( Rpc, options ) {
        return super._createRpc( class extends Rpc {
            async healthCheck () {
                return result( this.app.cron.isConnected ? 200 : 500 );
            }
        },
        options );
    }
}
