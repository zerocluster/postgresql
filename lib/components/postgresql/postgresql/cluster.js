import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import RandomValues from "#core/crypto/random-values";
import ejs from "#core/ejs";
import { glob, pathExists } from "#core/fs";
import sql from "#core/sql";
import LifecycleManager from "#core/threads/lifecycle-manager";
import { TmpDir, TmpFile } from "#core/tmp";
import { sleep } from "#core/utils";
import PostgresqlClusterMonitoring from "./cluster/monitoring.js";
import utils, { ROLE } from "./utils.js";

const DEFAULT_STDIO = "ignore", // "inherit",
    REPLAY_POLL_INTERVAL = 1000,
    REPLAY_STABLE_CHECKS = 3,
    REPLAY_STALL_TIMEOUT = 600_000,
    POSTGRESQL_PORT = 5432,
    LISTEN_ADDRESSES = "0.0.0.0",
    SLOT_DROP_ATTEMPTS = 10,
    SLOT_DROP_INTERVAL = 1000,
    STDERR_MAX_LENGTH = 4096,
    STDERR_STDIO = [ "ignore", DEFAULT_STDIO, "pipe" ];

export default class PostgresqlCluster {
    #postgresql;
    #app;
    #name;
    #version;
    #binDir;
    #clusterDir;
    #dataDir;
    #configPath;

    #autoConfigPath;
    #standbySignalPath;
    #defaultConfigPath;
    #userConfigPath;
    #replicationConfigPath;
    #recoverySignalPath;
    // eslint-disable-next-line no-unused-private-class-members
    #recoveryConfigPath;
    #backupLabelPath;
    #rewindMarkerPath;
    #recoveryMarkerPath;
    #roleFilePath;
    #slotId;
    #lifecycleManager;
    #monitoring;
    #status = "stopped";
    #busy = false;
    #role = null;
    #timeline = null;
    #lsn = null;
    #history = null;
    #oldCluster;
    #oldVersionInstalled = false;

