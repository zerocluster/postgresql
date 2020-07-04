CREATE EXTENSION IF NOT EXISTS dblink;

DO
$$
DECLARE database_name TEXT;
DECLARE conn_template TEXT;
DECLARE conn_string TEXT;
BEGIN
    conn_template = 'user=postgres password=1 dbname=';

    FOR database_name IN
        SELECT "datname" FROM "pg_database" WHERE "datistemplate" = false
    LOOP
        conn_string = conn_template || database_name;

        RAISE NOTICE 'DB NAME: "%"', database_name;

        PERFORM dblink_exec(conn_string, 'ALTER EXTENSION "timescaledb" UPDATE', FALSE);
    END LOOP;

END
$$
