const fs = require( "fs" );
const child_process = require( "child_process" );
const crypto = require( "crypto" );

module.exports = class {
    #proc;

    async run () {
        const dataDir = "/var/lib/pgsql/data";

        const uid = +child_process.execFileSync( "id", ["-u", "postgres"], { "encoding": "utf8" } ).trim(),
            gid = +child_process.execFileSync( "id", ["-g", "postgres"], { "encoding": "utf8" } ).trim();

        if ( fs.existsSync( dataDir ) ) {
            fs.chownSync( dataDir, uid, gid );
            fs.chmodSync( dataDir, 0o700 );
        }

        // init db
        if ( !fs.existsSync( dataDir + "/PG_VERSION" ) ) {
            const pwfile = "/tmp/pgsql-password.txt";

            let superuserPassword;

            if ( process.env.PGSQL_POSTGRES_PASSWORD ) {
                superuserPassword = process.env.PGSQL_POSTGRES_PASSWORD;
            }
            else {
                superuserPassword = crypto.randomBytes( 16 ).toString( "base64url" );

                console.log( `GENERATED POSTGRES PASSWORD: ${superuserPassword}` );
            }

            fs.writeFileSync( pwfile, superuserPassword );
            fs.chownSync( pwfile, uid, gid );

            child_process.execFileSync( "initdb", ["--encoding", "UTF8", "--no-locale", "-U", "postgres", "--pwfile", pwfile, "-D", dataDir], { uid, gid } );

            fs.rmSync( pwfile, { "force": true } );
        }

        // write pg_hba.conf
        fs.writeFileSync( dataDir + "/pg_hba.conf",
            [
                "local all all trust", // trust any user, connected via unix socket
                "host all all 0.0.0.0/0 md5", // require password, when user is connected via TCP
            ].join( "\n" ) );

        // create "conf.d" dir
        if ( !fs.existsSync( dataDir + "/conf.d" ) ) {
            fs.mkdirSync( dataDir + "/conf.d", { "recursive": true } );
            fs.chownSync( dataDir + "/conf.d", uid, gid );

            // move "postgresql.conf"
            fs.copyFileSync( dataDir + "/postgresql.conf", dataDir + "/conf.d/000-postgresql.conf" );
            fs.chownSync( dataDir + "/conf.d/000-postgresql.conf", uid, gid );

            fs.writeFileSync( dataDir + "/postgresql.conf", "include_dir = 'conf.d'" );
            fs.chownSync( dataDir + "/postgresql.conf", uid, gid );
        }

        // default settings
        fs.writeFileSync( dataDir + "/conf.d/100-init.conf",
            [

                // listen
                "listen_addresses = '*'",
                "unix_socket_directories = '/var/run/postgresql'",

                // extensions
                "shared_preload_libraries = 'timescaledb'",
            ].join( "\n" ) );
        fs.chownSync( dataDir + "/conf.d/100-init.conf", uid, gid );

        // create and prepare unix socket dir
        if ( !fs.existsSync( "/var/run/postgresql" ) ) fs.mkdirSync( "/var/run/postgresql", { "recursive": true } );
        fs.chownSync( "/var/run/postgresql", uid, gid );

        // run server
        this.#proc = child_process.spawn( "postgres", ["-D", dataDir], { uid, gid, "stdio": "inherit", "detached": true } );

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
};
