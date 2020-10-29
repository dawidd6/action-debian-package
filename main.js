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
        const getDevPackagesFromBackports = (core.getInput("get_dev_packages_from_backports") == "1") || 0

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

        //////////////////////////////////////
        // Print details
        //////////////////////////////////////
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

        //////////////////////////////////////
        // Create and start container
        //////////////////////////////////////
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

        //////////////////////////////////////
        // Create tarball of source if package is revision of upstream
        //////////////////////////////////////
        if (revision) {
            core.startGroup("Create tarball")
            await exec.exec("docker", ["exec", container].concat(
                [
                    "tar",
                    "--exclude-vcs",
                    "--exclude", "./debian",
                    "--transform", `s/^\./${package}-${version}/`,
                    "-cvzf", `${buildDirectory}/${package}_${version}.orig.tar.gz`,
                    "-C", sourceDirectory,
                    "./"
                ]
            ))
            core.endGroup()
        }

        //////////////////////////////////////
        // Add target architectures
        //////////////////////////////////////
        if (targetArchitectures.length != 0) {
            for (const targetArchitecture of targetArchitectures) {
                core.startGroup("Add target architecture: " + targetArchitecture)
                await exec.exec("docker", ["exec", container].concat(
                    ["dpkg", "--add-architecture", targetArchitecture]
                ))
                core.endGroup()
            }
        }

        //////////////////////////////////////
        // Update packages list
        //////////////////////////////////////
        if (getDevPackagesFromBackports) {
            core.startGroup("Add backports repo to apt sources")
            await exec.exec("docker", ["exec", container].concat(
                ["bash", "-c"].concat(
                    [
                        "echo 'deb http://deb.debian.org/debian " + distribution + "-backports main' > /etc/apt/sources.list.d/" + distribution + "-backports.list"
                    ]
                )
            ))
            core.endGroup()
        }

        core.startGroup("Update packages list")
        await exec.exec("docker", ["exec", container].concat(
            ["apt-get", "update"]
        ))
        core.endGroup()

        //////////////////////////////////////
        // Install required packages
        //////////////////////////////////////
        function getDevPackages() {
            devPackages = [
                // General packaging stuff
                "dpkg-dev",
                "debhelper",
                "lintian"
            ]

            // Used by pybuild
            const libPythonPackages = targetArchitectures.map(targetArchitecture => {
                return "libpython3.7-minimal:" + targetArchitecture
            })

            return devPackages.concat(libPythonPackages)
        }

        function getAptInstallCommand() {
            setDistroFields = []
            if (getDevPackagesFromBackports) {
                setDistroFields = ["-t", distribution + "-backports"]
            }
            return ["apt-get", "install"]
                .concat(setDistroFields)
                .concat(
                    ["--no-install-recommends", "-y"]
                )
        }

        core.startGroup("Install development packages")
        await exec.exec("docker", ["exec", container].concat(
            getAptInstallCommand().concat(getDevPackages())
        ))
        core.endGroup()

        core.startGroup("Install build dependencies")
        await exec.exec("docker", ["exec", container].concat(
            ["apt-get", "build-dep", "-y", sourceDirectory]
        ))
        core.endGroup()

        //////////////////////////////////////
        // Build package and run static analysis for all architectures
        //////////////////////////////////////
        for (const targetArchitecture of targetArchitectures) {
            core.startGroup("Build package for architecture: " + targetArchitecture)
            await exec.exec("docker", ["exec", container].concat(
                [
                    "dpkg-buildpackage",
                    "-a" + targetArchitecture
                ].concat(dpkgBuildPackageOpts)
            ))
            core.endGroup()

            core.startGroup("Run static analysis")
            await exec.exec("docker", ["exec", container].concat(
                [
                    "find",
                    buildDirectory,
                    "-maxdepth", "1",
                    "-name", `*${targetArchitecture}.changes`,
                    "-type", "f",
                    "-print",
                    "-exec"
                ]).concat(["lintian"]).concat(lintianOpts).concat(["{}", ";"]
            ))
            core.endGroup()
        }

        //////////////////////////////////////
        // Move artifacts
        //////////////////////////////////////
        core.startGroup("Move artifacts")
        await exec.exec("docker", ["exec", container].concat(
            [
                "find",
                buildDirectory,
                "-maxdepth", "1",
                "-name", `*${version}*.*`,
                "-type", "f",
                "-print",
                "-exec", "mv", "{}", artifactsDirectory, ";"
            ]
        ))
        core.endGroup()
    } catch (error) {
        core.setFailed(error.message)
    }
}

main()
