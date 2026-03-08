import type { PoolClient, QueryResultRow } from 'pg'

import type { Db, IngestCheckpoint, RpcCapabilities } from '../shared/types.js'

type Queryable = Db | PoolClient

const rowToCheckpoint = (row: QueryResultRow): IngestCheckpoint => ({
	chainId: BigInt(row.chain_id),
	lastSeenBlockNumber: BigInt(row.last_seen_block_number),
	lastSeenBlockHash: row.last_seen_block_hash,
	lastFinalizedBlockNumber: BigInt(row.last_finalized_block_number),
	updatedAt: row.updated_at,
})

export const getIngestCheckpoint = async ({
	db,
	chainId,
}: {
	db: Queryable
	chainId: bigint
}): Promise<IngestCheckpoint | null> => {
	const { rows } = await db.query(
		`
			select
				chain_id,
				last_seen_block_number,
				last_seen_block_hash,
				last_finalized_block_number,
				updated_at
			from ingest_checkpoints
			where chain_id = $1
		`,
		[
			chainId.toString(),
		],
	)

	return rows[0] ? rowToCheckpoint(rows[0]) : null
}

export const upsertRpcCapabilities = async ({
	db,
	capabilities,
}: {
	db: Queryable
	capabilities: RpcCapabilities
}) => {
	await db.query(
		`
			insert into rpc_capabilities (
				endpoint_id,
				chain_id,
				supports_block_receipts,
				supports_block_hash_logs,
				supports_safe_tag,
				supports_finalized_tag,
				checked_at,
				raw_json
			)
			values ($1, $2, $3, $4, $5, $6, $7, $8)
			on conflict (endpoint_id) do update set
				chain_id = excluded.chain_id,
				supports_block_receipts = excluded.supports_block_receipts,
				supports_block_hash_logs = excluded.supports_block_hash_logs,
				supports_safe_tag = excluded.supports_safe_tag,
				supports_finalized_tag = excluded.supports_finalized_tag,
				checked_at = excluded.checked_at,
				raw_json = excluded.raw_json
		`,
		[
			capabilities.endpointId,
			capabilities.chainId.toString(),
			capabilities.supportsBlockReceipts,
			capabilities.supportsBlockHashLogs,
			capabilities.supportsSafeTag,
			capabilities.supportsFinalizedTag,
			capabilities.checkedAt,
			JSON.stringify(capabilities.rawJson),
		],
	)
}
