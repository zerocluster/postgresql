import Events from "#core/events";
import Cron from "#lib/cron";
import fs from "node:fs";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import sql from "#core/sql";
import Signal from "#core/threads/signal";
import uuidV4 from "#core/uuid";

// https://www.postgresql.org/docs/current/server-shutdown.html

export default class Pgsql extends Events {
    #app;
    #config;
    #level;
    #id;
    #dataRoot;
    #name;

    #proc;
    #cron;
    #isStarted;
    #shutdownSignal = new Signal();

    #dataDir;
    #backupDir;
    #unixSocketDirectories;
    #uid;
    #gid;

    constructor ( app, config, level, id ) {
        super();

        this.#app = app;
        this.#config = config;
        this.#level = level || 0;
        this.#id = id;
        this.#dataRoot = "/var/lib/docker/volumes/pgsql/_data";
    }

    // properties
    get app () {
        return this.#app;
    }

    get config () {
        return this.#config;
    }

    get level () {
        return this.#level;
    }

    get id () {
        return this.#id;
    }

    get name () {
        if ( this.#name === undefined ) {
            if ( !this.level || !this.id ) {
                this.#name = null;
            }
            else if ( this.level === 1 ) {
                return "s_1_" + this.id;
            }
            else {
                return "s_2_" + this.id;
            }
        }

        return this.#name;
    }

    get isPrimary () {
        return !this.#level;
    }

    get isStarted () {
        return this.#isStarted;
    }

    get cron () {
        return this.#cron;
    }

    get maxNumberOfSyncStanbdbuys () {
        if ( !this.leval ) {
            return this.config.replication?.level1?.maxNumberOfSyncStanbdbuys;
        }
        else if ( this.leval === 1 ) {
            return this.config.replication?.level2?.maxNumberOfSyncStanbdbuys;
        }
        else {
            return null;
        }
    }

    get syncStanbdbuyNames () {
        const names = [];

        if ( this.maxNumberOfSyncStanbdbuys ) {
            const level = this.level + 1;

            for ( let n = 0; n < this.maxNumberOfSyncStanbdbuys; n++ ) {
                names.push( "s_" + level + "_" + n );
            }
        }

        return names;
    }

    // public
    async run () {
        const res = this.#init();
        if ( !res.ok ) return res;

        if ( this.#isStarted ) return result( 200 );
        this.#isStarted = true;

        // init primary
        if ( this.isPrimary ) {
            await this.#initPrimary();
        }

        // ini standby
        else {
            await this.#initStandby();
        }

        // run server
        this.#proc = childProcess.spawn( "postgres", ["-D", this.#dataDir, "-k", this.#unixSocketDirectories, "-h", "0.0.0.0"], {
            "uid": this.#uid,
            "gid": this.#gid,
            "stdio": "inherit",
            "detached": true,
        } );

        this.#proc.on( "exit", this.#onProcExit.bind( this ) );

        // run cron
        if ( this.isPrimary ) {
            this.#cron = new Cron();
            await this.#cron.start();
        }

        console.log( `PostgreSQL process started` );

