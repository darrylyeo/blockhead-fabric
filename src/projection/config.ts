import type { ProjectionConfig } from './types.js'

const getEnv = (name: string, fallback?: string) => {
	const value = process.env[name] ?? fallback

	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`)
	}

	return value
}

const getEnvNumber = (name: string, fallback: number) => {
	const raw = process.env[name]

	return !raw ?
		fallback
	: Number.isFinite(Number(raw)) ?
		Number(raw)
	:
		(() => {
			throw new Error(`Invalid number for environment variable: ${name}`)
		})()
}

const getEnvBigInt = (name: string, fallback: bigint) => {
	const raw = process.env[name]

	try {
		return raw ? BigInt(raw) : fallback
	} catch {
		throw new Error(`Invalid bigint for environment variable: ${name}`)
	}
}

export const loadProjectionConfig = (): ProjectionConfig => ({
	databaseUrl: getEnv('DATABASE_URL'),
	chainId: getEnvBigInt('CHAIN_ID', 1n),
	projectionPollIntervalMs: getEnvNumber('PROJECTION_POLL_INTERVAL_MS', 1000),
	spineRecentBlockCount: getEnvNumber('SPINE_RECENT_BLOCK_COUNT', 256),
	maxTxPulsesPerBlock: getEnvNumber('MAX_TX_PULSES_PER_BLOCK', 24),
	spineBlockSpacing: getEnvNumber('SPINE_BLOCK_SPACING', 24),
	districtSpacing: getEnvNumber('DISTRICT_SPACING', 256),
	districtAtlasOffsetX: getEnvNumber('DISTRICT_ATLAS_OFFSET_X', 512),
	districtAtlasOffsetZ: getEnvNumber('DISTRICT_ATLAS_OFFSET_Z', 0),
	slotSpacing: getEnvNumber('SLOT_SPACING', 12),
	topContractLandmarksPerDistrict: getEnvNumber('TOP_CONTRACT_LANDMARKS_PER_DISTRICT', 8),
	projectionVersion: getEnvBigInt('PROJECTION_VERSION', 1n),
	districtAlgorithmVersion: getEnvBigInt('DISTRICT_ALGORITHM_VERSION', 1n),
	anchorAlgorithmVersion: getEnvBigInt('ANCHOR_ALGORITHM_VERSION', 1n),
	corridorAlgorithmVersion: getEnvBigInt('CORRIDOR_ALGORITHM_VERSION', 1n),
	surfaceAlgorithmVersion: getEnvBigInt('SURFACE_ALGORITHM_VERSION', 1n),
})
