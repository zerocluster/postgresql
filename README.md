<!-- !!! DO NOT EDIT, THIS FILE IS GENERATED AUTOMATICALLY !!!  -->

> :information_source: Please, see the full project documentation here: [https://zerocluster.github.io/pgsql/](https://zerocluster.github.io/pgsql/).

# PosrgreSQL

### Debug

```shell
docker run --rm -it --network main -p 5432:5432 -v /var/local/@zerocluster/pgsql:/var/local/package -v /var/run/postgresql:/var/run/postgresql -v pgsql:/var/lib/docker/volumes/pgsql/_data --entrypoint bash ghcr.io/zerocluster/pgsql-14
```

### Upgrade cluster

-   Make sure, that old and new clusters use the same versions of timescaledb. If not - upgrade old cluster to the new version first.

-   Migrate

    ```shell
    docker stack rm pgsql

    docker run --rm -it -v pgsql:/var/lib/postgresql --entrypoint bash ghcr.io/zerocluster/pgsql

    /var/local/package/bin/migrate.sh
    ```

-   After successful upgrade old cluster can be removed:

    ```shell
    # remove old cluster
    rm -rf /var/lib/docker/volumes/pgsql/_data/data-backup
    ```

### Upgrade timescaledb

-   Upgrade docker container to the latest version, contained new `timescaledb` extension version.

-   From `psql` execute:

    ```sql
    psql -h <HOST>

    # install and update softvisio_admin extension
    CREATE EXTENSION IF NOT EXISTS softvisio_admin CASCADE;
    ALTER EXTENSION softvisio_admin UPDATE;

    # update all extensions for all databases to the latest available versions
    CALL update_extensions();
    ```
