import App from "#core/app";

export default class extends App {

    // propeties
    get location () {
        return import.meta.url;
    }

    // protected
    async _init () {
        if ( process.cli?.command === "/postgresql/upgrage" ) {
            const [clusterVersion, clusterName] = process.cli.arguments["cluster"].split( "/" );

            const res = await this.postgresql.upgrade( clusterVersion, clusterName );

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
