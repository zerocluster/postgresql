# HOW TO CONNECT

```
pgsql://username:password@host:port/dbname?option1=val

pgsql://username:password@/path/to/unix/socket/dbname?option1=val
```

# HOW TO UPGRADE

-   Make sure, that old and new clusters use the same versions of timescaledb. If not - upgrade old cluster to the new version first.

-   Migrate

    ```
    ./pgsql enter

    /var/local/dist/bin/migrate.sh
    ```

-   After successful upgrade old cluster can be removed:

    ```
    # remove old cluster
    rm -rf /var/lib/docker/volumes/pgsql/_data/db-old
    ```

# UPGRADE TIMESCALEDB

-   Upgrade docker container to the latest version, contained new `timescaledb` version.

-   From `psql` execute:

    ```
    psql -h <HOST>

    # install and update "softvisio" extension
    CREATE EXTENSION IF NOT EXISTS "softvisio" CASCADE;
    ALTER EXTENSION "softvisio" UPDATE;

    # update extensions for all databases to the latest versions
    SELECT update_extensions();
    ```
