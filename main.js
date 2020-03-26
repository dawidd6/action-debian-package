const core = require("@actions/core")
const exec = require("@actions/exec")
const firstline = require("firstline")
const path = require("path")
const fs = require("fs")

async function main() {
    try {
        const sourceDirectory = core.getInput("source_directory", { required: true })
        const artifactsDirectory = core.getInput("artifacts_directory", { required: true })
        const os = core.getInput("os", { required: true })

        const workspaceDirectory = process.cwd()
        const file = path.join(workspaceDirectory, sourceDirectory, "debian/changelog")
        const changelog = await firstline(file)
        const regex = /^(?<package>.+) \((?<version>[^-]+)-?(?<revision>[^-]+)?\) (?<distribution>.+); (?<options>.+)$/
        const match = changelog.match(regex)
        const { package, version, revision, distribution } = match.groups
        const container = package + "_" + version
        const image = os + ":" + distribution.replace("UNRELEASED", "unstable")

        fs.mkdirSync(artifactsDirectory, { recursive: true })

        core.startGroup("Create container")
        await exec.exec("docker", [
            "create",
            "--name", container,
            "--volume", workspaceDirectory + ":" + workspaceDirectory,
            "--workdir", path.join(workspaceDirectory, sourceDirectory),
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
                "-cvzf", `../${package}_${version}.orig.tar.gz`,
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
            "apt-get", "install", "-y", "dpkg-dev", "debhelper"
        ])
        core.endGroup()

        core.startGroup("Install build dependencies")
        await exec.exec("docker", [
            "exec",
            container,
            "apt-get", "build-dep", "-y", "./"
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
            "find",
            "..",
            "-maxdepth", "1",
            "-name", `${package}_${version}*.*`,
            "-type", "f",
            "-print",
            "-exec", "cp", "{}", artifactsDirectory, ";"
        ])
        core.endGroup()
    } catch (error) {
        core.setFailed(error.message)
    }
}

main()
