#!/bin/bash

# curl -fsSLO https://bitbucket.org/softvisio/pgsql/raw/master/contrib/pgsql.sh && chmod +x pgsql.sh
# PGSQL_POSTGRES_PASSWORD=1 ./pgsql.sh

set -e

SCRIPT_DIR="$(cd -P -- "$(dirname -- "$0")" && pwd -P)"

export TAG=latest
export NAME=pgsql
export DOCKER_NAMESPACE=softvisio
export SERVICE=1
export CONTAINER_NAME=

# Docker container restart policy, https://docs.docker.com/config/containers/start-containers-automatically/
# - no             - do not automatically restart the container. (the default);
# - on-failure     - restart the container if it exits due to an error, which manifests as a non-zero exit code;
# - unless-stopped - restart the container unless it is explicitly stopped or Docker itself is stopped or restarted;
# - always         - always restart the container if it stops;
export RESTART=always

# Seconds to wait for stop before killing container, https://docs.docker.com/engine/reference/commandline/stop/#options
export KILL_TIMEOUT=10

if [[ ! -z $PGSQL_POSTGRES_PASSWORD ]]; then
    PASSWORD="-e PGSQL_POSTGRES_PASSWORD=$PGSQL_POSTGRES_PASSWORD"
else
    echo "to see generated postgres password run: docker logs pgsql 2>&1 | grep \"GENERATED POSTGRES PASSWORD\""
fi

export DOCKER_CONTAINER_ARGS="
    $PASSWORD \
    -v pgsql:/var/local/pgsql/data \
    -v /var/run/postgresql:/var/run/postgresql \
    -p 5432:5432/tcp \
    --shm-size=1g \
"

(source <(curl -fsSL https://bitbucket.org/softvisio/scripts/raw/master/docker.sh) "$@")
