# Beale Sandbox Toolchain Image

This local OCI/Docker image is a guest tool bundle for Beale's Docker sandbox backend. It is not the trusted harness.

Build it locally:

```sh
docker build -t beale-sandbox-toolchain:local docker/sandbox-toolchain
```

Beale uses `beale-sandbox-toolchain:local` by default. Set `BEALE_DOCKER_IMAGE` to use a different local or remote image.
