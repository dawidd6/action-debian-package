const core = require("@actions/core")
const exec = require("@actions/exec")
const firstline = require("firstline")
const hub = require("docker-hub-utils")
const path = require("path")
const fs = require("fs")

function getImageTag(imageName, distribution) {
    if (imageName == "debian") {
        return distribution.replace("UNRELEASED", "unstable")
            .replace("-security", "")
    } else {
        return distribution.replace("UNRELEASED", "unstable")
            .replace("-security", "")
            .replace("-backports", "")
    }
}

async function getImageName(distribution) {
    const tag = getImageTag("", distribution)
    for (const image of ["debian", "ubuntu"]) {
        const tags = await hub.queryTags({ user: "library", name: image })
        if (tags.find(t => t.name == tag)) {
            return image
        }
    }
}

async function main() {
    try {
        const sourceRelativeDirectory = core.getInput("source_directory") || "./"
        const artifactsRelativeDirectory = core.getInput("artifacts_directory") || "./"

        const workspaceDirectory = process.cwd()
        const sourceDirectory = path.join(workspaceDirectory, sourceRelativeDirectory)
        const buildDirectory = path.dirname(sourceDirectory)
        const artifactsDirectory = path.join(workspaceDirectory, artifactsRelativeDirectory)

        const file = path.join(sourceDirectory, "debian/changelog")
        const changelog = await firstline(file)
        const regex = /^(?<pkg>.+) \(((?<epoch>[0-9]+):)?(?<version>[^:-]+)(-(?<revision>[^:-]+))?\) (?<distribution>.+);/
        const match = changelog.match(regex)
        const { pkg, epoch, version, revision, distribution } = match.groups
        const imageName = await getImageName(distribution)
        const imageTag = await getImageTag(imageName, distribution)
        const container = pkg
        const image = imageName + ":" + imageTag

        fs.mkdirSync(artifactsDirectory, { recursive: true })

        core.startGroup("Print details")
        const details = {
            pkg: pkg,
            epoch: epoch,
            version: version,
            revision: revision,
            distribution: distribution,
            image: image,
            container: container,
            workspaceDirectory: workspaceDirectory,
            sourceDirectory: sourceDirectory,
            buildDirectory: buildDirectory,
            artifactsDirectory: artifactsDirectory
        }
        console.log(details)
        core.endGroup()

        core.startGroup("Create container")
        await exec.exec("docker", [
            "create",
            "--name", container,
            "--volume", workspaceDirectory + ":" + workspaceDirectory,
            "--workdir", sourceDirectory,
            "--env", "DEBIAN_FRONTEND=noninteractive",
            "--env", "DPKG_COLORS=always",
            "--env", "FORCE_UNSAFE_CONFIGURE=1",
            "--tty",
            image,
            "sleep", "inf"
        ])
        core.endGroup()

        core.startGroup("Start container")
        await exec.exec("docker", [
            "start",
            container
        ])
        core.endGroup()

        if (revision) {
            core.startGroup("Create tarball")
            await exec.exec("docker", [
                "exec",
                container,
                "tar",
                "--exclude-vcs",
                "--exclude", "./debian",
                "--transform", `s/^\./${pkg}-${version}/S`,
                "-cvzf", `${buildDirectory}/${pkg}_${version}.orig.tar.gz`,
                "-C", sourceDirectory,
                "./"
            ])
            core.endGroup()
        }

        core.startGroup("Update packages list")
        await exec.exec("docker", [
            "exec",
            container,
            "apt-get", "update"
        ])
        core.endGroup()

        core.startGroup("Install development packages")
        await exec.exec("docker", [
            "exec",
            container,
            "apt-get", "install", "-yq", "-t", imageTag, "dpkg-dev", "debhelper"
        ])
        core.endGroup()

        core.startGroup("Install build dependencies")
        await exec.exec("docker", [
            "exec",
            container,
            "apt-get", "build-dep", "-yq", "-t", imageTag, sourceDirectory
        ])
        core.endGroup()

        core.startGroup("Build package")
        await exec.exec("docker", [
            "exec",
            container,
            "dpkg-buildpackage", "-tc"
        ])
        core.endGroup()

        core.startGroup("Move artifacts")
        await exec.exec("docker", [
            "exec",
            container,
            "find",
            buildDirectory,
            "-maxdepth", "1",
            "-name", `${pkg}*${version}*.*`,
            "-type", "f",
            "-print",
            "-exec", "mv", "{}", artifactsDirectory, ";"
        ])
        core.endGroup()
    } catch (error) {
        core.setFailed(error.message)
    }
}

main()
