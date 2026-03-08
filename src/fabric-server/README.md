# Fabric Server

This directory vendors the local Docker wrapper used to run the upstream RP1-compatible Fabric server for development.

## Quick start

1. Copy `src/fabric-server/.env.example` to `src/fabric-server/.env`.
2. Run `pnpm service:fabric:up` from the `blockhead-fabric` root.
3. Open `http://localhost:2000/fabric/70/1/`.

The container still builds from the upstream `MSF_Map_Svc` repository, but the local compose, entrypoint, and MySQL bootstrap files now live inside `blockhead-fabric` so this project can start its own Fabric server without the separate `spatial-fabric-service` directory.

Use the explicit `RMRoot` descriptor path for local blockhead work. Bare `/fabric/` is upstream-defined and can point at a sample object rather than the chain-world root.
