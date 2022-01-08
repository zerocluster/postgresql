import sql from "#core/sql";
import Cron from "#core/cron";

const cronSchema = sql`

CREATE SCHEMA IF NOT EXISTS cron;
GRANT USAGE ON SCHEMA cron TO PUBLIC;

CREATE SEQUENCE IF NOT EXISTS cron.schedule_id_seq AS int8 CYCLE;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA cron TO PUBLIC;

CREATE TABLE IF NOT EXISTS cron.schedule (
    id int8 PRIMARY KEY NOT NULL,
    module text NOT NULL,
    name text NOT NULL,
    username text NOT NULL,
    cron text NOT NULL,
    timezone text,
    query text NOT NULL,
    as_superuser bool NOT NULL DEFAULT FALSE,
    run_missed bool NOT NULL DEFAULT TRUE,
    next_start timestamptz( 0 ),
    last_started timestamptz,
    last_finished timestamptz,
    status int2,
    status_text text,
    UNIQUE ( username, module, name )
);

CREATE OR REPLACE FUNCTION schedule_before_insert_trigger() RETURNS TRIGGER AS $$
BEGIN
    NEW.id = nextval( 'cron.schedule_id_seq' );
    NEW.username = CURRENT_USER;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION schedule_after_update_trigger() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify( 'cron/update', json_build_object(
        'id', NEW.id::text,
        'module', NEW.module,
        'name', NEW.name,
        'username', NEW.username,
        'cron', NEW.cron,
        'timezone', NEW.timezone,
        'query', NEW.query,
        'as_superuser', NEW.as_superuser,
        'run_missed', NEW.run_missed
    )::text );

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION schedule_after_delete_trigger() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify( 'cron/delete', json_build_object(
        'id', OLD.id::text
    )::text );

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS schedule_before_insert ON cron.schedule;
CREATE TRIGGER schedule_before_insert BEFORE INSERT ON cron.schedule FOR EACH ROW EXECUTE FUNCTION schedule_before_insert_trigger();

DROP TRIGGER IF EXISTS schedule_after_insert ON cron.schedule;
CREATE TRIGGER schedule_after_insert AFTER INSERT ON cron.schedule FOR EACH ROW EXECUTE FUNCTION schedule_after_update_trigger();

DROP TRIGGER IF EXISTS schedule_after_update ON cron.schedule;
CREATE TRIGGER schedule_after_update AFTER UPDATE OF cron, timezone, query, as_superuser, run_missed ON cron.schedule FOR EACH ROW EXECUTE FUNCTION schedule_after_update_trigger();

DROP TRIGGER IF EXISTS schedule_after_delete ON cron.schedule;
CREATE TRIGGER schedule_after_delete AFTER DELETE ON cron.schedule FOR EACH ROW EXECUTE FUNCTION schedule_after_delete_trigger();

ALTER TABLE cron.schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cron_schedule_policy ON cron.schedule;
CREATE POLICY cron_schedule_policy ON cron.schedule FOR ALL USING ( username = CURRENT_USER );

GRANT
    SELECT,
    DELETE,
    INSERT ( id, module, name, username, cron, timezone, query, as_superuser, run_missed ),
    UPDATE ( module, name, cron, timezone, query, as_superuser, run_missed )
ON cron.schedule TO PUBLIC;

`;

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
    status_tst = ?
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

        const res = await this.#dbh.exec( cronSchema );

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
        task.query = task.query.replaceAll( "CURRENT_DATABASE", task.username );

        // task exists
        if ( this.#tasks[task.id] ) {
            const cron = new Cron( task.cron, { "timezone": task.timezone } );

            // cron not updated
            if ( cron.toString() === this.#tasks[task.id].cron.toString() && task.timezone === this.#tasks[task.id].timezone ) {
                this.#tasks[task.id].query = sql( task.query );
                this.#tasks[task.id].as_superuser = task.as_superuser;
                this.#tasks[task.id].run_missed = task.run_missed;

                return;
            }

            // cron updated
            else {
                this.#deleteTask( task );
            }
        }

        // prepare query
        task.query = sql( task.query );

        task.cron = new Cron( task.cron, { "timezone": task.timezone } ).on( "tick", this.#runTask.bind( this, task ) ).unref();

        this.#tasks[task.id] = task;

        // run cron
        task.cron.start();

        if ( !task.next_start ) {
            await this.#dbh.do( cronUpdateQuery, [task.cron.nextDate, task.id] );
        }
        else {
            const nextDate = Date.parse( task.next_start ),
                currentDate = Date.now();

            // run missed task
            if ( nextDate <= currentDate && task.run_missed ) this.#runTask( task, task.cron );
        }
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
            task.started = true;

            // start
            await this.#dbh.do( cronStartQuery, [task.id] );

            var dbh;

            if ( task.as_superuser ) dbh = this.#dbh._newConnection( { "username": "postgres", "database": task.username } );
            else dbh = this.#dbh._newConnection( { "username": task.username, "database": task.username } );

            // run query
            const res = await dbh.exec( task.query );

            dbh.destroy();

            // finish
            await this.#dbh.do( cronFinishQuery, res.status, [res.statusText, task.id] );

            task.started = false;
        }
    }
}
