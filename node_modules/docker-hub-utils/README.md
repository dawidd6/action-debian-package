<p align="center">
  <a href="https://github.com/jessestuart/docker-hub-utils">
    <img
      src="https://github.com/jessestuart/docker-hub-utils/blob/master/assets/nodejs-docker.png?raw=true"
      width="50%"
    />
  </a>
</p>
<h1 align="center">
  docker-hub-utils
</h1>

[![CircleCI][circleci-badge]][circleci-link] [![npm][npm-badge]][npm-link]
[![codecov][codecov]][codecov 2]

### What is this?

`docker-hub-utils` is an [NPM package][npm-link] (packaged to work both in
`node.js` as well as in the browser), providing utility functions wrapping the
[Docker Hub API][docker 2]. This was created because the native API provides
little to no support for basic operations like filtering queries, and can be
quite verbose when e.g., fetching [Manifest Lists][docker], which is required to
determine which architectures a given image supports.

---

### Currently supported operations

- Querying top repos by username / organization name.
- Filtering top user / org repositories by date last updated; this is useful
  when you're only interested in repositories that have been updated in the past
  `N` months / years / etc, a feature missing from the native API.
- Fetching Manifest Lists for any repository image in a single function call,
  abstracting away the bearer token authentication dance.

You can see examples of these operations in use within the
[`docker-hub-graphql-api`][github 2] project, or in this project's test cases.

[circleci-badge]:
  https://circleci.com/gh/jessestuart/docker-hub-utils.svg?style=shield
[circleci-link]: https://circleci.com/gh/jessestuart/docker-hub-utils
[codecov 2]: https://codecov.io/gh/jessestuart/docker-hub-utils
[codecov]:
  https://codecov.io/gh/jessestuart/docker-hub-utils/branch/master/graph/badge.svg
[docker 2]: https://docs.docker.com/registry/spec/api/
[docker]: https://docs.docker.com/registry/spec/manifest-v2-2/
[github 2]: https://github.com/jessestuart/docker-hub-graphql-api
[github]: https://github.com/jessestuart/multiar.ch
[npm-badge]: https://img.shields.io/npm/v/docker-hub-utils.svg
[npm-link]: https://www.npmjs.com/package/docker-hub-utils
