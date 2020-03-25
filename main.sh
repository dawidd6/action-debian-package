#!/bin/sh

set -e

directory="$PWD/${INPUT_DIRECTORY}"
os="${INPUT_OS:-"debian"}"

cd "$directory"

package="$(dpkg-parsechangelog -S Source)"
version="$(dpkg-parsechangelog -S Version)"
distribution="$(dpkg-parsechangelog -S Distribution | sed 's/UNRELEASED/unstable/')"

container="$package_$version"
image="$os:$distribution"

docker create \
    --tty \
    --name "$container" \
    --volume "$directory":"$directory" \
    --workdir "$directory" \
    "$image" \
    sleep inf

docker start \
    "$container"

docker exec \
    "$container" \
    apt-get update

docker exec \
    "$container" \
    apt-get install -y dpkg-dev debhelper

docker exec \
    "$container" \
    apt-get build-dep "$directory"

docker exec \
    "$container" \
    dpkg-buildpackage -S -us -uc
