import sql from "#core/sql";
import { ROLE } from "../utils.js";

const CHECK_INTERVAL = 10_000,
    STALL_TIMEOUT = 300_000,
    CONNECT_TIMEOUT = 30_000;

const SQL = {
    "checkStandby": sql`
SELECT
    ( SELECT status FROM pg_catalog.pg_stat_wal_receiver ) AS receiver_status,
    ( SELECT count( * )::int4 FROM pg_catalog.pg_stat_activity WHERE backend_type = 'startup' AND wait_event IN ( 'RecoveryWalStream', 'RecoveryRetrieveRetryInterval' ) ) AS startup_idle
`.prepare(),
};

export default class PostgresqlClusterMonitoring {
    #cluster;
    #started = false;
    #dbh;
    #abortController;
    #done;

    constructor ( cluster ) {
        this.#cluster = cluster;
    }

    // public
    start () {
        if ( this.#started ) return;
        this.#started = true;

        this.#abortController = new AbortController();

        this.#dbh = sql.new( "postgresql:" );

        this.#done = this.#run( this.#dbh, this.#abortController.signal );
    }

    async stop () {
        if ( !this.#started ) return;
        this.#started = false;

        const abortController = this.#abortController,
            dbh = this.#dbh,
            done = this.#done;

        this.#abortController = null;
        this.#dbh = null;
        this.#done = null;

        abortController.abort();

        await dbh.forceDestroy();

        await done;
    }

    // private
    async #run ( dbh, signal ) {

        // standby does not receive wal since this moment
        let brokenSince = null;

        while ( !signal.aborted ) {

            // the connection is persistent, wait until it is (re)established
            if ( !dbh.isConnected ) {
                brokenSince = null;

                const connected = await dbh.waitConnect( {
                    signal,
                    "timeout": CONNECT_TIMEOUT,
                } );

                // there is no connection
                if ( !connected ) {

                    // the monitoring is stopped
                    if ( signal.aborted ) break;

                    // the connection is not established in time, so the postmaster is considered down
                    this.#onConnectionLost( `connection is not established for ${ CONNECT_TIMEOUT / 1000 } seconds` );
                }
            }

            if ( this.#cluster.role !== ROLE.PRIMARY ) {
                brokenSince = await this.#checkStandby( dbh, brokenSince, signal );
            }

            await dbh.waitDisconnect( {
                signal,
                "timeout": CHECK_INTERVAL,
            } );
        }
    }

    // postgres does not exit, if the standby can not receive wal (for example, the replication slot is lost): the walreceiver is restarted endlessly and the standby stays alive with stale data,
    // so the process is exited and the cluster manager restarts the node, on the start the slot is checked and recreated, and the base backup is made if the wal is already removed
    // returns the time, since which the standby does not receive wal, or null
    async #checkStandby ( dbh, brokenSince, signal ) {
        const state = await this.#getReplicationState( dbh );

        // the state is unknown
        if ( !state || signal.aborted ) return brokenSince;

        // wal is received, or the startup process is still replaying local wal (the walreceiver is started after that)
        if ( state.streaming || !state.startupIdle ) return null;

        brokenSince ??= Date.now();

        if ( Date.now() - brokenSince >= STALL_TIMEOUT ) {
            this.#onStandbyBroken( `wal is not received for ${ Math.round( ( Date.now() - brokenSince ) / 1000 ) } seconds` );
        }

        return brokenSince;
    }

    async #getReplicationState ( dbh ) {
        const res = await dbh.selectRow( SQL.checkStandby );
        if ( !res.ok || !res.data ) return;

        return {
            "streaming": res.data.receiver_status === "streaming",
            "startupIdle": res.data.startup_idle > 0,
        };
    }

    #onStandbyBroken ( message ) {
        console.error( `PostgreSQL standby is broken (${ message }), exiting` );

        process.exit( 1 );
    }

    #onConnectionLost ( message ) {
        console.error( `PostgreSQL is not available (${ message }), exiting` );

        process.exit( 1 );
    }
}
