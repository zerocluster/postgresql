import App from "#core/app";
import Pgsql from "#lib/pgsql";

export default class extends App {
    #pgsql;

    static cli () {
        return {
            "options": {
                "standby-level": {
                    "short": null,
                    "description": `Standby cascade level`,
                    "schema": {
                        "enum": [1, 2],
                    },
                },
                "standby-id": {
                    "short": null,
                    "description": `Synchronous standby id`,
                    "schema": {
                        "type": "integer",
                        "minimum": 0,
                    },
                },
            },
        };
    }

    // propeties
    get location () {
        return import.meta.url;
    }

    // protected
    async _init () {
        return result( 200 );
    }

    async _run () {
        this.#pgsql = new Pgsql( this, this.config, process.cli.options.standbyLevel, process.cli.options.standbyid );

        this.#pgsql.on( "exit", code => process.shutDown( { code } ) );

        const res = await this.#pgsql.run();
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
