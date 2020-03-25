# Build Debian package Github Action

An action that builds a Debian package from source for specified distribution.

## Usage

```yaml
- name: Build Debian package
  uses: dawidd6/action-debian-package@master
  with:
    directory: lolcat # relative to PWD, defaults to PWD
    os: debian # or ubuntu, defaults to debian
```
