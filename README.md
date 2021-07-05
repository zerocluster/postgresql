<!-- !!! DO NOT EDIT, THIS FILE IS GENERATED AUTOMATICALLY !!!  -->

> :information_source: Please, see the full project documentation here: [https://softvisio.github.io/pgsql/](https://softvisio.github.io/pgsql/).

# HOW TO CONNECT

```text
pgsql://username:password@host:port/dbname?option1=val

pgsql://username:password@/path/to/unix/socket/dbname?option1=val
```

# HOW TO UPGRADE

-   Make sure, that old and new clusters use the same versions of timescaledb. If not - upgrade old cluster to the new version first.

-   Migrate

    ```shell
    ./pgsql enter

    /var/local/dist/bin/migrate.sh
    ```

-   After successful upgrade old cluster can be removed:

    ```shell
    # remove old cluster
    rm -rf /var/lib/docker/volumes/pgsql/_data/db-old
    ```

# UPGRADE TIMESCALEDB

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
