import sql from "#core/sql";
import Cron from "#core/cron";

const cronUpdateQuery = sql`
UPDATE
    cron.schedule
SET
    next_start = ?
WHERE
    id = ?
`.prepare();

const cronStartQuery = sql`
UPDATE
    cron.schedule
SET
    next_start = ?,
    last_started = CURRENT_TIMESTAMP
WHERE
    id = ?
`.prepare();

const cronFinishQuery = sql`
UPDATE
    cron.schedule
SET
    last_finished = CURRENT_TIMESTAMP,
    status = ?,
    status_text = ?
WHERE
    id = ?
`.prepare();

export default class {
    #dbh;
    #tasks = {};

    // properties
    get isConnected () {
        return this.#dbh.isConnected;
    }

    // public
    async start () {
        this.#dbh = await sql.new( "pgsql://postgres@unix/var/run/postgresql/.s.PGSQL.5432" );

        this.#dbh.on( "cron/update", this.#createTask.bind( this ) );
        this.#dbh.on( "cron/delete", this.#deleteTask.bind( this ) );

        await this.#dbh.waitConnect();

        const res = await this.#dbh.exec( sql`
CREATE EXTENSION IF NOT EXISTS softvisio_cron;
ALTER EXTENSION softvisio_cron UPDATE;
` );

        if ( !res.ok ) return res;

        this.#dbh.on( "disconnect", this.#deleteAllTasks.bind( this ) );
        this.#dbh.on( "connect", this.#loadCron.bind( this ) );
        await this.#loadCron();

        return;
    }

    // private
    async #loadCron () {
        const tasks = await this.#dbh.select( sql`SELECT * FROM cron.schedule` );

        if ( !tasks.ok || !tasks.data ) return tasks;

        for ( const task of tasks.data ) {
            await this.#createTask( task );
        }
    }

    #deleteAllTasks () {
        for ( const id of Object.keys( this.#tasks ) ) this.#deleteTask( { id } );
    }

    async #createTask ( task ) {
        try {
            task.cron = new Cron( task.cron, { "timezone": task.timezone } );
            task.query = this.#prepareQuery( task );
        }
        catch ( e ) {

            // task is invalid
            const res = result.catch( e, { "silent": true, "keepError": true } );

            // log error
            await this.#dbh.do( cronFinishQuery, [res.status, res.statusText, task.id] );

            // remove task
            this.#deleteTask( task );

            return;
        }

        // task exists
        if ( this.#tasks[task.id] ) {

            // cron schedule not changed
            if ( task.cron.toString() === this.#tasks[task.id].cron.toString() && task.timezone === this.#tasks[task.id].timezone ) {
                task.cron = this.#tasks[task.id].cron;

                this.#tasks[task.id] = task;

                return;
            }

            // cron schedule changed
            else {
                this.#deleteTask( task );
            }
        }

        this.#tasks[task.id] = task;

        if ( !task.next_start ) {

            // sync next start date
            await this.#dbh.do( cronUpdateQuery, [task.cron.nextDate, task.id] );
        }
        else {
            const nextDate = Date.parse( task.next_start );

            // run missed task
            if ( task.run_missed && nextDate <= Date.now() ) {
                this.#runTask( task, task.cron );
            }

            // sync next start date
            else if ( nextDate !== task.cron.nextDate.getTime() ) {
                await this.#dbh.do( cronUpdateQuery, [task.cron.nextDate, task.id] );
            }
        }

        // run cron
        task.cron.on( "tick", this.#runTask.bind( this, task ) ).unref().start();
    }

    #deleteTask ( task ) {
        task = this.#tasks[task.id];

        if ( !task ) return;

        delete this.#tasks[task.id];

        task.cron.stop();
    }

    async #runTask ( task, cron ) {
        if ( task.started ) {

            // update
            await this.#dbh.do( cronUpdateQuery, [task.cron.nextDate, task.id] );
        }
        else {
            let res;

            task.started = true;

            // start
            res = await this.#dbh.do( cronStartQuery, [task.cron.nextDate, task.id] );

            // unable to start task
            if ( !res.ok ) {
                task.started = false;

                return;
            }

            var dbh;

            if ( task.run_as_superuser ) dbh = this.#dbh._newConnection( { "username": "postgres", "database": task.username } );
            else dbh = this.#dbh._newConnection( { "username": task.username, "database": task.username } );

            for ( const query of task.query ) {
                res = await dbh.exec( query );

                if ( !res.ok ) break;
            }

            dbh.destroy();

            // finish
            await this.#dbh.do( cronFinishQuery, [res.status, res.statusText, task.id] );

            task.started = false;
        }
    }

    #prepareQuery ( task ) {
        const queries = typeof task.query === "string" ? [task.query] : task.query;

        if ( !Array.isArray( queries ) || !queries.length ) throw `Invalid query type`;

        for ( let n = 0; n < queries.length; n++ ) {
            if ( typeof queries[n] !== "string" || !queries[n] ) throw `Invalid query type`;

            queries[n] = sql( queries[n].replaceAll( "CURRENT_DATABASE", task.username ) );
        }

        return queries;
    }
}
