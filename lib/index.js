const fs = require( "fs" ),
    child_process = require( "child_process" );

module.exports = class {
    async run () {
        const dataDir = ".";

        const uid = child_process.execFile( "id", ["-u", "postgres"] ),
            gid = child_process.execFile( "id", ["-g", "postgres"] );

        if ( !fs.existsSync( dataDir ) ) fs.mkdirSync( dataDir, { "recurcive": true } );
        fs.chownSync( dataDir, uid, gid );

        // init db
        if ( !fs.existsSync( dataDir + "/PG_VERSION" ) ) {
            const pwfile = dataDir + "/pgsql-password.txt";

            let superuserPassword;

            if ( process.env.PGSQL_POSTGRES_PASSWORD != null ) {
                superuserPassword = process.env.PGSQL_POSTGRES_PASSWORD;
            }
            else {
                superuserPassword = require( "crypto" ).randomBytes( 32 ).toString( "hex" );

                console.log( `GENERATED POSTGRES PASSWORD: ${superuserPassword}` );
            }

            fs.writeFileSync( pwfile, superuserPassword );
            fs.chownSync( pwfile, uid, gid );

            child_process.execFile( "postgres", ["-C", "initdb", "--encoding", "UTF8", "--no-locale", "-U", "postgres", "--pwfile", pwfile, "-D", dataDir], { uid, gid } );

            fs.unlinkSync( pwfile );
        }
    }
};
