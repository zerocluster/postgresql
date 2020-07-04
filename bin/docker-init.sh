#!/bin/bash

set -u
set -e

POSTGIS_LATEST=30

PACKAGES=

if [[ ! -z ${POSTGIS-} ]]; then
    if [[ $POSTGIS = "1" || $POSTGIS = "latest" ]]; then
        POSTGIS=$POSTGIS_LATEST
    fi

    PACKAGES="$PACKAGES postgis${POSTGIS}_${POSTGRES_VER}"
fi

if [[ ! -z $PACKAGES ]]; then
    dnf -y install $PACKAGES
fi
