const core = require("@actions/core")
const exec = require("@actions/exec")
const firstline = require("firstline")
const hub = require("docker-hub-utils")
const path = require("path")
const fs = require("fs")

function getDistribution(distribution) {
    return distribution.replace("UNRELEASED", "unstable")
}

async function getOS(distribution) {
    for (const os of ["debian", "ubuntu"]) {
        const tags = await hub.queryTags({ user: "library", name: os })
        if (tags.find(tag => tag.name == distribution)) {
            return os
        }
    }
}

async function main() {
    try {
        const sourceRelativeDirectory = core.getInput("source_directory")
        const artifactsRelativeDirectory = core.getInput("artifacts_directory")

        const workspaceDirectory = process.cwd()
        const sourceDirectory = path.join(workspaceDirectory, sourceRelativeDirectory)
        const buildDirectory = path.dirname(sourceDirectory)
        const artifactsDirectory = path.join(workspaceDirectory, artifactsRelativeDirectory)

        const file = path.join(sourceDirectory, "debian/changelog")
        const changelog = await firstline(file)
        const regex = /^(?<package>.+) \((?<version>[^-]+)-?(?<revision>[^-]+)?\) (?<distribution>.+);/
        const match = changelog.match(regex)
        const { package, version, revision, distribution } = match.groups
        const os = await getOS(getDistribution(distribution))
        const container = package + "_" + version
        const image = os + ":" + getDistribution(distribution)

        fs.mkdirSync(artifactsDirectory, { recursive: true })

        core.startGroup("Print details")
        const details = {
            package: package,
            version: version,
            revision: revision,
            distribution: getDistribution(distribution),
            os: os,
            container: container,
            image: image,
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
                "--transform", `s/^\./${package}-${version}/`,
                "-cvzf", `${buildDirectory}/${package}_${version}.orig.tar.gz`,
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
            "apt-get", "install", "-yq", "dpkg-dev", "debhelper"
        ])
        core.endGroup()

        core.startGroup("Install build dependencies")
        await exec.exec("docker", [
            "exec",
            container,
            "apt-get", "build-dep", "-yq", sourceDirectory
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
            "-name", `${package}_${version}*.*`,
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
