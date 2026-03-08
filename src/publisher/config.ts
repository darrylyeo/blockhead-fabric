import type { PublisherConfig } from './types.js'

const getEnv = (name: string, fallback?: string) => {
	const value = process.env[name] ?? fallback

	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`)
	}

	return value
}

const getEnvNumber = (name: string, fallback: number) => {
	const raw = process.env[name]

	if (!raw) {
		return fallback
	}

	const value = Number(raw)

	if (!Number.isFinite(value)) {
		throw new Error(`Invalid number for environment variable: ${name}`)
	}

	return value
}

export const loadPublisherConfig = (): PublisherConfig => ({
	databaseUrl: getEnv('DATABASE_URL'),
	fabricUrl: getEnv('FABRIC_URL', 'http://localhost:2000/fabric'),
	fabricAdminKey: process.env.FABRIC_ADMIN_KEY,
	publisherPollIntervalMs: getEnvNumber('PUBLISHER_POLL_INTERVAL_MS', 2000),
	publisherConnectTimeoutMs: getEnvNumber('PUBLISHER_CONNECT_TIMEOUT_MS', 60000),
	publisherScopeConcurrency: getEnvNumber('PUBLISHER_SCOPE_CONCURRENCY', 1),
	publisherObjectBatchSize: getEnvNumber('PUBLISHER_OBJECT_BATCH_SIZE', 50),
})
