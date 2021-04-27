# Build Debian package Github Action

An action that builds a Debian package from source in a Docker container.

## Usage

```yaml
- name: Build Debian package
  uses: dawidd6/action-debian-package@v1
  with:
    # Optional, relative to workspace directory
    source_directory: lolcat
    # Optional, relative to workspace directory
    artifacts_directory: output
    os_distribution: bionic
    # Optional, value from `debian/changelog` is used if not defined
```
