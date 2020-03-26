#!/bin/sh

set -eu

directory="${INPUT_DIRECTORY:-}"
os="${INPUT_OS:-"debian"}"

directory_runner="$RUNNER_WORKSPACE/$directory"
directory_container="$GITHUB_WORKSPACE/$directory"

cd "$directory_container"

package="$(dpkg-parsechangelog -S Source)"
version="$(dpkg-parsechangelog -S Version)"
distribution="$(dpkg-parsechangelog -S Distribution | sed 's/UNRELEASED/unstable/')"

container="$package-$version"
image="$os:$distribution"

docker create \
    --tty \
    --name "$container" \
    --volume "$directory_runner":"$directory_container" \
    --workdir "$directory_container" \
    "$image" \
    sleep inf

docker start \
    "$container"

echo
docker exec $container ls -lha
echo
exit

docker exec \
    "$container" \
    apt-get update

docker exec \
    "$container" \
    apt-get install -y dpkg-dev debhelper

docker exec \
    "$container" \
    apt-get build-dep "$directory_container"

docker exec \
    "$container" \
    dpkg-buildpackage -S -us -uc
