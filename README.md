<!-- !!! DO NOT EDIT, THIS FILE IS GENERATED AUTOMATICALLY !!!  -->

> :information_source: Please, see the full project documentation here: [https://zerocluster.github.io/pgsql/](https://zerocluster.github.io/pgsql/).

# PosrgreSQL

# Upgrade cluster

-   Make sure, that old and new clusters use the same versions of timescaledb. If not - upgrade old cluster to the new version first.

-   Migrate

    ```shell
    docker stack rm pgsql

    docker run --rm -it -v pgsql:/var/lib/pgsql --entrypoint bash zerocluster/pgsql

    /var/local/package/bin/migrate.sh
    ```

-   After successful upgrade old cluster can be removed:

    ```shell
    # remove old cluster
    rm -rf /var/lib/docker/volumes/pgsql/_data/data-backup
    ```

# Upgrade timescaledb

-   Upgrade docker container to the latest version, contained new `timescaledb` extension version.

-   From `psql` execute:

    ```sql
    psql -h <HOST>

    # install and update "softvisio" extension
    CREATE EXTENSION IF NOT EXISTS "softvisio" CASCADE;
    ALTER EXTENSION "softvisio" UPDATE;

    # update all extensions for all databases to the latest available versions
    CALL update_extensions();
    ```
