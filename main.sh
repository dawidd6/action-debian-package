#!/bin/sh

set -e

directory="${INPUT_DIRECTORY:-$PWD}"
os="${INPUT_OS:-"debian"}"

cd "$directory"

package="$(dpkg-parsechangelog -S Source)"
version="$(dpkg-parsechangelog -S Version)"
distribution="$(dpkg-parsechangelog -S Distribution | sed 's/UNRELEASED/unstable/')"

container="builder"
image="$os:$distribution"
workdir="/build/source"

docker create \
    --name "$container" \
    --volume "$directory":"$workdir" \
    --workdir "$workdir" \
    "$image" \
    sleep inf

docker start \
    "$container"

docker exec \
    --tty \
    "$container" \
    apt-get update

docker exec \
    --tty \
    "$container" \
    apt-get install -y dpkg-dev debhelper

docker exec \
    --tty \
    --workdir "$workdir" \
    "$container" \
    apt-get build-dep ./

docker exec \
    --tty \
    --workdir "$workdir" \
    "$container" \
    dpkg-buildpackage -S -us -uc
