import App from "#core/app";

export default class extends App {

    // propeties
    get location () {
        return import.meta.url;
    }

    // protected
    async _cli () {
        const config = {};

        if ( process.cli.command === "/run" ) {
            if ( process.cli.options?.cluster ) {
                config.components ||= {};
                config.components.postgresql ||= {};
                config.components.postgresql.clusterName = process.cli.options?.cluster;
            }
        }

        return result( 200, config );
    }

    async _init () {
        if ( process.cli?.command === "/postgresql/upgrage" ) {
            const res = await this.postgresql.upgrade( process.cli.arguments["cluster-version"], process.cli.arguments["cluster-name"] );

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