    constructor ( postgresql, name, version ) {
        this.#postgresql = postgresql;
        this.#app = postgresql.app;
        this.#name = name;
        this.#version = version;

        this.#binDir = path.join( "/usr/lib/postgresql", String( this.#version ), "bin" );
        this.#clusterDir = path.join( this.#postgresql.dataDir, "clusters", this.#name );
        this.#dataDir = path.join( this.#clusterDir, String( this.#version ) );
        this.#configPath = path.join( this.#dataDir, "postgresql.conf" );
        this.#autoConfigPath = path.join( this.#dataDir, "postgresql.auto.conf" );
        this.#standbySignalPath = path.join( this.#dataDir, "standby.signal" );
        this.#defaultConfigPath = path.join( this.#dataDir, "conf.d/0-postgresql.conf" );
        this.#userConfigPath = path.join( this.#dataDir, "conf.d/10-user.conf" );
        this.#replicationConfigPath = path.join( this.#dataDir, "conf.d/20-replication.conf" );
        this.#recoverySignalPath = path.join( this.#dataDir, "recovery.signal" );
        this.#recoveryConfigPath = path.join( this.#dataDir, "conf.d/30-recovery.conf" );
        this.#backupLabelPath = path.join( this.#dataDir, "backup_label" );
        this.#rewindMarkerPath = path.join( this.#clusterDir, "rewind.in-progress" );
        this.#recoveryMarkerPath = path.join( this.#clusterDir, "recovery.in-progress" );

        // the file is shared by all versions of the cluster, so the role survives the upgrade
        this.#roleFilePath = path.join( this.#clusterDir, "role" );

        this.#lifecycleManager = new LifecycleManager( {
            "onStart": this.#start.bind( this ),
            "onStop": this.#stop.bind( this ),
            "onDestroyThreads": this.#stopClusterImmediate.bind( this ),
        } );

        this.#monitoring = new PostgresqlClusterMonitoring( this );

        process.once( "exit", () =>
            this.#spawnSync( `${ this.binDir }/pg_ctl`, [

                //
                "stop",
                `--pgdata=${ this.#dataDir }`,
                "--wait",
                "--mode=immediate",
            ] ) );
    }

    // properties
    get app () {
        return this.#postgresql.app;
    }

    get postgresql () {
        return this.#postgresql;
    }

    get config () {
        return this.#postgresql.config;
    }

    get name () {
        return this.#name;
    }

    get version () {
        return this.#version;
    }

    get binDir () {
        return this.#binDir;
    }

    get dataDir () {
        return this.#dataDir;
    }

    get autoConfigPath () {
        return this.#autoConfigPath;
    }

    get instanceId () {
        return this.#app.env.instanceId;
    }

    get slotId () {
        this.#slotId ??= this.#postgresql.app.env.instanceId.replaceAll( "-", "" );

        return this.#slotId;
    }

    get role () {
        return this.#role;
    }

    // public
    async start () {
        return this.#lifecycleManager.start();
    }

    async stop () {
        return this.#lifecycleManager.stop();
    }

    async forceStop () {
        return this.#lifecycleManager.forceStop();
    }

    async getStatus () {
        if ( !this.#lifecycleManager.canBeginActivity ) return result( [ 500, "PostgreSQL component is not started" ] );

        // the cluster, whose data dir is in use: the old cluster, if it is not upgraded yet
        const cluster = ( await this.#getOldCluster() ) ?? this;

        return result( 200, {
            "status": this.#status,
            "busy": this.#busy,
            "role": this.#role,
            "savedRole": await this.#readSavedRole(),
            "version": ( await cluster.#hasDataDir() )
                ? cluster.version
                : null,
            "timeline": this.#timeline,
            "lsn": this.#lsn,
            "history": this.#history,
            "standby": await cluster.#hasStandbySignal(),
        } );
    }

    async recoverCluster () {
        if ( !this.#lifecycleManager.canBeginActivity ) return result( [ 500, "PostgreSQL component is not started" ] );
        if ( this.#busy ) return result( [ 500, "Cluster is busy" ] );
        if ( this.#status !== "stopped" ) return result( [ 500, "Cluster is started" ] );

        this.#lifecycleManager.beginThread();

        this.#busy = true;
        this.#status = "recovering";

        let res;

        try {
            res = await this.#recoverCluster();
        }
        catch ( e ) {
            res = result( [ 500, e.message ] );
        }

        if ( res.ok ) {
            this.#log( `Cluster recovered, timeline: ${ res.data.timeline }, lsn: ${ res.data.lsn || "-" }` );
        }
        else {
            this.#log( `Unable to recover cluster: ${ res.statusText }` );
        }

        this.#status = "stopped";
        this.#busy = false;
        this.#role = null;

        if ( res.ok ) {
            this.#timeline = res.data.timeline;
            this.#lsn = res.data.lsn;
            this.#history = res.data.history;
        }
        else {
            this.#timeline = null;
            this.#lsn = null;
            this.#history = null;
        }

        const status = await this.getStatus();
        res.data = status.data;

        this.#lifecycleManager.endThread();

        return res;
    }

    async startCluster ( role, { replicationHostname } = {} ) {
        if ( !this.#lifecycleManager.canBeginActivity ) return result( [ 500, "PostgreSQL component is not started" ] );
        if ( this.#busy ) return result( [ 500, "Cluster is busy" ] );
        if ( this.#status !== "stopped" ) return result( [ 500, "Cluster is started" ] );

        this.#lifecycleManager.beginThread();

        this.#busy = true;
        this.#status = "starting";

        let res;

        try {
            if ( role === ROLE.PRIMARY ) {
                res = await this.#startPrimary();
            }
            else {
                res = await this.#startStandby( role, replicationHostname );
            }
        }
        catch ( e ) {
            res = result( [ 500, e.message ] );
        }

        this.#busy = false;
        this.#timeline = null;
        this.#lsn = null;
        this.#history = null;

        if ( res.ok ) {
            this.#status = "started";
            this.#role = role;

            // remember the role, it is kept after the stop, so the manager can find the former primary
            await this.#writeSavedRole( role );

            // start monitoring
            this.#monitoring.start();

            // register service-discovery
            this.app.cluster.serviceDiscovery.addService( `postgresql-${ this.#role }`, POSTGRESQL_PORT );

            // register nginx upstream proxy
            this.#registerNginx( this.#role );

            this.#log( `Service postgresql-${ this.#role } registered` );

            this.#log( `Cluster started as ${ role }` );
        }
        else {
            this.#status = "stopped";
            this.#role = null;

            this.#log( `Unable to start cluster as ${ role }: ${ res.statusText }` );
        }

        const status = await this.getStatus();
        res.data = status.data;

        this.#lifecycleManager.endThread();

        return res;
    }

    async stopCluster () {
        if ( !this.#lifecycleManager.canBeginActivity ) return result( [ 500, "PostgreSQL component is not started" ] );
        if ( this.#busy ) return result( [ 500, "Cluster is busy" ] );

        this.#lifecycleManager.beginThread();

        this.#busy = true;
        this.#status = "stopping";

        const res = await this.#stopClusterFast();

        if ( res.ok ) {
            this.#log( "Cluster stopped" );
        }
        else {
            this.#log( `Unable to stop cluster: ${ res.statusText }` );
        }

        // the role is null, if the cluster is not started, there is nothing to unregister
        if ( this.#role ) {

            // unregister service-discovery
            this.app.cluster.serviceDiscovery.deleteService( `postgresql-${ this.#role }`, POSTGRESQL_PORT );

            // unregister nginx upstream proxy
            this.#registerNginx( this.#role, { "deleteProxy": true } );
        }

        this.#busy = false;
        this.#status = "stopped";
        this.#role = null;
        this.#timeline = null;
        this.#lsn = null;
        this.#history = null;

        const status = await this.getStatus();
        res.data = status.data;

        this.#lifecycleManager.endThread();

        return res;
    }

    async deleteClusterOldVersions () {
        if ( !this.#lifecycleManager.canBeginActivity ) return result( [ 500, "PostgreSQL component is not started" ] );
        if ( this.#busy ) return result( [ 500, "Cluster is busy" ] );
        if ( this.#status !== "started" ) return result( [ 500, "Cluster is not started" ] );

        this.#lifecycleManager.beginThread();

        try {
            const versions = await glob( "*", {
                "cwd": this.#clusterDir,
                "directories": true,
                "files": false,
            } );

            const removedVersions = [];

            for ( let version of versions ) {
                version = Number( version );

                if ( !Number.isInteger( version ) ) continue;

                if ( version >= this.#version ) continue;

                await fs.promises.rm( `${ this.#clusterDir }/${ version }`, {
                    "recursive": true,
                } );

                removedVersions.push( version );
            }

            return result( 200, {
                removedVersions,
            } );
        }
        catch ( e ) {
            return result.fromError( e );
        }
        finally {
            this.#lifecycleManager.endThread();
        }
    }

    // private
    async #start ( signal ) {

        // init cluster dir
        await utils.mkdir( this.#clusterDir );

        // the markers are shared by all versions of the cluster, while the cluster is not upgraded, they belong to the old cluster
        const oldCluster = await this.#getOldCluster();

        if ( oldCluster ) {
            await oldCluster.#discardBrokenDataDir();
            await oldCluster.#discardTemporaryStandbySignal();
        }

        // standby.signal, created by the interrupted recovery, must not turn the primary into a standby
        await this.#discardTemporaryStandbySignal();

        return result( 200 );
    }

    async #stop ( signal ) {

        // stop cluster
        await this.#stopClusterFast();

        return result( 200 );
    }

    async #recoverCluster ( { signal } = {} ) {
        let res, timeline, needStop;

        await this.#discardBrokenDataDir();
        await this.#discardTemporaryStandbySignal();

        // cluster is not initialized
        if ( !( await this.#hasDataDir() ) ) {

            // cluster is not upgraded yet, the old cluster is recovered, so the manager can select the primary by its timeline and lsn
            // only the primary is upgraded, standbys are recreated from the base backup of the new primary
            const oldCluster = await this.#getOldCluster();

            if ( oldCluster ) {
                res = await this.#installOldVersion( oldCluster );
                if ( !res.ok ) return res;

                return oldCluster.#recoverCluster( { signal } );
            }

            this.#log( "Cluster is not initialized, there is nothing to recover" );

            return result( 200, {
                "timeline": 0,
                "lsn": "",
                "history": [],
            } );
        }

        const hasStandbySignal = await this.#hasStandbySignal();

        try {

            // update configs
            await this.#writeConfigs();

            // standby.signal is kept, otherwise standby will be recovered as a primary, and its wal will diverge from the primary wal
            await this.#deleteReplicationConfig( {
                "keepStandbySignal": true,
            } );

            // recovery.signal turns recovery into archive recovery and creates a new timeline
            await this.#deleteRecoverySignal();

            // former primary is recovered as a standby, standby.signal is temporary
            if ( !hasStandbySignal ) {
                await utils.writeFile( this.#recoveryMarkerPath, "" );

                await this.#writeStandbySignal();
            }

            needStop = true;

            // start recovery
            res = await this.#spawnPgCtl( "start", {
                "options": {
                    "listen_addresses": "",
                    "archive_mode": "off",
                    "archive_command": "/bin/true",
                    "primary_conninfo": "",
                    "primary_slot_name": "",
                    "restore_command": "",
                    "hot_standby": "on",
                    "wal_log_hints": "on",
                },
                signal,
            } );
            if ( !res.ok ) return res;

            // wait until all local wal is replayed
            res = await this.#waitReplay( { signal } );
            if ( !res.ok ) return res;

            const lsn = res.data.lsn;

            // stop cluster
            res = await this.#stopClusterFast();
            if ( !res.ok ) return res;

            needStop = false;

            // get timeline
            res = await this.#getControlData();
            if ( !res.ok ) return res;

            const controlData = res.data,
                state = controlData[ "Database cluster state" ];

            if ( state !== "shut down in recovery" ) return result( [ 500, `Unexpected cluster state: ${ state }` ] );

            // timeline of the last checkpoint can lag behind the replay timeline
            timeline = Math.max( Number( controlData[ "Latest checkpoint's TimeLineID" ] ), Number( controlData[ "Min recovery ending loc's timeline" ] || 0 ) );

            if ( !Number.isInteger( timeline ) || timeline < 1 ) return result( [ 500, `Invalid timeline: ${ timeline }` ] );

            // history is required to check, whether the timelines are descendants of each other
            res = await this.#readTimelineHistory( timeline );
            if ( !res.ok ) return res;

            return result( 200, {
                timeline,
                lsn,
                "history": res.data,
            } );
        }
        catch ( e ) {
            return result( [ 500, e.message ] );
        }
        finally {

            // server can stay running after an error or abort
            if ( needStop ) {
                await this.#stopClusterImmediate();
            }

            // remove temporary standby.signal
            await this.#discardTemporaryStandbySignal();
        }
    }

    async #startPrimary ( { signal } = {} ) {
        let res, needStop;

        try {
            await this.#discardBrokenDataDir();
            await this.#discardTemporaryStandbySignal();

            // init or upgrade cluster
            if ( !( await this.#hasDataDir() ) ) {
                const oldCluster = await this.#getOldCluster();

                res = oldCluster
                    ? await this.#upgradeCluster( oldCluster )
                    : await this.#initDatabase( { signal } );
                if ( !res.ok ) return res;
            }

            // standby.signal means, that the cluster is a standby and must be promoted
            const hasStandbySignal = await this.#hasStandbySignal();

            // write configs
            await this.#writeConfigs();
            await this.#writeReplicationConfig( ROLE.PRIMARY );

            // server can stay running after an error or abort
            needStop = true;

            // start server
            res = await this.#spawnPgCtl( "start", { signal } );
            if ( !res.ok ) return res;

            // promote standby
            if ( hasStandbySignal ) {
                res = await this.#spawnPgCtl( "promote", { signal } );
                if ( !res.ok ) return res;
            }

            // update replication role
            res = await this.#updateReplicationRole();
            if ( !res.ok ) return res;

            // pg_rewind on the old primary reads timeline from the control file, which is updated only by a checkpoint
            if ( hasStandbySignal ) {
                res = await this.#checkpoint();
                if ( !res.ok ) return res;
            }

            needStop = false;

            return result( 200 );
        }
        catch ( e ) {
            return result( [ 500, e.message ] );
        }
        finally {
            if ( needStop ) {
                await this.#stopClusterAfterFailure();
            }
        }
    }

    async #startStandby ( role, replicationHostname, { signal } = {} ) {
        if ( role !== ROLE.STANDBY_SYNCHRONOUS && role !== ROLE.STANDBY_ASYNCHRONOUS ) return result( [ 400, `Invalid standby role: ${ role }` ] );

        let res, needStop;

        try {
            await this.#discardBrokenDataDir();
            await this.#discardTemporaryStandbySignal();

            // rewind
            if ( await this.#hasDataDir() ) {

                // create replication slot, a slot, that is lost or invalidated, is recreated
                res = await this.#checkReplicationSlot( replicationHostname, { signal } );
                if ( !res.ok ) return res;

                res = await this.#rewindDataDir( replicationHostname, { signal } );

                // rewind failed
                if ( !res.ok ) {
                    if ( signal?.aborted ) return res;

                    this.#log( "Rewind failed, falling back to base backup" );

                    res = await this.#makeBaseBackup( replicationHostname, { signal } );
                    if ( !res.ok ) return res;
                }

                // rewind succeeded
                else {

                    // the slot protects only the wal since the moment of its creation, the wal, that the standby needs, can be already removed from the primary,
                    // in this case the standby never becomes consistent and the start would wait forever
                    res = await this.#checkRequiredWal( replicationHostname );
                    if ( !res.ok ) return res;

                    if ( !res.data.available ) {
                        this.#log( "WAL required by the standby is not available on the primary, falling back to base backup" );

                        res = await this.#makeBaseBackup( replicationHostname, { signal } );
                        if ( !res.ok ) return res;
                    }
                }
            }

            // make base backup
            else {
                res = await this.#makeBaseBackup( replicationHostname, { signal } );
                if ( !res.ok ) return res;
            }

            // write configs
            await this.#writeConfigs();
            await this.#writeReplicationConfig( role, {
                replicationHostname,
            } );

            // without standby.signal the server will be started as a primary
            if ( !( await this.#hasStandbySignal() ) ) return result( [ 500, "standby.signal is missing" ] );

            // server can stay running after an error or abort
            needStop = true;

            // start server
            res = await this.#spawnPgCtl( "start", { signal } );
            if ( !res.ok ) return res;

            needStop = false;

            return result( 200 );
        }
        catch ( e ) {
            return result( [ 500, e.message ] );
        }
        finally {
            if ( needStop ) {
                await this.#stopClusterAfterFailure();
            }
        }
    }

    async #installOldVersion ( oldCluster ) {
        if ( this.#oldVersionInstalled ) return result( 200 );

        let res;

        // apt update
        res = await this.#waitProcess( this.#spawn( "apt-get", [ "update" ], {
            "uid": false,
        } ) );
        if ( !res.ok ) return res;

        const args = [ "install", "--yes" ];

        for ( const template of this.config.packages ) {
            args.push( await ejs( template ).render( {
                "postgresqlVersion": oldCluster.version,
            } ) );
        }

        // apt install
        res = await this.#waitProcess( this.#spawn( "apt-get", args, {
            "uid": false,
        } ) );
        if ( !res.ok ) return res;

        this.#oldVersionInstalled = true;

        return result( 200 );
    }

    async #upgradeCluster ( oldCluster ) {
        let res;

        const tmpDir = new TmpDir();

        try {
            res = await this.#installOldVersion( oldCluster );
            if ( !res.ok ) return res;

            // pg_upgrade requires the old cluster to be shut down as a primary
            res = await oldCluster.#shutdownAsPrimary();
            if ( !res.ok ) return res;

            res = await this.#initDatabase( {
                "target": tmpDir.path,
            } );
            if ( !res.ok ) return res;

            // check
            res = await this.#waitProcess( this.#spawn(
                `${ this.binDir }/pg_upgrade`,
                [

                    //
                    "--check",
                    `--old-bindir=${ oldCluster.binDir }`,
                    `--new-bindir=${ this.binDir }`,
                    `--old-datadir=${ oldCluster.dataDir }`,
                    `--new-datadir=${ tmpDir.path }`,
                ],
                {
                    "cwd": tmpDir.path,
                    "stdio": "inherit",
                }
            ) );
            if ( !res.ok ) return res;

            // upgrade
            res = await this.#waitProcess( this.#spawn(
                `${ this.binDir }/pg_upgrade`,
                [

                    //
                    `--old-bindir=${ oldCluster.binDir }`,
                    `--new-bindir=${ this.binDir }`,
                    `--old-datadir=${ oldCluster.dataDir }`,
                    `--new-datadir=${ tmpDir.path }`,
                ],
                {
                    "cwd": tmpDir.path,
                    "stdio": "inherit",
                }
            ) );
            if ( !res.ok ) return res;

            // copy configs
            if ( await pathExists( oldCluster.autoConfigPath ) ) {
                await fs.promises.cp( oldCluster.autoConfigPath, path.join( tmpDir.path, path.basename( this.#autoConfigPath ) ) );
            }

            await fs.promises.rename( tmpDir.path, this.#dataDir );
        }
        finally {
            await tmpDir?.destroy();
        }

        return result( 200 );
    }

    async #shutdownAsPrimary () {
        let res, needStop;

        res = await this.#getControlData();
        if ( !res.ok ) return res;

        const state = res.data[ "Database cluster state" ];

        if ( state === "shut down" ) return result( 200 );

        this.#log( `Cluster ${ this.#version } state is "${ state }", shutting it down as a primary` );

        try {

            // without the signals the server replays the local wal, finishes the recovery and becomes a primary
            await this.#deleteStandbySignal();
            await this.#deleteRecoverySignal();

            needStop = true;

            res = await this.#spawnPgCtl( "start", {
                "options": {
                    "listen_addresses": "",
                    "archive_mode": "off",
                    "archive_command": "/bin/true",
                },
            } );
            if ( !res.ok ) return res;

            // clean shutdown
            res = await this.#stopClusterFast();
            if ( !res.ok ) return res;

            needStop = false;
        }
        catch ( e ) {
            return result( [ 500, e.message ] );
        }
        finally {

            // server can stay running after an error
            if ( needStop ) {
                await this.#stopClusterImmediate();
            }
        }

        // check the result
        res = await this.#getControlData();
        if ( !res.ok ) return res;

        if ( res.data[ "Database cluster state" ] !== "shut down" ) return result( [ 500, `Unexpected cluster state: ${ res.data[ "Database cluster state" ] }` ] );

        return result( 200 );
    }

    async #initDatabase ( { target, signal } = {} ) {
        target ||= this.#dataDir;

        const passwordFile = new TmpFile(),
            tmpDir = new TmpDir();

        try {
            const password = Buffer.from( RandomValues.default.getRandomArrayBuffer( 16 ) ).toBase64( { "alphabet": "base64url", "omitPadding": true } );

            await utils.writeFile( passwordFile.path, password );

            await utils.mkdir( tmpDir.path );

            const proc = this.#spawn(
                `${ this.binDir }/initdb`,
                [

                    //
                    "--username=postgres",
                    `--pwfile=${ passwordFile.path }`,
                    `--pgdata=${ tmpDir.path }`,
                    "--encoding=UTF8",
                    "--locale-provider=icu",
                    "--icu-locale=und",
                    "--lc-collate=C.UTF-8",
                    "--lc-ctype=C.UTF-8",
                ],
                {
                    signal,
                }
            );

            const res = this.#logResult( "initdb", await this.#waitProcess( proc ) );

            if ( res.ok ) {
                await fs.promises.rename( tmpDir.path, target );

                this.#log( "Data dir initialized" );
            }

            return res;
        }
        finally {
            await passwordFile.destroy();
            await tmpDir.destroy();
        }
    }

    async #rewindDataDir ( replicationHostname, { signal } = {} ) {

        // a failed or interrupted pg_rewind leaves the data dir in an unusable state, the marker is removed only after a successful rewind
        await utils.writeFile( this.#rewindMarkerPath, "" );

        const proc = this.#spawn(
            `${ this.#binDir }/pg_rewind`,
            [

                //
                `--target-pgdata=${ this.#dataDir }`,
                `--source-server=${ this.#getPrimaryConninfo( replicationHostname, { "withPassword": false } ) }`,
            ],
            {
                "stdio": STDERR_STDIO,
                "env": {
                    ...process.env,
                    "PGPASSWORD": this.config.replication.password,
                },
                signal,
            }
        );

        const res = this.#logResult( "pg_rewind", await this.#waitProcess( proc ) );
        if ( !res.ok ) return res;

        // pg_rewind copies configs from the source, remove replication settings of the source
        await this.#deleteReplicationConfig();

        // pg_rewind does not touch pg_replslot, slots of the former primary are meaningless for a standby and keep wal on it
        await this.#deleteLocalReplicationSlots();

        await fs.promises.rm( this.#rewindMarkerPath, { "force": true } );

        return res;
    }

    async #makeBaseBackup ( replicationHostname, { signal } = {} ) {
        let res;

        // delete replication slot
        res = await this.#checkReplicationSlot( replicationHostname, {
            "deleteSlot": true,
            signal,
        } );
        if ( !res.ok ) return res;

        const tmpDir = new TmpDir();

        try {
            await utils.mkdir( tmpDir.path );

            const proc = this.#spawn(
                `${ this.#binDir }/pg_basebackup`,
                [

                    //
                    `--host=${ replicationHostname }`,
                    `--port=${ POSTGRESQL_PORT }`,
                    `--pgdata=${ tmpDir.path }`,
                    `--username=${ this.config.replication.username }`,
                    "--no-password",
                    "--wal-method=stream",
                    "--checkpoint=fast",

                    "--create-slot",
                    `--slot=${ this.slotId }`,

                    // "--progress",
                    // "--verbose",
                ],
                {
                    "stdio": STDERR_STDIO,
                    "env": {
                        ...process.env,
                        "PGPASSWORD": this.config.replication.password,
                    },
                    signal,
                }
            );

            res = this.#logResult( "pg_basebackup", await this.#waitProcess( proc ) );

            if ( !res.ok ) {

                // the slot, created by pg_basebackup, can stay after a failure and keep wal on the primary, if the abort is requested, the slot is dropped by the next start
                if ( !signal?.aborted ) {
                    await this.#checkReplicationSlot( replicationHostname, { "deleteSlot": true } );
                }

                return res;
            }

            return await this.#replaceDataDir( tmpDir.path );
        }
        finally {
            await tmpDir.destroy();
        }
    }

    async #stopClusterAfterFailure () {
        const res = await this.#stopClusterFast();

        if ( !res.ok ) {
            this.#log( "Fast stop after failure failed, stopping immediately" );

            await this.#stopClusterImmediate();
        }
    }

    async #stopClusterFast () {
        return this.#stopCluster( "fast" );
    }

    async #stopClusterImmediate () {
        return this.#stopCluster( "immediate" );
    }

    async #stopCluster ( mode = "fast" ) {

        // stop monitoring
        await this.#monitoring.stop();

        return this.#spawnPgCtl( "stop", {
            mode,
        } );
    }

    async #getOldCluster () {
        if ( await this.#hasDataDir() ) return null;

        if ( !( await pathExists( path.join( this.#clusterDir, String( this.#version - 1 ) ) ) ) ) return null;

        this.#oldCluster ??= new PostgresqlCluster( this.#postgresql, this.#name, this.#version - 1 );

        return this.#oldCluster;
    }

    async #hasDataDir () {
        return pathExists( this.dataDir );
    }

    async #hasStandbySignal () {
        return pathExists( this.#standbySignalPath );
    }

    // the last role, that the cluster was successfully started with, null if unknown
    async #readSavedRole () {
        try {
            const role = ( await fs.promises.readFile( this.#roleFilePath, "utf8" ) ).trim();

            if ( role === ROLE.PRIMARY || role === ROLE.STANDBY_SYNCHRONOUS || role === ROLE.STANDBY_ASYNCHRONOUS ) return role;

            return null;
        }
        catch {
            return null;
        }
    }

    async #writeSavedRole ( role ) {
        try {
            await utils.writeFile( this.#roleFilePath, role );
        }
        catch ( e ) {
            this.#log( `Unable to save role: ${ e.message }` );
        }
    }

    async #discardTemporaryStandbySignal () {
        if ( !( await pathExists( this.#recoveryMarkerPath ) ) ) return;

        await this.#deleteStandbySignal();

        await fs.promises.rm( this.#recoveryMarkerPath, { "force": true } );
    }

    async #waitReplay ( { signal } = {} ) {
        const dbh = sql.new( "postgresql:" );

        try {
            let lastLsn,
                stableChecks = 0,
                lastProgress = Date.now();

            while ( !signal?.aborted ) {
                const res = await dbh.selectRow( sql`
SELECT
    pg_catalog.pg_last_wal_replay_lsn() AS lsn,
    pg_catalog.pg_is_in_recovery() AS in_recovery,
    ( SELECT count(*)::int FROM pg_catalog.pg_stat_activity WHERE backend_type = 'startup' ) AS startup_found,
    ( SELECT count(*)::int FROM pg_catalog.pg_stat_activity WHERE backend_type = 'startup' AND wait_event IN ( 'RecoveryWalStream', 'RecoveryRetrieveRetryInterval' ) ) AS startup_idle
` );
                if ( !res.ok ) return res;

                if ( !res.data?.in_recovery ) return result( [ 500, "Cluster is not in recovery" ] );

                // the state of the startup process is the only reliable sign, that all local wal is replayed, do not guess by the lsn
                if ( !res.data.startup_found ) return result( [ 500, "Startup process is not found in pg_stat_activity" ] );

                // startup process, that has replayed all local wal, waits for a new wal:
                // RecoveryWalStream - streaming recovery, RecoveryRetrieveRetryInterval - wal is not available from any source (no primary_conninfo and restore_command)
                const lsn = res.data.lsn,
                    idle = res.data.startup_idle > 0;

                if ( lsn !== lastLsn ) {
                    lastLsn = lsn;
                    lastProgress = Date.now();
                    stableChecks = 0;
                }
                else if ( idle ) {
                    stableChecks++;

                    // waiting for a new wal is not a stall
                    lastProgress = Date.now();

                    if ( stableChecks >= REPLAY_STABLE_CHECKS ) {

                        // do not replace the absence of a reliable lsn with a fake value
                        if ( !lsn ) return result( [ 500, "Replay lsn is not available" ] );

                        this.#log( `Local WAL replay finished, lsn: ${ lsn }` );

                        return result( 200, { lsn } );
                    }
                }
                else {
                    stableChecks = 0;
                }

                if ( Date.now() - lastProgress > REPLAY_STALL_TIMEOUT ) return result( [ 500, "WAL replay is stalled" ] );

                await sleep( REPLAY_POLL_INTERVAL );
            }

            return result( [ 500, "Aborted" ] );
        }
        finally {
            await dbh.forceDestroy();
        }
    }

    async #readTimelineHistory ( timeline ) {
        if ( timeline <= 1 ) return result( 200, [] );

        const historyPath = path.join( this.#dataDir, "pg_wal", `${ timeline.toString( 16 ).toUpperCase().padStart( 8, "0" ) }.history` );

        let content;

        try {
            content = await fs.promises.readFile( historyPath, "utf8" );
        }
        catch ( e ) {
            return result( [ 500, `Unable to read timeline history file: ${ e.message }` ] );
        }

        const history = [];

        for ( const line of content.split( "\n" ) ) {
            const trimmed = line.trim();

            if ( !trimmed || trimmed.startsWith( "#" ) ) continue;

            const [ ancestor, lsn ] = trimmed.split( /\s+/v, 2 );

            if ( !/^\d+$/v.test( ancestor ) || !/^[\da-f]+\/[\da-f]+$/iv.test( lsn ) ) return result( [ 500, `Invalid line in timeline history file: ${ trimmed }` ] );

            history.push( {
                "timeline": Number( ancestor ),
                "lsn": lsn.toUpperCase(),
            } );
        }

        // the history of the timeline must have at least one ancestor
        if ( !history.length ) return result( [ 500, "Timeline history file is empty" ] );

        return result( 200, history );
    }

    async #getControlData () {
        const proc = this.#spawn( `${ this.binDir }/pg_controldata`, [ this.#dataDir ], {
            "stdio": [ "ignore", "pipe", "ignore" ],
            "env": {
                ...process.env,
                "LC_ALL": "C",
            },
        } );

        let stdout = "";

        proc.stdout.setEncoding( "utf8" );

        proc.stdout.on( "data", data => {
            stdout += data;
        } );

        const res = await this.#waitProcess( proc );
        if ( !res.ok ) return res;

        const data = {};

        for ( const line of stdout.split( "\n" ) ) {
            const idx = line.indexOf( ":" );

            if ( idx === -1 ) continue;

            data[ line.slice( 0, idx ).trim() ] = line.slice( idx + 1 ).trim();
        }

        return result( 200, data );
    }

    async #updateReplicationRole () {
        const dbh = sql.new( "postgresql:" );

        try {
            const res = await dbh.exec( sql`
-- the role is required by standbys to connect, so the commit must not wait for synchronous standbys, which are not connected yet
SET synchronous_commit = local;

DO
$$
BEGIN
    IF NOT EXISTS ( SELECT FROM pg_catalog.pg_roles WHERE rolname = ${ this.config.replication.username } ) THEN
        CREATE ROLE ${ sql.id( this.config.replication.username ) } WITH REPLICATION LOGIN;
    END IF;
END
$$;

ALTER ROLE ${ sql.id( this.config.replication.username ) } WITH PASSWORD ${ this.config.replication.password };

-- pg_rewind permissions
GRANT EXECUTE ON function pg_catalog.pg_ls_dir ( text, boolean, boolean ) TO ${ sql.id( this.config.replication.username ) };
GRANT EXECUTE ON function pg_catalog.pg_stat_file ( text, boolean ) TO ${ sql.id( this.config.replication.username ) };
GRANT EXECUTE ON function pg_catalog.pg_read_binary_file ( text ) TO ${ sql.id( this.config.replication.username ) };
GRANT EXECUTE ON function pg_catalog.pg_read_binary_file ( text, bigint, bigint, boolean ) TO ${ sql.id( this.config.replication.username ) };
` );

            return this.#logResult( "Replication role updated", res );
        }
        finally {
            await dbh.forceDestroy();
        }
    }

    async #checkpoint () {
        const dbh = sql.new( "postgresql:" );

        try {

            // CHECKPOINT can not be executed inside of a transaction block, so it must be a separate query
            const res = await dbh.exec( sql`CHECKPOINT` );

            return this.#logResult( "Checkpoint", res );
        }
        finally {
            await dbh.forceDestroy();
        }
    }

    async #replaceDataDir ( newDataDirPath ) {
        let dataDirBackup, restore;

        try {

            // create data dir backup
            if ( await this.#hasDataDir() ) {
                dataDirBackup = new TmpDir();

                await fs.promises.rename( this.dataDir, dataDirBackup.path );

                this.#log( "Current data dir moved to backup" );

                restore = true;
            }

            // move base backup to data dir
            await fs.promises.rename( newDataDirPath, this.dataDir );

            this.#log( "New data dir moved in place" );
        }
        catch ( e ) {

            // restore data dir backup
            if ( restore ) {
                try {
                    await fs.promises.rename( dataDirBackup.path, this.dataDir );

                    this.#log( "Data dir backup restored" );
                }
                catch ( e_ ) {
                    return result( [ 500, `${ e.message }. Unable to restore data dir backup: ${ e_.message }` ] );
                }
            }

            this.#log( `Unable to replace data dir: ${ e.message }` );

            return result( [ 500, e.message ] );
        }

        // new data dir is in place, the marker is obsolete
        await fs.promises.rm( this.#rewindMarkerPath, { "force": true } );

        // remove data dir backup, failure is not critical
        if ( dataDirBackup ) {
            try {
                await dataDirBackup.destroy();
            }
            catch ( e ) {
                this.#log( `Unable to remove data dir backup: ${ e.message }` );
            }
        }

        return result( 200 );
    }

    async #discardBrokenDataDir () {
        if ( !( await pathExists( this.#rewindMarkerPath ) ) ) return;

        // the marker is removed last, so the operation can be safely repeated
        await fs.promises.rm( this.dataDir, {
            "recursive": true,
            "force": true,
        } );

        await fs.promises.rm( this.#rewindMarkerPath, { "force": true } );

        this.#log( "Broken data dir discarded" );
    }

    #createReplicationDbh ( replicationHostname ) {
        return sql.new( "postgresql:", {
            "username": this.config.replication.username,
            "password": this.config.replication.password,
            "hostname": replicationHostname,
            "port": POSTGRESQL_PORT,
            "database": "postgres",
        } );
    }

    async #checkReplicationSlot ( replicationHostname, { deleteSlot, signal } = {} ) {
        let res;

        const dbh = this.#createReplicationDbh( replicationHostname );

        try {

            // get replication slot
            res = await dbh.selectRow( sql`SELECT * FROM pg_replication_slots WHERE slot_name = ?`, [ this.slotId ] );
            if ( !res.ok ) return res;

            const slot = res.data;

            this.#log( `Replication slot ${ this.slotId } on ${ replicationHostname }: ${ slot
                ? "exists"
                : "not found" }` );

            // delete replication slot
            if ( deleteSlot ) {
                if ( slot ) {
                    res = await this.#dropReplicationSlot( dbh, { signal } );
                    if ( !res.ok ) return res;
                }

                return result( 200 );
            }

            // replication slot exists
            if ( slot ) {
                const invalidReason = this.#getInvalidSlotReason( slot );

                // the slot is valid
                if ( !invalidReason ) return result( 200 );

                this.#log( `Replication slot ${ this.slotId } is not usable (${ invalidReason }), recreating` );

                res = await this.#dropReplicationSlot( dbh, { signal } );
                if ( !res.ok ) return res;
            }

            // create replication slot
            res = await dbh.selectRow( sql`SELECT pg_create_physical_replication_slot( ?, true )`, [ this.slotId ] );
            if ( !res.ok ) return res;

            this.#log( `Replication slot ${ this.slotId } created` );

            return result( 200 );
        }
        finally {
            await dbh.forceDestroy();
        }
    }

    #getInvalidSlotReason ( slot ) {

        // PostgreSQL 17+, for example "idle_timeout" (idle_replication_slot_timeout, PostgreSQL 18+) or "wal_removed"
        if ( slot.invalidation_reason ) return slot.invalidation_reason;

        // PostgreSQL 13+, the wal required by the slot is removed
        if ( slot.wal_status === "lost" ) return "wal_removed";

        // the slot does not reserve wal
        if ( !slot.restart_lsn ) return "restart_lsn is not set";

        return null;
    }

    async #dropReplicationSlot ( dbh, { signal } = {} ) {
        let res;

        for ( let attempt = 0; attempt < SLOT_DROP_ATTEMPTS; attempt++ ) {
            res = await dbh.selectRow( sql`SELECT pg_drop_replication_slot( ? )`, [ this.slotId ] );

            if ( res.ok || signal?.aborted ) break;

            this.#log( `Unable to drop replication slot ${ this.slotId } (attempt ${ attempt + 1 } of ${ SLOT_DROP_ATTEMPTS }): ${ res.statusText }` );

            await sleep( SLOT_DROP_INTERVAL );
        }

        if ( res.ok ) this.#log( `Replication slot ${ this.slotId } dropped` );

        return res;
    }

    async #deleteLocalReplicationSlots () {
        const slotsDir = path.join( this.#dataDir, "pg_replslot" );

        try {
            const entries = await fs.promises.readdir( slotsDir );

            for ( const entry of entries ) {
                await fs.promises.rm( path.join( slotsDir, entry ), {
                    "recursive": true,
                    "force": true,
                } );
            }

            if ( entries.length ) this.#log( `Local replication slots deleted: ${ entries.length }` );
        }
        catch ( e ) {
            if ( e.code === "ENOENT" ) return;

            this.#log( `Unable to delete local replication slots: ${ e.message }` );
        }
    }

    async #checkRequiredWal ( replicationHostname ) {
        let res;

        res = await this.#getRequiredWalSuffix();
        if ( !res.ok ) return res;

        const requiredSuffix = res.data;

        // the required position is unknown, the check is impossible
        if ( !requiredSuffix ) {
            this.#log( "Required WAL position is unknown, availability of WAL on the primary is not checked" );

            return result( 200, { "available": true } );
        }

        const dbh = this.#createReplicationDbh( replicationHostname );

        try {

            // pg_ls_dir is granted to the replication role for pg_rewind
            res = await dbh.selectRow( sql`
SELECT min( substr( t.name, 9 ) ) AS oldest
FROM pg_catalog.pg_ls_dir( 'pg_wal', false, false ) AS t ( name )
WHERE t.name ~ '^[0-9A-F]{24}$'
` );
            if ( !res.ok ) return res;

            const oldestSuffix = res.data?.oldest;

            if ( !oldestSuffix ) return result( [ 500, "Unable to get the oldest WAL segment of the primary" ] );

            const available = oldestSuffix <= requiredSuffix;

            this.#log( `Required WAL segment ${ requiredSuffix }, the oldest on the primary ${ oldestSuffix }: ${ available
                ? "available"
                : "removed" }` );

            return result( 200, { available } );
        }
        finally {
            await dbh.forceDestroy();
        }
    }

    async #getRequiredWalSuffix () {
        let label;

        // pg_rewind writes backup_label, if the rewind was required, the recovery starts from the checkpoint before the divergence point
        try {
            label = await fs.promises.readFile( this.#backupLabelPath, "utf8" );
        }
        catch ( e ) {
            if ( e.code !== "ENOENT" ) return result( [ 500, e.message ] );
        }

        if ( label != null ) {
            const match = label.match( /^START WAL LOCATION: \S+ \(file ([\dA-F]{24})\)$/mv );

            if ( !match ) return result( [ 500, "Unable to parse backup_label" ] );

            return result( 200, match[ 1 ].slice( 8 ) );
        }

        // the rewind was not required, the standby continues from the end of its local wal, known from the last recovery
        if ( !this.#lsn ) return result( 200, null );

        const res = await this.#getControlData();
        if ( !res.ok ) return res;

        const segmentSize = BigInt( res.data[ "Bytes per WAL segment" ] ),
            [ high, low ] = this.#lsn.split( "/", 2 ),
            segmentNumber = ( ( BigInt( `0x${ high }` ) << 32n ) | BigInt( `0x${ low }` ) ) / segmentSize,
            segmentsPerLog = 0x1_0000_0000n / segmentSize;

        return result( 200, [ segmentNumber / segmentsPerLog, segmentNumber % segmentsPerLog ].map( value => value.toString( 16 ).toUpperCase().padStart( 8, "0" ) ).join( "" ) );
    }

    async #writeConfigs () {
        await this.#writeHbaConfig();

        await this.#writeUserConfig();
    }

    async #writeHbaConfig () {
        const config = [];

        // generate pg_hba.conf
        for ( const access of this.config.access ) {
            const line = [];

            for ( const name of [ "host", "database", "user", "address", "auth-method", "auth-options" ] ) {
                if ( !access[ name ] ) continue;

                line.push( access[ name ] );
            }

            config.push( line.join( " " ) );
        }

        await utils.writeFile( path.join( this.dataDir, "pg_hba.conf" ), config.join( "\n" ) + "\n" );
    }

    async #writeUserConfig () {
        await this.#initConfigDir();

        // generate user config
        return utils.writeConfig( this.#userConfigPath, this.config.settings );
    }

    async #writeReplicationConfig ( role, { replicationHostname } = {} ) {
        await this.#initConfigDir();

        await this.#deleteReplicationConfig( {
            "keepStandbySignal": true,
        } );

        let config;

        let unixSocketDirectories = [ this.postgresql.unixSocketDir ];
        if ( this.config[ role ].publishUnixSocket ) {
            unixSocketDirectories.push( this.postgresql.publicUnixSocketDir );
        }
        unixSocketDirectories = unixSocketDirectories.join( ", " );

        // primary
        if ( role === ROLE.PRIMARY ) {
            config = {
                "unix_socket_directories": unixSocketDirectories,
                "listen_addresses": LISTEN_ADDRESSES,
                "wal_level": "replica",
                "wal_log_hints": "on",
            };

            // if ( this.config.backup.enabled ) {
            //     config.summarize_wal = true;

            //     // XXX incremental_timeout * 2
            //     // minutes, 10 days
            //     // config.wal_summary_keep_time = 14_400

            //     // // PITR
            //     if ( this.config.backup.pitrEnabled ) {

            //         // config.archive_mode = true;
            //         // config.archive_command = `gzip -9 -c %p > ${ this.backup.walsDir }/%f.gz`;
            //     }
            // }

            const numberOfSynchronousStandbys = this.config.replication.numberOfSynchronousStandbys;

            if ( numberOfSynchronousStandbys ) {
                config.synchronous_standby_names = `${ numberOfSynchronousStandbys } ( "${ ROLE.STANDBY_SYNCHRONOUS }" )`;
            }
        }

        // synchronous standby
        else if ( role === ROLE.STANDBY_SYNCHRONOUS ) {
            config = {
                "unix_socket_directories": unixSocketDirectories,
                "listen_addresses": LISTEN_ADDRESSES,
                "primary_conninfo": this.#getPrimaryConninfo( replicationHostname, {
                    "applicationName": ROLE.STANDBY_SYNCHRONOUS,
                } ),
                "primary_slot_name": this.slotId,
                "recovery_target_timeline": "latest",
                "hot_standby": true,
                "wal_log_hints": "on",
            };
        }

        // asynchronous standby
        else if ( role === ROLE.STANDBY_ASYNCHRONOUS ) {
            config = {
                "unix_socket_directories": unixSocketDirectories,
                "listen_addresses": LISTEN_ADDRESSES,
                "primary_conninfo": this.#getPrimaryConninfo( replicationHostname, {
                    "applicationName": ROLE.STANDBY_ASYNCHRONOUS,
                } ),
                "primary_slot_name": this.slotId,
                "recovery_target_timeline": "latest",
                "hot_standby": true,
                "wal_log_hints": "on",
            };
        }

        await utils.writeConfig( this.#replicationConfigPath, config );

        // standby.signal is required for standby roles, otherwise the server will be started as a primary
        if ( role !== ROLE.PRIMARY ) {
            await this.#writeStandbySignal();
        }
    }

    #getPrimaryConninfo ( replicationHostname, { applicationName, withPassword = true } = {} ) {
        return utils.buildConninfo( {
            "host": replicationHostname,
            "port": POSTGRESQL_PORT,
            "user": this.config.replication.username,
            "password": withPassword
                ? this.config.replication.password
                : undefined,
            "dbname": "postgres",
            "application_name": applicationName,
        } );
    }

    async #initConfigDir () {

        // create "conf.d" dir
        if ( !( await pathExists( path.join( this.dataDir, "conf.d" ) ) ) ) {
            await fs.promises.mkdir( path.join( this.dataDir, "conf.d" ), { "recursive": true } );
            await utils.chmodDir( path.join( this.dataDir, "conf.d" ) );

            // move postgresql config
            await fs.promises.rename( this.#configPath, this.#defaultConfigPath );
            await utils.chmodFile( this.#defaultConfigPath );

            // rewrite postgresql config
            await utils.writeFile( this.#configPath, "include_dir = 'conf.d'\n" );
        }
    }

    async #writeStandbySignal () {
        return utils.writeFile( this.#standbySignalPath, "" );
    }

    async #deleteReplicationConfig ( { keepStandbySignal } = {} ) {

        // remove replication config
        await fs.promises.rm( this.#replicationConfigPath, { "force": true } );

        // remove standby.signal
        if ( !keepStandbySignal ) {
            await this.#deleteStandbySignal();
        }

        // remove replication auto config
        // if ( await pathExists( this.#autoConfigPath ) ) {
        //     const config = ( await fs.promises.readFile( this.#autoConfigPath, "utf8" ) )
        //         .split( "\n" )
        //         .map( line => line.trim() )
        //         .filter( line => {
        //             if ( line.startsWith( "primary_conninfo" ) ) return false;

        //             if ( line.startsWith( "primary_slot_name" ) ) return false;

        //             return true;
        //         } )
        //         .join( "\n" );

        //     await utils.writeFile( this.#autoConfigPath, config );
        // }
    }

    async #deleteStandbySignal () {
        return fs.promises.rm( this.#standbySignalPath, { "force": true } );
    }

    async #deleteRecoverySignal () {
        return fs.promises.rm( this.#recoverySignalPath, { "force": true } );
    }

    #registerNginx ( role, { deleteProxy } = {} ) {
        const serviceName = "postgresql-" + role;

        if ( this.config[ role ].nginx.enabled && this.app.nginxUpstream ) {
            if ( deleteProxy ) {
                this.app.nginxUpstream.deleteProxy( serviceName );
            }
            else {
                const servers = [
                    {
                        "port": this.config[ role ].nginx.port,
                        "type": "tcp",
                        "useSsl": true,
                    },
                ];

                if ( this.config[ role ].nginx.defaultServer ) {
                    servers.push( {
                        "port": this.config[ role ].nginx.port,
                        "type": "tcp",
                        "useSsl": false,
                    } );
                }

                this.app.nginxUpstream.addProxy( serviceName, {
                    "upstreamPort": POSTGRESQL_PORT,
                    "serverNames": this.config[ role ].nginx.serverNames,
                    servers,
                } );
            }
        }
    }

    async #spawnPgCtl ( command, { wait = true, timeout = 86_400, mode, options, stdio = DEFAULT_STDIO, signal } = {} ) {
        const args = [ command, `--pgdata=${ this.#dataDir }` ];

        if ( wait ) args.push( "--wait" );

        if ( timeout ) args.push( `--timeout=${ timeout }` );

        if ( mode ) args.push( `--mode=${ mode }` );

        if ( options != null ) {
            const serverOptions = [];

            for ( const [ key, value ] of Object.entries( options ) ) {
                serverOptions.push( "-c", "'" + `${ key }=${ value }`.replaceAll( "'", "'\\''" ) + "'" );
            }

            if ( serverOptions.length ) args.push( `--options=${ serverOptions.join( " " ) }` );
        }

        const proc = this.#spawn( `${ this.binDir }/pg_ctl`, args, {
            stdio,
            signal,
        } );

        const res = await this.#waitProcess( proc );

        return this.#logResult( `pg_ctl ${ command }${ mode
            ? ` (${ mode })`
            : "" }`, res );
    }

    #spawn ( command, args, { cwd, stdio = DEFAULT_STDIO, env, uid = true, signal } = {} ) {
        const options = {
            cwd,
            stdio,
            env,
            signal,
            "detached": true,
        };

        if ( uid ) {
            options.uid = utils.uid;
            options.gid = utils.gid;
        }

        return childProcess.spawn( command, args, options );
    }

    #spawnSync ( command, args, { cwd, stdio = DEFAULT_STDIO, env, uid = true } = {} ) {
        const options = {
            cwd,
            stdio,
            env,
        };

        if ( uid ) {
            options.uid = utils.uid;
            options.gid = utils.gid;
        }

        const res = childProcess.spawnSync( command, args, options );

        if ( res.error || res.status !== 0 ) {
            this.#log( `${ command } ${ args[ 0 ] }: failed` );

            return result( 500 );
        }
        else {
            this.#log( `${ command } ${ args[ 0 ] }: ok` );

            return result( 200 );
        }
    }

    async #waitProcess ( proc ) {
        return new Promise( resolve => {
            let stderr = "";

            // collect the tail of stderr, if it is piped
            if ( proc.stderr ) {
                proc.stderr.setEncoding( "utf8" );

                proc.stderr.on( "data", data => {
                    stderr = ( stderr + data ).slice( -STDERR_MAX_LENGTH );
                } );
            }

            proc.once( "error", e => resolve( result( [ 500, e.message ] ) ) );

            proc.once( "close", code => resolve( code === 0
                ? result( 200 )
                : result( [ 500, stderr.trim() || `Process exited with code ${ code }` ] ) ) );
        } );
    }

    #log ( message ) {
        console.log( `[postgresql] ${ message }` );
    }

    #logResult ( operation, res ) {
        if ( res.ok ) {
            this.#log( `${ operation }: ok` );
        }
        else {
            this.#log( `${ operation }: failed, ${ res.statusText }` );
        }

        return res;
    }
}
