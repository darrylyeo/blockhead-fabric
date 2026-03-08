import type { IngestCheckpoint } from '../shared/types.js'

export const getDeepReorgRestartBlock = ({
	checkpoint,
	ingestStartBlock,
	fallbackDistance,
}: {
	checkpoint: IngestCheckpoint | null
	ingestStartBlock: bigint
	fallbackDistance: bigint
}) => (
	!checkpoint ?
		ingestStartBlock
	: checkpoint.lastFinalizedBlockNumber > 0n ?
		checkpoint.lastFinalizedBlockNumber
	: checkpoint.lastSeenBlockNumber > fallbackDistance ?
		checkpoint.lastSeenBlockNumber - fallbackDistance
	:
		ingestStartBlock
)
