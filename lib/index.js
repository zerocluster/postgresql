import env from "#core/env";
import fs from "fs";
import childProcess from "child_process";
import crypto from "crypto";

export default class {
    #proc;

    async run () {
        const config = env.readConfig();

        const dataDir = "/var/lib/pgsql/data";

        const uid = +childProcess.execFileSync( "id", ["-u", "postgres"], { "encoding": "utf8" } ).trim(),
            gid = +childProcess.execFileSync( "id", ["-g", "postgres"], { "encoding": "utf8" } ).trim();

        if ( fs.existsSync( dataDir ) ) {
            fs.chownSync( dataDir, uid, gid );
            fs.chmodSync( dataDir, 0o700 );
        }

        // init db
        if ( !fs.existsSync( dataDir + "/PG_VERSION" ) ) {
            const pwfile = "/tmp/pgsql-password.txt";

            const superuserPassword = crypto.randomBytes( 16 ).toString( "base64url" );

            console.log( `GENERATED POSTGRES PASSWORD: ${superuserPassword}` );

            fs.writeFileSync( pwfile, superuserPassword );
            fs.chownSync( pwfile, uid, gid );

            childProcess.execFileSync( "initdb", ["--encoding", "UTF8", "--no-locale", "-U", "postgres", "--pwfile", pwfile, "-D", dataDir], { uid, gid } );

            fs.rmSync( pwfile, { "force": true } );
        }

        // generate pg_hba.conf
        const pgHba = [];
        if ( config?.config?.access ) {
            for ( const access of config.config.access ) {
                pgHba.push( `${access.host} ${access.database ?? " "} ${access.user ?? " "} ${access.address ?? " "} ${access.auth}${access.auth_options ? "" : access.auth_options}\n` );
            }
        }
        fs.writeFileSync( dataDir + "/pg_hba.conf", pgHba.join( "" ) );
        fs.chownSync( dataDir + "/pg_hba.conf", uid, gid );

        // create "conf.d" dir
        if ( !fs.existsSync( dataDir + "/conf.d" ) ) {
            fs.mkdirSync( dataDir + "/conf.d", { "recursive": true } );
            fs.chownSync( dataDir + "/conf.d", uid, gid );

            // move "postgresql.conf"
            fs.copyFileSync( dataDir + "/postgresql.conf", dataDir + "/conf.d/0-postgresql.conf" );
            fs.chownSync( dataDir + "/conf.d/0-postgresql.conf", uid, gid );

            fs.writeFileSync( dataDir + "/postgresql.conf", "include_dir = 'conf.d'" );
            fs.chownSync( dataDir + "/postgresql.conf", uid, gid );
        }

        // generate default settings
        const settings = [];
        if ( config?.config?.settings ) {
            for ( const name in config.config.settings ) settings.push( `${name} = ${config.config.settings[name] == null ? "" : "'" + config.config.settings[name] + "'"}\n` );
        }
        fs.writeFileSync( dataDir + "/conf.d/1-init.conf", settings.join( "" ) );
        fs.chownSync( dataDir + "/conf.d/1-init.conf", uid, gid );

        // create and prepare unix socket dir
        const location = config.config.settings.unix_socket_directories || "/var/run/postgresql";
        if ( !fs.existsSync( location ) ) fs.mkdirSync( location, { "recursive": true } );
        fs.chownSync( location, uid, gid );

        // run server
        this.#proc = childProcess.spawn( "postgres", ["-D", dataDir], { uid, gid, "stdio": "inherit", "detached": true } );

        // https://www.postgresql.org/docs/current/server-shutdown.html
        process.on( "SIGTERM", this.fastShutdown.bind( this ) );
        process.on( "SIGINT", this.fastShutdown.bind( this ) );
        process.on( "SIGQUIT", this.immediateShutdown.bind( this ) );
    }

    smartShutdown () {
        console.log( "Smart shutdown ..." );

        this.#proc.kill( "SIGTERM" );
    }

    fastShutdown () {
        console.log( "Fast shutdown ..." );

        this.#proc.kill( "SIGINT" );
    }

    immediateShutdown () {
        console.log( "Immediate shutdown ..." );

        this.#proc.kill( "SIGQUIT" );
    }
}
