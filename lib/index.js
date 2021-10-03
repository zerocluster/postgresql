import fs from "fs";
import childProcess from "childProcess";
import crypto from "crypto";
import module from "module";

const require = module.createRequire( import.meta.url );

export default class {
    #proc;

    async run () {
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

            childProcess.execFileSync( "initdb", ["--encoding", "UTF8", "--no-locale", "-U", "postgres", "--pwfile", pwfile, "-D", dataDir], { uid, gid } );

            fs.rmSync( pwfile, { "force": true } );
        }

        // copy pg_hba.conf
        fs.copyFileSync( require.resolve( "#resources/pg_hba.conf" ), dataDir + "/pg_hba.conf" );
        fs.chownSync( dataDir + "/pg_hba.conf", uid, gid );

        // create "conf.d" dir
        if ( !fs.existsSync( dataDir + "/conf.d" ) ) {
            fs.mkdirSync( dataDir + "/conf.d", { "recursive": true } );
            fs.chownSync( dataDir + "/conf.d", uid, gid );

            // move "postgresql.conf"
            fs.copyFileSync( dataDir + "/postgresql.conf", dataDir + "/conf.d/000.postgresql.conf" );
            fs.chownSync( dataDir + "/conf.d/000.postgresql.conf", uid, gid );

            fs.writeFileSync( dataDir + "/postgresql.conf", "include_dir = 'conf.d'" );
            fs.chownSync( dataDir + "/postgresql.conf", uid, gid );
        }

        // copy default settings
        fs.copyFileSync( require.resolve( "#resources/100.init.conf" ), dataDir + "/conf.d/100-init.conf" );
        fs.chownSync( dataDir + "/conf.d/100-init.conf", uid, gid );

        // create and prepare unix socket dir
        if ( !fs.existsSync( "/var/run/postgresql" ) ) fs.mkdirSync( "/var/run/postgresql", { "recursive": true } );
        fs.chownSync( "/var/run/postgresql", uid, gid );

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
