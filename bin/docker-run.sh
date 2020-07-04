#!/bin/bash

set -u
set -e

curl -fsSL https://bitbucket.org/softvisio/pcore-service-pgsql/raw/master/bin/docker-init.sh | /bin/bash

exec ../bin/main.pl "$@"