        return result( 200 );
    }

    async smartShutDown () {
        if ( !this.#isStarted ) return;

        console.log( "PostgreSQL smart shutting down" );

        this.#proc.kill( "SIGTERM" );

        return this.#shutdownSignal.wait();
    }

    async fastShutDown () {
        if ( !this.#isStarted ) return;

        console.log( "PostgreSQL fast shutting down" );

        this.#proc.kill( "SIGINT" );

        return this.#shutdownSignal.wait();
    }

    async immediateShutDown () {
        if ( !this.#isStarted ) return;

        console.log( "PostgreSQL immediate shutting down started" );

        this.#proc.kill( "SIGQUIT" );

        return this.#shutdownSignal.wait();
    }

    // private
    #init () {
        if ( this.level === 1 ) {
            if ( this.id != null && this.id >= this.config.replication.level1.maxNumberOfSyncStanbdbuys ) {
                return result( [400, `Standby id for level 1 is not valid`] );
            }
        }
        else if ( this.level === 2 ) {
            if ( this.id != null && this.id >= this.config.replication.level2.maxNumberOfSyncStanbdbuys ) {
                return result( [400, `Standby id for level 2 is not valid`] );
            }
        }

        this.#dataDir = this.#dataRoot + "/" + process.env.POSTGRES_VERSION;
        this.#unixSocketDirectories = "/var/run/postgresql";
        this.#backupDir = this.#dataRoot + "/backup";

        this.#uid = +childProcess.execFileSync( "id", ["-u", "postgres"], { "encoding": "utf8" } ).trim();
        this.#gid = +childProcess.execFileSync( "id", ["-g", "postgres"], { "encoding": "utf8" } ).trim();

        fs.mkdirSync( this.#dataRoot, { "recursive": true } );
        fs.chownSync( this.#dataRoot, this.#uid, this.#gid );
        fs.chmodSync( this.#dataRoot, 0o700 );

        fs.mkdirSync( this.#dataDir, { "recursive": true } );
        fs.chownSync( this.#dataDir, this.#uid, this.#gid );
        fs.chmodSync( this.#dataDir, 0o700 );

        // create and prepare unix socket dir
        if ( !fs.existsSync( this.#unixSocketDirectories ) ) {
            fs.mkdirSync( this.#unixSocketDirectories, { "recursive": true } );
        }
        fs.chownSync( this.#unixSocketDirectories, this.#uid, this.#gid );

        return result( 200 );
    }

    async #initPrimary () {
        fs.rmSync( this.#dataDir + "/standby.signal", { "force": true } );

        // init db
        if ( !fs.existsSync( this.#dataDir + "/PG_VERSION" ) ) {
            const pwfile = "/tmp/pgsql-password.txt";

            const superuserPassword = crypto.randomBytes( 16 ).toString( "base64url" );

            console.log( `GENERATED POSTGRES PASSWORD: ${superuserPassword}` );

            fs.rmSync( pwfile, { "force": true } );
            fs.writeFileSync( pwfile, superuserPassword );
            fs.chownSync( pwfile, this.#uid, this.#gid );

            childProcess.execFileSync( "initdb", ["--encoding", "UTF8", "--no-locale", "-U", "postgres", "--pwfile", pwfile, "-D", this.#dataDir], { "uid": this.#uid, "gid": this.#gid } );

            fs.rmSync( pwfile, { "force": true } );
        }

        // write hba config
        this.#writeHbaConfig();

        // write postgres config
        this.#writePostgresConfig();

        this.#writeReplicationsConfig( true );

        // update extensions
        await this.#updatePrimary();

        this.#writeReplicationsConfig();
    }

    async #initStandby () {

        // base backup
        if ( !fs.existsSync( this.#dataDir + "/PG_VERSION" ) ) {
            let hostname;

            if ( this.level === 1 ) {
                hostname = this.config.replication.primary.hostname;
            }
            else if ( this.level === 2 ) {
                hostname = this.config.replication.level1.hostname;
            }

            childProcess.execFileSync(
                "pg_basebackup",
                [

                    //
                    "--host=" + hostname,
                    "--pgdata=" + this.#dataDir,
                    "--username=" + this.#config.replication.username,
                    "--progress",
                    "--verbose",
                    "--write-recovery-conf",
                    "--wal-method=stream",
                    "--create-slot",
                    "--slot=" + uuidV4().replaceAll( "-", "_" ),
                    "--no-password",
                ],
                {
                    "encoding": "utf8",
                    "uid": this.#uid,
                    "gid": this.#gid,
                    "env": {
                        "PGPASSWORD": this.#config.replication.password,
                    },
                }
            );
        }

        // write hba config
        this.#writeHbaConfig();

        // write postgres config
        this.#writePostgresConfig();

        fs.writeFileSync( this.#dataDir + "/standby.signal", "" );

        this.#writeReplicationsConfig();
    }

    async #updatePrimary () {
        const proc = childProcess.spawn( "postgres", ["-D", this.#dataDir, "-k", this.#unixSocketDirectories], {
            "uid": this.#uid,
            "gid": this.#gid,
            "stdio": "inherit",
            "detached": true,
        } );

        // wait for server is ready
        while ( 1 ) {
            const res = childProcess.spawnSync( "pg_isready", null, { "stdio": "inherit" } );

            if ( !res.status ) break;

            await new Promise( resolve => setTimeout( resolve, 1000 ) );
        }

        const dbh = await sql.new( "pgsql://postgres@unix/var/run/postgresql/.s.PGSQL.5432" );

        const res = await dbh.exec( sql`
CREATE EXTENSION IF NOT EXISTS softvisio_admin CASCADE;
ALTER EXTENSION softvisio_admin UPDATE;
CALL update_extensions();

-- replication role
DROP ROLE IF EXISTS`.ID( this.#config.replication.username ).sql`;
CREATE ROLE`.ID( this.#config.replication.username ).sql`WITH REPLICATION LOGIN;
ALTER ROLE`.ID( this.#config.replication.username ).sql`WITH PASSWORD ${this.#config.replication.password};
` );

        console.log( `Updating extensions ... ${res}` );

        return new Promise( resolve => {
            proc.on( "exit", resolve );

            proc.kill( "SIGINT" );
        } );
    }

    #writeHbaConfig () {
        const config = [];

        // generate pg_hba.conf
        if ( this.#config.access ) {
            for ( const access of this.#config.access ) {
                const line = [];

                for ( const name of ["host", "database", "user", "address", "auth-method", "auth-options"] ) {
                    if ( !access[name] ) continue;

                    line.push( access[name] );
                }

                config.push( line.join( " " ) );
            }
        }

        fs.writeFileSync( this.#dataDir + "/pg_hba.conf", config.join( "\n" ) );

        fs.chownSync( this.#dataDir + "/pg_hba.conf", this.#uid, this.#gid );
    }

    #writePostgresConfig () {

        // create "conf.d" dir
        if ( !fs.existsSync( this.#dataDir + "/conf.d" ) ) {
            fs.mkdirSync( this.#dataDir + "/conf.d", { "recursive": true } );
            fs.chownSync( this.#dataDir + "/conf.d", this.#uid, this.#gid );

            // move "postgresql.conf"
            fs.copyFileSync( this.#dataDir + "/postgresql.conf", this.#dataDir + "/conf.d/0-postgresql.conf" );
            fs.chownSync( this.#dataDir + "/conf.d/0-postgresql.conf", this.#uid, this.#gid );

            fs.writeFileSync( this.#dataDir + "/postgresql.conf", "include_dir = 'conf.d'" );
            fs.chownSync( this.#dataDir + "/postgresql.conf", this.#uid, this.#gid );
        }

        // generate default settings
        const settings = [];

        const config = this.config.settings;

        for ( const name in config ) {
            const value = config[name];

            if ( value == null ) {
                continue;
            }
            else if ( typeof value === "string" ) {
                settings.push( `${name} = '${value}'` );
            }
            else {
                settings.push( `${name} = ${value}` );
            }
        }

        fs.writeFileSync( this.#dataDir + "/conf.d/1-init.conf", settings.join( "\n" ) );
        fs.chownSync( this.#dataDir + "/conf.d/1-init.conf", this.#uid, this.#gid );
    }

    #writeReplicationsConfig ( clear ) {
        var replicationConfig = "";

        if ( !clear ) {
            if ( this.maxNumberOfSyncStanbdbuys ) {
                replicationConfig += `synchronous_standby_names = 'FIRST ${this.maxNumberOfSyncStanbdbuys} ( ${this.syncStanbdbuyNames.join( ", " )} )'`;
            }

            if ( this.name ) {
                replicationConfig += `cluster_name = '${this.name}'`;
            }
        }

        fs.writeFileSync( this.#dataDir + "/conf.d/2-replication.conf", replicationConfig );
        fs.chownSync( this.#dataDir + "/conf.d/2-replication.conf", this.#uid, this.#gid );
    }

    // XXX make backup on sync standby
    // XXX write lock before
    async #backup () {
        if ( !this.isPrimary || !this.#config.backup.cron || !this.#config.backup.numnerOfBackups ) return;

        fs.mkdirSync( this.#backupDir, { "recursive": true } );
        fs.chownSync( this.#backupDir, this.#uid, this.#gid );
        fs.chmodSync( this.#backupDir, 0o700 );

        const backupId = new Date().toISOString();

        childProcess.execFileSync(
            "pg_basebackup",
            [

                //
                "--label=" + backupId,
                "--pgdata=" + this.#backupDir + "/" + backupId,
                "--format=tar",
                "--gzip",
                "--progress",
                "--verbose",
                "--username=" + this.#config.replication.username,
            ],
            {
                "encoding": "utf8",
                "uid": this.#uid,
                "gid": this.#gid,
            }
        );
    }

    #onProcExit ( code, signal ) {
        this.#proc = null;
        this.#isStarted = false;

        console.log( `PostgreSQL process exited, code: ${code}` );

        process.exitCode = code;

        this.#shutdownSignal.broadcast();

        this.emit( "exit", code );
    }
}
