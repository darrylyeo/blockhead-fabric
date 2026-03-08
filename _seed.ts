import { Pool } from 'pg'

const db = new Pool({
	connectionString: process.env.DATABASE_URL ?? 'postgres://blockhead:blockhead@localhost:5432/blockhead',
})

const blockHash = '0x' + 'a'.repeat(64)
const parentHash = '0x' + 'b'.repeat(64)
const txHash = '0x' + 'c'.repeat(64)
const fromAddr = '0x' + '1'.repeat(40)
const toAddr = '0x' + '2'.repeat(40)

await db.query('begin')
try {
	await db.query(
		`
		insert into blocks (
			chain_id, block_number, block_hash, parent_hash, timestamp,
			gas_used, gas_limit, tx_count, log_count, canonical, finality_state, first_seen_at
		)
		values (1, 21190000, $1, $2, now(), 0, 0, 1, 0, true, 'latest', now())
		on conflict (chain_id, block_hash) do nothing
		`,
		[blockHash, parentHash],
	)
	await db.query(
		`
		insert into transactions (
			chain_id, tx_hash, block_hash, block_number, tx_index,
			from_address, to_address, value_wei, type, gas_limit, canonical
		)
		values (1, $1, $2, 21190000, 0, $3, $4, 0, 0, 21000, true)
		on conflict (chain_id, tx_hash, block_hash) do nothing
		`,
		[txHash, blockHash, fromAddr, toAddr],
	)
	await db.query(
		`
		insert into receipts (
			chain_id, tx_hash, block_hash, block_number, transaction_index,
			gas_used, cumulative_gas_used, canonical
		)
		values (1, $1, $2, 21190000, 0, 21000, 21000, true)
		on conflict (chain_id, tx_hash, block_hash) do nothing
		`,
		[txHash, blockHash],
	)
	await db.query(
		`
		insert into ingest_checkpoints (chain_id, last_seen_block_number, last_seen_block_hash, last_finalized_block_number, updated_at)
		values (1, 21190000, $1, 21189836, now())
		on conflict (chain_id) do update set
			last_seen_block_number = excluded.last_seen_block_number,
			last_seen_block_hash = excluded.last_seen_block_hash,
			updated_at = excluded.updated_at
		`,
		[blockHash],
	)
	await db.query(
		`
		insert into projection_jobs (chain_id, from_block_number, to_block_number, status)
		values (1, 21190000, 21190000, 'pending')
		`,
	)
	await db.query('commit')
	console.log('Seeded block 21190000, tx, receipt, checkpoint, projection_job')
} catch (e) {
	await db.query('rollback')
	throw e
} finally {
	await db.end()
}
