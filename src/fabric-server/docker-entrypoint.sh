#!/usr/bin/env sh
set -e

NODE_INTERNALPORT="${NODE_INTERNALPORT:-${PORT:-2000}}"
MVSF_WAN_HOST="${MVSF_WAN_HOST:-${RAILWAY_PUBLIC_DOMAIN:-localhost}}"

if [ -z "${MVSF_WAN_PORT:-}" ]; then
	if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
		MVSF_WAN_PORT=443
	else
		MVSF_WAN_PORT="${PORT:-2000}"
	fi
fi

# Generate settings.json from env so the upstream server
# stays configurable without editing the cloned source tree.
cat > settings.json << EOF
{
  "MVSF": {
    "IO": { "bGlobalNotify": true },
    "LAN": {
      "port": "${NODE_INTERNALPORT:-2000}",
      "SSL": {
        "bUseSSL": false,
        "key": "./ssl/server.key",
        "cert": "./ssl/server.cert"
      }
    },
    "WAN": {
      "host": "${MVSF_WAN_HOST:-localhost}",
      "port": "${MVSF_WAN_PORT:-2000}"
    },
    "key": "${MVSF_KEY:-changeme}",
    "sCompanyId": "${MVSF_COMPANY_ID:-}"
  },
  "SQL": {
    "type": "MYSQL",
    "config": {
      "connectionLimit": 10,
      "host": "${MYSQL_HOST:-mysql}",
      "port": "${MYSQL_PORT:-3306}",
      "user": "${MYSQL_USER:-map}",
      "password": "${MYSQL_PASSWORD:-mappass}",
      "database": "${MYSQL_DATABASE:-map_db}",
      "multipleStatements": true
    }
  }
}
EOF

MYSQL_HOST="${MYSQL_HOST:-mysql}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
until node -e "
const net = require('net');
const s = net.createConnection(process.env.MYSQL_PORT || 3306, process.env.MYSQL_HOST || 'mysql', () => { s.destroy(); process.exit(0); });
s.on('error', () => process.exit(1));
"; do
  echo 'Waiting for MySQL...'
  sleep 2
done

npm run install:svc
npm run install:sample

exec "$@"
