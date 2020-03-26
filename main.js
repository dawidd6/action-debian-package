const path = require("path")
const core = require("@actions/core")
const exec = require("@actions/exec")
const firstline = require("firstline")

async function main() {
    try {
        const directory = core.getInput("directory", { required: true })
        const os = core.getInput("os", { required: true })

        const directoryRunner = path.join(process.cwd(), directory)
        const directoryContainer = "/build/source"

        const file = path.join(directoryRunner, "debian/changelog")
        const changelog = await firstline(file)
        const regex = /^(?<package>.+) \((?<version>.+)-(?<revision>.+)\) (?<distribution>.+); (?<options>.+)$/
        const match = changelog.match(regex)
        const { package, version, revision, distribution } = match.groups
        const container = package + "_" + version + "-" + revision
        const image = os + ":" + distribution.replace("UNRELEASED", "unstable")

        core.startGroup("Create container")
        await exec.exec("docker", [
            "create",
            "--name", container,
            "--volume", directoryRunner + ":" + directoryContainer,
            "--workdir", directoryContainer,
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

        core.startGroup("Create tarball")
        await exec.exec("docker", [
            "exec",
            container,
            "tar",
            "--exclude-vcs",
            "--exclude", "./debian",
            "--transform", `s/^\./${package}-${version}/`,
            "-cvzf", `../${package}_${version}.orig.tar.gz`,
            "./"
        ])
        core.endGroup()

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
            "apt-get", "install", "-y", "dpkg-dev", "debhelper"
        ])
        core.endGroup()

        core.startGroup("Install build dependencies")
        await exec.exec("docker", [
            "exec",
            container,
            "apt-get", "build-dep", "-y", directoryContainer
        ])
        core.endGroup()

        core.startGroup("Build package")
        await exec.exec("docker", [
            "exec",
            container,
            "dpkg-buildpackage", "-tc"
        ])
        core.endGroup()

        core.startGroup("Copy artifacts")
        await exec.exec("docker", [
            "exec",
            container,
            "ls", "-lh", ".."
        ])
        await exec.exec("docker", [
            "exec",
            container,
            "cp", `../${package}_${version}*.*`, "."
        ])
        core.endGroup()
    } catch (error) {
        core.setFailed(error.message)
    }
}

main()
