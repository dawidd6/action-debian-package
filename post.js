import * as core from "@actions/core"
import * as exec from "@actions/exec"

async function main() {
    try {
        const container = core.getState("container")
        core.saveState("container", "")

        if (container) {
            await exec.exec("docker", [
                "rm",
                "--force",
                container
            ])
        }
    } catch (error) {
        core.setFailed(error.message)
    }
}

main()
