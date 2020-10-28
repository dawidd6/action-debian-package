const core = require("@actions/core")
const exec = require("@actions/exec")
const firstline = require("firstline")
const hub = require("docker-hub-utils")
const path = require("path")
const fs = require("fs")

function getDistribution(distribution) {
    return distribution.replace("UNRELEASED", "unstable")
                       .replace("-security", "")
                       .replace("-backports", "")
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
        const targetArchitectures = core.getInput("target_architectures").replace(" ", "").split(",") || []

        const sourceRelativeDirectory = core.getInput("source_directory") || "./"
        const artifactsRelativeDirectory = core.getInput("artifacts_directory") || "./"

        const defaultDpkgBuildPackageOpts = [
            // Don't sign for now
            "--no-sign",

            // Don't worry about build dependencies - we have already installed them
            // (Seems to not recognize that some packages are installed)
            "-d"
        ]
        const dpkgBuildPackageOpts = core.getInput("dpkg_buildpackage_opts").replace(" ", "").split(",") || defaultDpkgBuildPackageOpts
        const lintianOpts = core.getInput("lintian_opts") || []

        const workspaceDirectory = process.cwd()
        const sourceDirectory = path.join(workspaceDirectory, sourceRelativeDirectory)
        const buildDirectory = path.dirname(sourceDirectory)
        const artifactsDirectory = path.join(workspaceDirectory, artifactsRelativeDirectory)

        const file = path.join(sourceDirectory, "debian/changelog")
        const changelog = await firstline(file)
        const regex = /^(?<package>.+) \(((?<epoch>[0-9]+):)?(?<version>[^:-]+)(-(?<revision>[^:-]+))?\) (?<distribution>.+);/
        const match = changelog.match(regex)
        const { package, epoch, version, revision, distribution } = match.groups
        const os = await getOS(getDistribution(distribution))
        const container = package
        const image = os + ":" + getDistribution(distribution)

        fs.mkdirSync(artifactsDirectory, { recursive: true })

        async function runDockerExecStep(title, commandParams) {
            core.startGroup(title)
            await exec.exec("docker", [
                "exec",
                container
            ].concat(commandParams))
            core.endGroup()
        }

        core.startGroup("Print details")
        const details = {
            package: package,
            epoch: epoch,
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
            "--env", "DH_VERBOSE=1",
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
            runDockerExecStep("Create tarball", [
                "tar",
                "--exclude-vcs",
                "--exclude", "./debian",
                "--transform", `s/^\./${package}-${version}/`,
                "-cvzf", `${buildDirectory}/${package}_${version}.orig.tar.gz`,
                "-C", sourceDirectory,
                "./"
            ])
        }

        if (targetArchitectures.length != 0) {
            for (targetArchitecture in targetArchitectures) {
                runDockerExecStep(
                    "Add target architecture: " + targetArchitecture,
                    ["dpkg", "--add-architecture", targetArchitecture]
                )
            }
        }

        runDockerExecStep(
            "Update packages list",
            ["apt-get", "update"]
        )

        function getDevPackages() {
            devPackages = [
                // General packaging stuff
                "dpkg-dev",
                "debhelper",
                "lintian"
            ]

            // Used by pybuild
            for (targetArchitecture in targetArchitectures) {
                devPackages.concat("libpython3.7-minimal:" + targetArchitecture)
            }

            return devPackages
        }
        runDockerExecStep(
            "Install development packages",
            [
                "apt-get", "install", "--no-install-recommends", "-y"
            ].concat(getDevPackages())
        )

        runDockerExecStep(
            "Install build dependencies",
            ["apt-get", "build-dep", "-y", sourceDirectory]
        )

        for (targetArchitecture in targetArchitectures) {
            runDockerExecStep(
                "Build package for architecture: " + targetArchitecture,
                [
                    "dpkg-buildpackage",
                    "-a" + targetArchitecture
                ].concat(dpkgBuildPackageOpts)
            )
        }

        runDockerExecStep(
            "Run static analysis",
            ["lintian"].concat(lintianOpts)
        )

        runDockerExecStep(
            "Move artifacts",
            [
                "find",
                buildDirectory,
                "-maxdepth", "1",
                "-name", `*${version}*.*`,
                "-type", "f",
                "-print",
                "-exec", "mv", "{}", artifactsDirectory, ";"
            ]
        )
    } catch (error) {
        core.setFailed(error.message)
    }
}

main()
