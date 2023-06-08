import Events from "#core/events";
import Cron from "#lib/cron";
import fs from "fs";
import childProcess from "child_process";
import crypto from "crypto";
import sql from "#core/sql";
import Signal from "#core/threads/signal";
import uuidV4 from "#core/uuid";

// https://www.postgresql.org/docs/current/server-shutdown.html

export default class Pgsql extends Events {
    #app;
    #config;
    #proc;
    #cron;
    #isStarted;
    #shutdownSignal = new Signal();

    #dataRoot = "/var/lib/docker/volumes/pgsql/_data";
    #backupDir = this.#dataRoot + "/backup";
    #dataDir;
    #unixSocketDirectories;
    #uid = +childProcess.execFileSync( "id", ["-u", "postgres"], { "encoding": "utf8" } ).trim();
    #gid = +childProcess.execFileSync( "id", ["-g", "postgres"], { "encoding": "utf8" } ).trim();

    constructor ( app, config ) {
        super();

        this.#app = app;
        this.#config = config;
    }

    // properties
    get app () {
        return this.#app;
    }

    get config () {
        return this.#config;
    }

    get isStarted () {
        return this.#isStarted;
    }

    get cron () {
        return this.#cron;
    }

    // public
    async run () {
        if ( this.#isStarted ) return result( 200 );

        this.#isStarted = true;
        this.#dataDir = this.#dataRoot + "/" + process.env.POSTGRES_VERSION;
        this.#unixSocketDirectories = "/var/run/postgresql";

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

        // init primary
        if ( this.#app.components.service === "default" ) {
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

        // process.on( "SIGQUIT", this.immediateShutDown.bind( this ) );

        // run cron
        if ( this.#app.components.service === "default" ) {
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

        // generate pg_hba.conf
        const pgHba = [];
        if ( this.#config.access ) {
            for ( const access of this.#config.access ) {
                const line = [];

                for ( const name of ["host", "database", "user", "address", "auth-method", "auth-options"] ) {
                    if ( !access[name] ) continue;

                    line.push( access[name] );
                }

                pgHba.push( line.join( " " ) );
            }
        }
        fs.writeFileSync( this.#dataDir + "/pg_hba.conf", pgHba.join( "\n" ) );
        fs.chownSync( this.#dataDir + "/pg_hba.conf", this.#uid, this.#gid );

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
        if ( this.#config.settings ) {
            if ( typeof this.#config.settings === "string" ) {
                settings.push( this.#config.settings );
            }
            else {
                for ( const name in this.#config.settings ) {
                    const value = this.#config.settings[name];

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
            }
        }
        fs.writeFileSync( this.#dataDir + "/conf.d/1-init.conf", settings.join( "\n" ) );
        fs.chownSync( this.#dataDir + "/conf.d/1-init.conf", this.#uid, this.#gid );

        // update extensions
        await this.#update();
    }

    // XXX write pg settings???
    async #initStandby () {

        // XXX
        // - oarse postgresql.auto.conf
        // - take slot name frooom primary_slot_name
        // - if slot defined:
        //  - scheck on primary, that slot exists;
        //  - if slot not exists on promary - clone database;
        //
        // const dbh = await sql.new( "pgsql://postgres@unix/var/run/postgresql/.s.PGSQL.5432" );
        // SELECT * FROM pg_replication_slots;
        // SELECT * FROM pg_create_physical_replication_slot( '1f605439_1e8d_489e_880e_16bdc4bd9d14' );

        // init db
        if ( !fs.existsSync( this.#dataDir + "/PG_VERSION" ) ) {
            childProcess.execFileSync(
                "pg_basebackup",
                [

                    //
                    "--host=" + this.#config.replication.host,
                    "--pgdata=" + this.#dataDir,
                    "--username=" + this.#config.replication.username,
                    "--progress",
                    "--verbose",
                    "--write-recovery-conf",
                    "--wal-method=stream",
                    "--create-slot", // XXX ???
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

        // XXX write pg settings

        fs.writeFileSync( this.#dataDir + "/standby.signal", "" );
    }

    #onProcExit ( code, signal ) {
        this.#proc = null;
        this.#isStarted = false;

        console.log( `PostgreSQL process exited, code: ${code}` );

        process.exitCode = code;

        this.#shutdownSignal.broadcast();

        this.emit( "exit", code );
    }

    async #update () {
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

    async #backup () {
        fs.mkdirSync( this.#backupDir, { "recursive": true } );
        fs.chownSync( this.#backupDir, this.#uid, this.#gid );
        fs.chmodSync( this.#backupDir, 0o700 );

        const backupId = new Date().toISOString();

        childProcess.execFileSync(
            "pg_basebackup",
            [

                //
                "--label=" + backupId,
                "--pgdata=" + this.#backupDir + backupId,
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
}
