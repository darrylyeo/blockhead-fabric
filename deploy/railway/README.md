# Railway Deployment

This repo deploys cleanly to Railway-style platforms as multiple services from one repository.

## Services

Create these services:

1. `postgres`
2. `mysql`
3. `fabric-server`
4. `blockhead-migrate`
5. `blockhead-ingest`
6. `blockhead-projection`
7. `blockhead-publisher`

## `fabric-server`

Use the `src/fabric-server` directory as the Railway service root so its existing `Dockerfile` is used directly.

Set these variables:

- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `MVSF_KEY`
- `MVSF_COMPANY_ID` (optional)

Notes:

- The entrypoint now auto-detects Railway's `PORT`.
- If `RAILWAY_PUBLIC_DOMAIN` is present, it is used as the default public WAN host.
- The default WAN port becomes `443` on Railway unless `MVSF_WAN_PORT` is set explicitly.

## Blockhead worker services

Use the repository root as the service root. The root `Dockerfile` runs `scripts/start-service.sh`, which starts the command in `SERVICE_SCRIPT`.

Shared variables for all blockhead worker services:

- `DATABASE_URL`
- `CHAIN_ID` (optional, defaults to `1`)

Extra variables by service:

- `blockhead-migrate`: no extra required variables beyond `DATABASE_URL`
- `blockhead-ingest`: `RPC_WSS_URL`
- `blockhead-projection`: no extra required variables beyond `DATABASE_URL`
- `blockhead-publisher`: `FABRIC_URL`, `FABRIC_ADMIN_KEY` if the Fabric server requires login

Recommended `SERVICE_SCRIPT` values:

- `blockhead-migrate`: `service:db:migrate`
- `blockhead-ingest`: `service:chain:ingest`
- `blockhead-projection`: `service:projection`
- `blockhead-publisher`: `service:publish:fabric`

Optional:

- Set `RUN_MIGRATIONS=1` on a worker if you want it to run `service:db:migrate` before its main process.

## Wiring

Use the Railway Postgres connection string for `DATABASE_URL`.

Point `FABRIC_URL` at the public Fabric descriptor endpoint, for example:

```text
https://<fabric-server-domain>/fabric
```

Point the Fabric server's MySQL variables at the Railway MySQL service.
