# Build Debian package Github Action

An action that builds a Debian package from source in a Docker container.

## Usage

```yaml
- name: Build Debian package
  uses: dawidd6/action-debian-package@v1
  with:
    source_directory: lolcat # optional, relative to workspace directory
    artifacts_directory: output # optional, relative to workspace directory
```
