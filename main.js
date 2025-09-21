const core = require("@actions/core")
const exec = require("@actions/exec")
const io = require('@actions/io')
const firstline = require("firstline")
const path = require("path")
const fs = require("fs")
const os = require('os');

// Map CPU architectures to qemu-user-static package suffixes
const hostArchMap = {
    x64: 'amd64',     // 64-bit Intel/AMD
    ia32: 'i386',     // 32-bit Intel
    arm: 'armhf',     // ARM hard float (32-bit)
    arm64: 'arm64',   // ARM 64-bit (aarch64)
    aarch64: 'arm64', // alias for arm64
    ppc64: 'ppc64',   // PowerPC 64-bit BE
    ppc64le: 'ppc64el', // PowerPC 64-bit LE
    s390: 's390',     // IBM System z 31-bit
    s390x: 's390x',   // IBM System z 64-bit
};
// List of qemu package-supported architectures
const qemuSupportedArchs = ['amd64', 'i386'];

const hostArchRaw = os.arch();  // e.g. 'x64', 'arm64', 'ia32', etc.
const hostArch = hostArchMap[hostArchRaw] || hostArchRaw;

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
    const skopeoPath = await io.which('skopeo', false)
    if (!skopeoPath) {
        core.startGroup("Install skopeo")
        await exec.exec("sudo", [
            "apt-get",
            "update"
        ])
        await exec.exec("sudo", [
            "apt-get",
            "-y",
            "install",
            "skopeo"
        ])
        core.endGroup()
    }
    const tag = getImageTag("", distribution)
    for (const image of ["debian", "ubuntu"]) {
        try {
            core.startGroup("Get image name")
            await exec.exec("skopeo", [
                "inspect",
                `docker://docker.io/library/${image}:${tag}`
            ])
            core.endGroup()
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
        const lintianOpts = core.getInput("lintian_opts") || ""
        const lintianRun = core.getBooleanInput('lintian_run') || false

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
            artifactsDirectory: artifactsDirectory,
            lintianOpts: lintianOpts,
            lintianRun: lintianRun
        }
        console.log(details)
        core.endGroup()

        core.info(`Host architecture detected: ${hostArch} (raw: ${hostArchRaw})`);
        core.info(`Target CPU architecture: ${cpuArchitecture}`);

        // Only install QEMU if host and target architectures differ
        if (cpuArchitecture !== hostArch) {
          // Check if the host architecture is supported by the QEMU package
          if (!qemuSupportedArchs.includes(hostArch)) {
            core.info(`QEMU package not available for host architecture (${hostArch}), skipping QEMU installation.`);
          } else {
            core.startGroup("Install QEMU");
            // Need newer QEMU to avoid errors
            await exec.exec("sudo", [
                "apt-get",
                "update"
            ])
            await exec.exec("sudo", [
                "apt-get",
                "-y",
                "install",
                "qemu-user-static"
            ])
            core.endGroup();
          }
        } else {
          // Skip QEMU installation if host and target architectures match
          core.info(`Host architecture (${hostArch}) matches target architecture (${cpuArchitecture}), skipping QEMU installation.`);
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

        // The goofy usage of "apt-get -t || apt-get" here is because
        // of github issue #63.
        //
        // When building on a "normal" release like "bullseye", the
        // debian container is generated with "bullseye-updates" enabled.
        // This can cause problems when specifying the target release as
        // `-t bullseye`.  For example, if "bullseye-updates" contains
        // a new version of libc6 and libc6-dev, then the image will
        // contain the updated libc6, but "apt-get -t bullseye" would try
        // to install the old version of libc6-dev.  Since libc6-dev has
        // a versioned dependency on the matching libc6, this will fail.
        //
        // On a backports release like "bullseye-backports", the
        // backports package archive has a lower priority than the
        // "parent" package archive.  When building in this situation
        // apt-get needs "-t" in order to raise the priority of the
        // backports packages so that they get installed, instead of
        // installing the older packages from the parent release.
        core.startGroup("Install development packages")
        await exec.exec("docker", [
            "exec",
            container,
            "bash", "-c",
            `apt-get install -yq -t '${imageTag}' dpkg-dev debhelper devscripts lintian || apt-get install -yq dpkg-dev debhelper devscripts lintian`
        ])
        core.endGroup()

        core.startGroup("Trust this git repo")
        await exec.exec("docker", [
            "exec",
            container,
            "git", "config", "--global", "--add", "safe.directory", sourceDirectory
        ])
        core.endGroup()

        if (imageTag != "trusty") {
            core.startGroup("Install build dependencies")
            await exec.exec("docker", [
                "exec",
                container,
                "bash", "-c",
                `apt-get build-dep -yq -t '${imageTag}' '${sourceDirectory}' || apt-get build-dep -yq '${sourceDirectory}'`
            ])
            core.endGroup()
        }

        if (revision) {
            core.startGroup("Create tarball")
            await exec.exec("docker", [
                "exec",
                container,
                "tar",
                "--exclude-vcs",
                "--exclude=debian",
                "--create",
                "--gzip",
                "--verbose",
                `--file=../${pkg}_${version}.orig.tar.gz`,
                "."
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

        if (lintianRun) {
            core.startGroup("Run static analysis")
            await exec.exec("docker", [
                "exec",
                container,
                "find",
                buildDirectory,
                "-maxdepth", "1",
                "-name", `*${version}*.changes`,
                "-type", "f",
                "-print",
                "-exec", "lintian", lintianOpts, "{}", "\+"
            ])
            core.endGroup()
        }

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
