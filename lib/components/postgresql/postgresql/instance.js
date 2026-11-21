import Api from "#core/api";

export default class PostgresqlInstance {
    #manager;
    #hostname;
    #api;
    #status = null;
    #busy = false;
    #role = null;
    #savedRole = null;
    #version = null;
    #timeline = null;
    #lsn = null;
    #history = null;
    #standby = false;

    constructor ( manager, uri ) {
        this.#manager = manager;

        const url = new URL( `ws://${ uri }` );

        this.#hostname = url.hostname;

        this.#api = new Api( url );
    }

    // properties
    get hostname () {
        return this.#hostname;
    }

    get api () {
        return this.#api;
    }

    get status () {
        return this.#status;
    }

    get busy () {
        return this.#busy;
    }

    get role () {
        return this.#role;
    }

    // the last role, that the instance was started with, it is kept after the stop
    get savedRole () {
        return this.#savedRole;
    }

    get version () {
        return this.#version;
    }

    get timeline () {
        return this.#timeline;
    }

    get lsn () {
        return this.#lsn;
    }

    // list of ancestors of the timeline: [ { timeline, lsn } ], where lsn is the point, where the history left this timeline
    get history () {
        return this.#history;
    }

    get standby () {
        return this.#standby;
    }

    // public
    async getStatus () {
        const res = await this.#api.call( "postgresql/get-status" );

        return this.#updateStatus( res );
    }

    async recover () {
        const res = await this.#api.call( "postgresql/recover" );

        return this.#updateStatus( res );
    }

    async start ( role, { replicationHostname } = {} ) {
        const res = await this.#api.call( "postgresql/start", {
            role,
            replicationHostname,
        } );

        return this.#updateStatus( res );
    }

    async stop () {
        const res = await this.#api.call( "postgresql/stop" );

        return this.#updateStatus( res );
    }

    async deleteClusterOldVersions () {
        return this.#api.call( "postgresql/delete-cluster-old-versions", {
            "password": this.#manager.postgresql.config.replication.password,
        } );
    }

    // private
    #updateStatus ( res ) {
        const data = res.data ?? {};

        this.#status = data.status ?? null;
        this.#busy = data.busy ?? false;
        this.#role = data.role ?? null;
        this.#savedRole = data.savedRole ?? null;
        this.#version = data.version ?? null;
        this.#timeline = data.timeline ?? null;
        this.#lsn = data.lsn ?? null;
        this.#history = data.history ?? null;
        this.#standby = data.standby ?? false;

        return res;
    }
}
