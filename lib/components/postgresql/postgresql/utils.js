import childProcess from "node:child_process";
import fs from "node:fs";
import { chmod, glob } from "#core/fs";

export const UID = Number( childProcess.execFileSync( "id", [ "-u", "postgres" ], { "encoding": "utf8" } ).trim() ),
    GID = Number( childProcess.execFileSync( "id", [ "-g", "postgres" ], { "encoding": "utf8" } ).trim() ),
    ROLE = {
        "PRIMARY": "primary",
        "STANDBY_SYNCHRONOUS": "standby-synchronous",
        "STANDBY_ASYNCHRONOUS": "standby-asynchronous",
    };

class PostgreSqlUtils {

    // properties
    get uid () {
        return UID;
    }

    get gid () {
        return GID;
    }

    // public
    async mkdir ( path ) {
        await fs.promises.mkdir( path, { "recursive": true } );

        await this.chmodDir( path, { "recursive": true } );
    }

    async chmodDir ( path, { recursive } = {} ) {
        const promises = [

            //
            fs.promises.chown( path, this.uid, this.gid ),
            chmod( path, "rwx------" ),
        ];

        if ( recursive ) {
            const files = await glob( "**", {
                "cwd": path,
                "directories": true,
                "markDirectories": true,
            } );

            for ( const file of files ) {
                if ( file.endsWith( "/" ) ) {
                    promises.push( this.chmodDir( path + "/" + file ) );
                }
                else {
                    promises.push( this.chmodFile( path + "/" + file ) );
                }
            }
        }

        return Promise.all( promises );
    }

    async chmodFile ( path ) {
        return Promise.all( [

            //
            fs.promises.chown( path, this.uid, this.gid ),
            chmod( path, "rw-------" ),
        ] );
    }

    async writeConfig ( path, config ) {
        if ( !config ) return false;

        const lines = [];

        for ( const name in config ) {
            const value = this.#quoteConfigValue( config[ name ] );

            if ( value == null ) {
                continue;
            }
            else {
                lines.push( `${ name } = ${ value }` );
            }
        }

        if ( lines.length ) {
            await this.writeFile( path, lines.join( "\n" ) + "\n" );

            return true;
        }
        else {
            return false;
        }
    }

    async writeFile ( path, data ) {
        await fs.promises.writeFile( path, data );

        return this.chmodFile( path );
    }

    buildConninfo ( params ) {
        return Object.entries( params )
            .filter( ( [ , value ] ) => value != null )
            .map( ( [ key, value ] ) => `${ key }='${ String( value ).replaceAll( /[\\']/gv, "\\$&" ) }'` )
            .join( " " );
    }

    // private
    #quoteConfigValue ( value ) {

        // null
        if ( value == null ) {
            return;
        }

        // string
        else if ( typeof value === "string" ) {
            const match = value.match( /^\s*(-?\d+(?:\.\d+)?)\s*([Bshd]|kB|MB|GB|TB|us|ms|min)\s*$/v );

            // number with unit
            if ( match ) {
                return `${ match[ 1 ] }${ match[ 2 ] }`;
            }

            // literal
            else {
                return `'${ value.replaceAll( "'", "''" ) }'`;
            }
        }

        // boolean
        else if ( typeof value === "boolean" ) {
            return value.toString();
        }

        // number
        else if ( typeof value === "number" ) {
            return value;
        }

        // array
        else if ( Array.isArray( value ) ) {
            return value
                .map( value => this.#quoteConfigValue( value ) )
                .filter( value => value )
                .join( ", " );
        }

        // other value
        else {
            throw new Error( `PostgreSQL config value "${ value }" is not valid` );
        }
    }
}

export default new PostgreSqlUtils();
