#!/usr/bin/env sh
set -eu

SERVICE_SCRIPT="${SERVICE_SCRIPT:-}"

if [ -z "$SERVICE_SCRIPT" ]; then
	echo "Missing SERVICE_SCRIPT." >&2
	echo "Set SERVICE_SCRIPT to one of:" >&2
	echo "  service:db:migrate" >&2
	echo "  service:chain:ingest" >&2
	echo "  service:projection" >&2
	echo "  service:publish:fabric" >&2
	exit 1
fi

if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
	pnpm service:db:migrate
fi

exec pnpm "$SERVICE_SCRIPT"
