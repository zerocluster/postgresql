import App from "#core/app";

export default class extends App {

    // propeties
    get location () {
        return import.meta.url;
    }

    // protected
    async _cli ( config ) {
        if ( process.cli.command === "run" ) {
            if ( process.cli.options.cluster ) {
                config.components ||= {};
                config.components.postgresql ||= {};
                config.components.postgresql.clusterName = process.cli.options.cluster;
            }
        }
        else if ( process.cli.command === "postgresql/upgrade" ) {
            this.UPGRADE_POSTGRESQL = [

                //
                process.cli.arguments[ "cluster-version" ],
                process.cli.arguments[ "cluster-name" ],
            ];
        }

        return result( 200 );
    }

    async _init () {
        return result( 200 );
    }

    async _start () {
        return result( 200 );
    }
}
