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
        try {
            await exec.exec("skopeo", [
                "inspect",
                "--no-tags",
                "--no-creds",
                `docker://docker.io/library/${image}:${tag}`
            ])
            return image
        } catch {
            continue
        }
    }
}

async function main() {
    try {
        const cpuArchitecture = core.getInput("cpu_architecture") || "amd64"
        const sourceRelativeDirectory = core.getInput("source_directory") || "./"
        const artifactsRelativeDirectory = core.getInput("artifacts_directory") || "./"
        const osDistribution = core.getInput("os_distribution") || ""

        const workspaceDirectory = process.cwd()
        const sourceDirectory = path.join(workspaceDirectory, sourceRelativeDirectory)
        const buildDirectory = path.dirname(sourceDirectory)
        const artifactsDirectory = path.join(workspaceDirectory, artifactsRelativeDirectory)

        const file = path.join(sourceDirectory, "debian/changelog")
        const changelog = await firstline(file)
        const regex = /^(?<pkg>.+) \(((?<epoch>[0-9]+):)?(?<version>[^:-]+)(-(?<revision>[^:-]+))?\) (?<packageDistribution>.+);/
        const match = changelog.match(regex)
        const { pkg, epoch, version, revision, packageDistribution } = match.groups
        const distribution = osDistribution ? osDistribution : packageDistribution
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
            arch: cpuArchitecture,
            image: image,
            container: container,
            workspaceDirectory: workspaceDirectory,
            sourceDirectory: sourceDirectory,
            buildDirectory: buildDirectory,
            artifactsDirectory: artifactsDirectory
        }
        console.log(details)
        core.endGroup()

        if (cpuArchitecture != "amd64") {
            core.startGroup("Install QEMU")
            // Need newer QEMU to avoid errors
            await exec.exec("wget", ["http://mirrors.kernel.org/ubuntu/pool/universe/q/qemu/qemu-user-static_6.2+dfsg-2ubuntu6_amd64.deb", "-O", "/tmp/qemu.deb"])
            await exec.exec("sudo", ["dpkg", "-i", "/tmp/qemu.deb"])
            core.endGroup()
        }

        core.startGroup("Create container")
        await exec.exec("docker", [
            "create",
            "--platform", `linux/${cpuArchitecture}`,
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
        core.saveState("container", container)
        core.endGroup()

        core.startGroup("Start container")
        await exec.exec("docker", [
            "start",
            container
        ])
        core.endGroup()

        core.startGroup("Prepare environment")
        await exec.exec("docker", [
            "exec",
            container,
            "bash", "-c", "echo 'APT::Get::Assume-Yes \"true\";' > /etc/apt/apt.conf.d/00noconfirm"
        ])
        await exec.exec("docker", [
            "exec",
            container,
            "bash", "-c", "echo debconf debconf/frontend select Noninteractive | debconf-set-selections"
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
            "apt-get", "install", "-yq", "-t", imageTag, "dpkg-dev", "debhelper", "devscripts"
        ])
        core.endGroup()

        if (imageTag != "trusty") {
            core.startGroup("Install build dependencies")
            await exec.exec("docker", [
                "exec",
                container,
                "apt-get", "build-dep", "-yq", "-t", imageTag, sourceDirectory
            ])
            core.endGroup()
        }

        if (revision) {
            core.startGroup("Create tarball")
            await exec.exec("docker", [
                "exec",
                container,
                "git-deborig",
                "HEAD"
            ])
            core.endGroup()
        }

        core.startGroup("Build packages")
        await exec.exec("docker", [
            "exec",
            container,
            "dpkg-buildpackage"
        ])
        core.endGroup()

        core.startGroup("Install built packages")
        await exec.exec("docker", [
            "exec",
            container,
            "debi", "--with-depends"
        ])
        core.endGroup()

        core.startGroup("List packages contents")
        await exec.exec("docker", [
            "exec",
            container,
            "debc"
        ])
        core.endGroup()

        core.startGroup("Move build artifacts")
        await exec.exec("docker", [
            "exec",
            container,
            "find",
            buildDirectory,
            "-maxdepth", "1",
            "-name", `*${version}*.*`,
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
