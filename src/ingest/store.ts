import { decimal, hex, timestampFromSeconds } from '../shared/encoding.js'
import { invalidateEventStreamEvents } from './eventStreamRunner.js'
import { describeBytecode, fetchCodeAtBlock } from './codeEnrichment.js'
import type { CanonicalBatch, CanonicalBlock, DbQuery, Eip1193Provider, IngestConfig, ReorgBatch, RpcCapabilities } from '../shared/types.js'

type Receipt = CanonicalBlock['receipts'][number]

const normalizeCanonicalBlock = (block: CanonicalBlock): CanonicalBlock => {
	if (block.header && block.body) {
		return block
	}

	const rpc = block as Record<string, unknown>
	const transactions = (
		block.body?.transactions
		?? (Array.isArray(rpc.transactions) ? rpc.transactions : [])
	) as CanonicalBlock['body']['transactions']

	return {
		...block,
		header: {
			number: typeof rpc.number === 'bigint' ? rpc.number : BigInt(rpc.number as string),
			hash: rpc.hash,
			parentHash: rpc.parentHash,
			timestamp: typeof rpc.timestamp === 'bigint' ? rpc.timestamp : BigInt(rpc.timestamp as string),
			gasUsed: typeof rpc.gasUsed === 'bigint' ? rpc.gasUsed : BigInt(rpc.gasUsed as string),
			gasLimit: typeof rpc.gasLimit === 'bigint' ? rpc.gasLimit : BigInt(rpc.gasLimit as string),
			baseFeePerGas: rpc.baseFeePerGas == null ?
				undefined
			:
				typeof rpc.baseFeePerGas === 'bigint' ?
					rpc.baseFeePerGas
				:
					BigInt(rpc.baseFeePerGas as string),
		},
		body: {
			transactions,
		},
	} as CanonicalBlock
}

const enqueueProjectionJob = async ({
	db,
	chainId,
	fromBlockNumber,
	toBlockNumber,
	projectionJobCoalesceGap,
}: {
	db: DbQuery
	chainId: bigint
	fromBlockNumber: bigint
	toBlockNumber: bigint
	projectionJobCoalesceGap: number
}) => {
	const { rows } = await db.query(
		`
			select id, from_block_number, to_block_number
			from projection_jobs
			where chain_id = $1
				and status = 'pending'
				and from_block_number <= $3 + $4
				and to_block_number >= $2 - $4
			order by from_block_number asc
			limit 1
		`,
		[
			chainId.toString(),
			fromBlockNumber.toString(),
			toBlockNumber.toString(),
			projectionJobCoalesceGap,
		],
	)

	const existingRow = rows[0]

	if (!existingRow) {
		await db.query(
			`
				insert into projection_jobs (
					chain_id,
					from_block_number,
					to_block_number,
					status
				)
				values ($1, $2, $3, 'pending')
			`,
			[
				chainId.toString(),
				fromBlockNumber.toString(),
				toBlockNumber.toString(),
			],
		)
		return
	}

	await db.query(
		`
			update projection_jobs
			set
				from_block_number = least(from_block_number, $2),
				to_block_number = greatest(to_block_number, $3)
			where id = $1
		`,
		[
			existingRow.id,
			fromBlockNumber.toString(),
			toBlockNumber.toString(),
		],
	)
}

const upsertBlock = async ({
	db,
	chainId,
	block,
}: {
	db: DbQuery
	chainId: bigint
	block: CanonicalBlock
}) => {
	await db.query(
		`
			insert into blocks (
				chain_id,
				block_number,
				block_hash,
				parent_hash,
				timestamp,
				gas_used,
				gas_limit,
				base_fee_per_gas,
				tx_count,
				log_count,
				canonical,
				finality_state,
				first_seen_at
			)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, 'latest', now())
			on conflict (chain_id, block_hash) do update set
				block_number = excluded.block_number,
				parent_hash = excluded.parent_hash,
				timestamp = excluded.timestamp,
				gas_used = excluded.gas_used,
				gas_limit = excluded.gas_limit,
				base_fee_per_gas = excluded.base_fee_per_gas,
				tx_count = excluded.tx_count,
				log_count = excluded.log_count,
				canonical = true,
				finality_state = 'latest'
		`,
		[
			chainId.toString(),
			block.header.number.toString(),
			hex(block.hash),
			hex(block.header.parentHash),
			timestampFromSeconds(block.header.timestamp),
			decimal(block.header.gasUsed),
			decimal(block.header.gasLimit),
			decimal(block.header.baseFeePerGas),
			block.body.transactions.length,
			block.receipts.reduce((count, receipt) => (
				count + receipt.logs.length
			), 0),
		],
	)
}

const upsertTransaction = async ({
	db,
	chainId,
	block,
	transactionIndex,
	receipt,
}: {
	db: DbQuery
	chainId: bigint
	block: CanonicalBlock
	transactionIndex: number
	receipt: Receipt
}) => {
	const transaction = block.body.transactions[transactionIndex]

	await db.query(
		`
			insert into transactions (
				chain_id,
				tx_hash,
				block_hash,
				block_number,
				tx_index,
				from_address,
				to_address,
				contract_address_created,
				value_wei,
				type,
				gas_limit,
				max_fee_per_gas,
				max_priority_fee_per_gas,
				canonical
			)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true)
			on conflict (chain_id, tx_hash, block_hash) do update set
				block_number = excluded.block_number,
				tx_index = excluded.tx_index,
				from_address = excluded.from_address,
				to_address = excluded.to_address,
				contract_address_created = excluded.contract_address_created,
				value_wei = excluded.value_wei,
				type = excluded.type,
				gas_limit = excluded.gas_limit,
				max_fee_per_gas = excluded.max_fee_per_gas,
				max_priority_fee_per_gas = excluded.max_priority_fee_per_gas,
				canonical = true
		`,
		[
			chainId.toString(),
			hex(receipt.transactionHash),
			hex(block.hash),
			block.header.number.toString(),
			transactionIndex,
			hex(receipt.from),
			receipt.to ? hex(receipt.to) : null,
			receipt.contractAddress ? hex(receipt.contractAddress) : null,
			decimal(transaction.value),
			transaction.type,
			decimal(
				(transaction as { gas?: unknown, gasLimit?: unknown }).gas
				?? (transaction as { gasLimit?: unknown }).gasLimit
				?? receipt.gasUsed
			),
			'maxFeePerGas' in transaction ? decimal(transaction.maxFeePerGas) : null,
			'maxPriorityFeePerGas' in transaction ? decimal(transaction.maxPriorityFeePerGas) : null,
		],
	)
}

const upsertReceipt = async ({
	db,
	chainId,
	block,
	receipt,
}: {
	db: DbQuery
	chainId: bigint
	block: CanonicalBlock
	receipt: Receipt
}) => {
	await db.query(
		`
			insert into receipts (
				chain_id,
				tx_hash,
				block_hash,
				block_number,
				transaction_index,
				gas_used,
				cumulative_gas_used,
				effective_gas_price,
				contract_address,
				status,
				canonical
			)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
			on conflict (chain_id, tx_hash, block_hash) do update set
				block_number = excluded.block_number,
				transaction_index = excluded.transaction_index,
				gas_used = excluded.gas_used,
				cumulative_gas_used = excluded.cumulative_gas_used,
				effective_gas_price = excluded.effective_gas_price,
				contract_address = excluded.contract_address,
				status = excluded.status,
				canonical = true
		`,
		[
			chainId.toString(),
			hex(receipt.transactionHash),
			hex(block.hash),
			block.header.number.toString(),
			receipt.transactionIndex,
			decimal(receipt.gasUsed),
			decimal(receipt.cumulativeGasUsed),
			decimal(receipt.effectiveGasPrice),
			receipt.contractAddress ? hex(receipt.contractAddress) : null,
			receipt.status ?? null,
		],
	)
}

const upsertLogs = async ({
	db,
	chainId,
	block,
	receipt,
}: {
	db: DbQuery
	chainId: bigint
	block: CanonicalBlock
	receipt: Receipt
}) => {
	for (const [logIndex, log] of receipt.logs.entries()) {
		await db.query(
			`
				insert into logs (
					chain_id,
					block_hash,
					block_number,
					tx_hash,
					log_index,
					address,
					topic0,
					topic1,
					topic2,
					topic3,
					data,
					removed,
					canonical
				)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, true)
				on conflict (chain_id, tx_hash, log_index, block_hash) do update set
					block_number = excluded.block_number,
					address = excluded.address,
					topic0 = excluded.topic0,
					topic1 = excluded.topic1,
					topic2 = excluded.topic2,
					topic3 = excluded.topic3,
					data = excluded.data,
					removed = false,
					canonical = true
			`,
			[
				chainId.toString(),
				hex(block.hash),
				block.header.number.toString(),
				hex(receipt.transactionHash),
				(() => {
					const raw = log.logIndex ?? logIndex
					const n = typeof raw === 'number' ? raw : Number(BigInt(raw))
					return n >= -0x8000_0000 && n <= 0x7fff_ffff ? n : logIndex
				})(),
				hex(log.address),
				log.topics[0] ? hex(log.topics[0]) : null,
				log.topics[1] ? hex(log.topics[1]) : null,
				log.topics[2] ? hex(log.topics[2]) : null,
				log.topics[3] ? hex(log.topics[3]) : null,
				hex(log.data),
			],
		)
	}
}

const upsertAccountsAndContracts = async ({
	db,
	provider,
	chainId,
	blockNumber,
	receipt,
}: {
	db: DbQuery
	provider?: Eip1193Provider
	chainId: bigint
	blockNumber: bigint
	receipt: Receipt
}) => {
	const touchedAddresses = [
		{
			address: hex(receipt.from),
			isContract: false,
		},
		...(
			receipt.to ?
				[
					{
						address: hex(receipt.to),
						isContract: false,
					},
				]
			:
				[]
		),
		...receipt.logs.map((log) => ({
			address: hex(log.address),
			isContract: true,
		})),
		...(
			receipt.contractAddress ?
				[
					{
						address: hex(receipt.contractAddress),
						isContract: true,
					},
				]
			:
				[]
		),
	]
	const enrichedAddresses = await Promise.all(
		[
			...new Map(
				touchedAddresses.map((value) => (
					[
						value.address,
						value,
					]
				)),
			).values(),
		].map(async ({ address, isContract }) => {
			const codeDescription = provider ?
				describeBytecode(await fetchCodeAtBlock({
					provider,
					address,
					blockNumber,
				}))
			:
				{
					isContract: false,
					codeHash: null,
					bytecodeSize: null,
				}

			return {
				address,
				isContract: isContract || codeDescription.isContract,
				codeHash: codeDescription.codeHash,
				bytecodeSize: codeDescription.bytecodeSize,
			}
		}),
	)

	for (const { address, isContract, codeHash } of enrichedAddresses) {
		await db.query(
			`
				insert into accounts (
					chain_id,
					address,
					first_seen_block,
					last_seen_block,
					is_contract,
					code_hash,
					last_balance_wei,
					last_nonce
				)
				values ($1, $2, $3, $4, $5, $6, null, null)
				on conflict (chain_id, address) do update set
					last_seen_block = excluded.last_seen_block,
					is_contract = accounts.is_contract or excluded.is_contract,
					code_hash = coalesce(excluded.code_hash, accounts.code_hash)
			`,
			[
				chainId.toString(),
				address,
				blockNumber.toString(),
				blockNumber.toString(),
				isContract,
				codeHash,
			],
		)
	}

	if (!receipt.contractAddress) {
		return
	}

	const contractAddress = hex(receipt.contractAddress)
	const contractDetails = enrichedAddresses.find(({ address }) => (
		address === contractAddress
	))

	await db.query(
		`
			insert into contracts (
				chain_id,
				address,
				creation_tx_hash,
				creation_block_number,
				code_hash,
				bytecode_size,
				family_label,
				metadata_json
			)
			values ($1, $2, $3, $4, $5, $6, null, '{}')
			on conflict (chain_id, address) do update set
				creation_tx_hash = coalesce(contracts.creation_tx_hash, excluded.creation_tx_hash),
				creation_block_number = coalesce(contracts.creation_block_number, excluded.creation_block_number),
				code_hash = coalesce(excluded.code_hash, contracts.code_hash),
				bytecode_size = coalesce(excluded.bytecode_size, contracts.bytecode_size)
		`,
		[
			chainId.toString(),
			contractAddress,
			hex(receipt.transactionHash),
			blockNumber.toString(),
			contractDetails?.codeHash ?? null,
			contractDetails?.bytecodeSize ?? null,
		],
	)
}

export const applyCanonicalBatch = async ({
	db,
	config,
	batch,
	provider,
}: {
	db: DbQuery
	config: IngestConfig
	batch: CanonicalBatch
	provider?: Eip1193Provider
}) => {
	if (batch.blocks.length === 0) {
		return
	}

	for (const rawBlock of batch.blocks) {
		const block = normalizeCanonicalBlock(rawBlock)

		await upsertBlock({
			db,
			chainId: config.chainId,
			block,
		})

		for (const [transactionIndex, receipt] of block.receipts.entries()) {
			await upsertTransaction({
				db,
				chainId: config.chainId,
				block,
				transactionIndex,
				receipt,
			})
			await upsertReceipt({
				db,
				chainId: config.chainId,
				block,
				receipt,
			})
			await upsertLogs({
				db,
				chainId: config.chainId,
				block,
				receipt,
			})
			await upsertAccountsAndContracts({
				db,
				provider,
				chainId: config.chainId,
				blockNumber: block.header.number,
				receipt,
			})
		}
	}

	const lastBlock = batch.blocks.at(-1) ? normalizeCanonicalBlock(batch.blocks.at(-1) as CanonicalBlock) : undefined

	if (!lastBlock) {
		return
	}

	await db.query(
		`
			insert into ingest_checkpoints (
				chain_id,
				last_seen_block_number,
				last_seen_block_hash,
				last_finalized_block_number,
				updated_at
			)
			values ($1, $2, $3, 0, now())
			on conflict (chain_id) do update set
				last_seen_block_number = excluded.last_seen_block_number,
				last_seen_block_hash = excluded.last_seen_block_hash,
				updated_at = now()
		`,
		[
			config.chainId.toString(),
			lastBlock.header.number.toString(),
			hex(lastBlock.hash),
		],
	)

	await enqueueProjectionJob({
		db,
		chainId: config.chainId,
		fromBlockNumber: batch.blocks[0].header.number,
		toBlockNumber: lastBlock.header.number,
		projectionJobCoalesceGap: config.projectionJobCoalesceGap,
	})
}

export const handleReorg = async ({
	db,
	config,
	reorg,
}: {
	db: DbQuery
	config: IngestConfig
	reorg: ReorgBatch
}) => {
	await db.query(
		`
			insert into reorg_events (
				chain_id,
				common_ancestor_number,
				common_ancestor_hash,
				removed_count,
				detected_at,
				metadata_json
			)
			values ($1, $2, $3, $4, now(), $5)
		`,
		[
			config.chainId.toString(),
			reorg.commonAncestor.number.toString(),
			hex(reorg.commonAncestor.hash),
			reorg.removed.length,
			JSON.stringify({
				chainHead: reorg.metadata.chainHead.toString(),
				removed: reorg.removed.map((block) => ({
					number: block.number.toString(),
					hash: hex(block.hash),
				})),
			}),
		],
	)

	for (const block of reorg.removed) {
		await db.query(
			`
				update blocks
				set canonical = false, finality_state = 'latest'
				where chain_id = $1 and block_hash = $2
			`,
			[
				config.chainId.toString(),
				hex(block.hash),
			],
		)

		await db.query(
			`
				update transactions
				set canonical = false
				where chain_id = $1 and block_hash = $2
			`,
			[
				config.chainId.toString(),
				hex(block.hash),
			],
		)

		await db.query(
			`
				update receipts
				set canonical = false
				where chain_id = $1 and block_hash = $2
			`,
			[
				config.chainId.toString(),
				hex(block.hash),
			],
		)

		await db.query(
			`
				update logs
				set canonical = false, removed = true
				where chain_id = $1 and block_hash = $2
			`,
			[
				config.chainId.toString(),
				hex(block.hash),
			],
		)
	}

	if (config.eventStreamErc20Enabled) {
		await invalidateEventStreamEvents({
			db: db as import('pg').PoolClient,
			chainId: config.chainId,
			blockHashes: reorg.removed.map((block) => hex(block.hash)),
		})
	}

	await applyCanonicalBatch({
		db,
		config,
		batch: {
			type: 'blocks',
			blocks: reorg.added,
			metadata: reorg.metadata,
		},
	})

	const newHead = reorg.added.at(-1)?.header.number ?? reorg.commonAncestor.number

	await enqueueProjectionJob({
		db,
		chainId: config.chainId,
		fromBlockNumber: reorg.commonAncestor.number + 1n,
		toBlockNumber: newHead,
		projectionJobCoalesceGap: config.projectionJobCoalesceGap,
	})
}

export const invalidateCanonicalRange = async ({
	db,
	config,
	fromBlockNumber,
}: {
	db: DbQuery
	config: IngestConfig
	fromBlockNumber: bigint
}) => {
	const previousCanonicalBlockResult = await db.query(
		`
			select block_number, block_hash
			from blocks
			where chain_id = $1 and canonical = true and block_number < $2
			order by block_number desc
			limit 1
		`,
		[
			config.chainId.toString(),
			fromBlockNumber.toString(),
		],
	)
	const previousCanonicalBlock = previousCanonicalBlockResult.rows[0]

	await db.query(
		`
			update logs
			set canonical = false, removed = true
			where chain_id = $1 and block_number >= $2 and canonical = true
		`,
		[
			config.chainId.toString(),
			fromBlockNumber.toString(),
		],
	)

	await db.query(
		`
			update receipts
			set canonical = false
			where chain_id = $1 and block_number >= $2 and canonical = true
		`,
		[
			config.chainId.toString(),
			fromBlockNumber.toString(),
		],
	)

	await db.query(
		`
			update transactions
			set canonical = false
			where chain_id = $1 and block_number >= $2 and canonical = true
		`,
		[
			config.chainId.toString(),
			fromBlockNumber.toString(),
		],
	)

	await db.query(
		`
			update blocks
			set canonical = false, finality_state = 'latest'
			where chain_id = $1 and block_number >= $2 and canonical = true
		`,
		[
			config.chainId.toString(),
			fromBlockNumber.toString(),
		],
	)

	if (
		previousCanonicalBlock
		&& (
			typeof previousCanonicalBlock.block_number === 'string'
			|| typeof previousCanonicalBlock.block_number === 'number'
			|| typeof previousCanonicalBlock.block_number === 'bigint'
		)
		&& typeof previousCanonicalBlock.block_hash === 'string'
	) {
		await db.query(
			`
				insert into ingest_checkpoints (
					chain_id,
					last_seen_block_number,
					last_seen_block_hash,
					last_finalized_block_number,
					updated_at
				)
				values ($1, $2, $3, $4, now())
				on conflict (chain_id) do update set
					last_seen_block_number = excluded.last_seen_block_number,
					last_seen_block_hash = excluded.last_seen_block_hash,
					last_finalized_block_number = least(ingest_checkpoints.last_finalized_block_number, excluded.last_seen_block_number),
					updated_at = now()
			`,
			[
				config.chainId.toString(),
				String(previousCanonicalBlock.block_number),
				previousCanonicalBlock.block_hash,
				String(previousCanonicalBlock.block_number),
			],
		)
		return
	}

	await db.query(
		`
			delete from ingest_checkpoints
			where chain_id = $1
		`,
		[
			config.chainId.toString(),
		],
	)
}

export const updateFinality = async ({
	db,
	config,
	capabilities,
	provider,
}: {
	db: DbQuery
	config: IngestConfig
	capabilities: RpcCapabilities
	provider: Eip1193Provider
}) => {
	const finalizedBlockNumber = (
		capabilities.supportsFinalizedTag ?
			await provider.request({
				method: 'eth_getBlockByNumber',
				params: ['finalized', false],
			})
		:
			null
	)
	const safeBlockNumber = (
		capabilities.supportsSafeTag ?
			await provider.request({
				method: 'eth_getBlockByNumber',
				params: ['safe', false],
			})
		:
			null
	)
	const currentHeadResult = await db.query(
		`
			select max(block_number) as head
			from blocks
			where chain_id = $1 and canonical = true
		`,
		[
			config.chainId.toString(),
		],
	)
	const currentHeadValue = currentHeadResult.rows[0]?.head
	const currentHead = BigInt(
		typeof currentHeadValue === 'string' || typeof currentHeadValue === 'number' || typeof currentHeadValue === 'bigint' ?
			currentHeadValue
		:
			0
	)
	const finalizedNumber = (
		finalizedBlockNumber && typeof finalizedBlockNumber === 'object' && finalizedBlockNumber !== null && 'number' in finalizedBlockNumber && typeof finalizedBlockNumber.number === 'string' ?
			BigInt(finalizedBlockNumber.number)
		:
			currentHead > config.finalityDepth ?
				currentHead - config.finalityDepth
			:
				0n
	)
	const safeNumber = (
		safeBlockNumber && typeof safeBlockNumber === 'object' && safeBlockNumber !== null && 'number' in safeBlockNumber && typeof safeBlockNumber.number === 'string' ?
			BigInt(safeBlockNumber.number)
		:
			finalizedNumber
	)

	await db.query(
		`
			update blocks
			set finality_state = case
				when block_number <= $2 then 'finalized'
				when block_number <= $3 then 'safe'
				else 'latest'
			end
			where chain_id = $1 and canonical = true
		`,
		[
			config.chainId.toString(),
			finalizedNumber.toString(),
			safeNumber.toString(),
		],
	)

	await db.query(
		`
			update ingest_checkpoints
			set last_finalized_block_number = $2, updated_at = now()
			where chain_id = $1
		`,
		[
			config.chainId.toString(),
			finalizedNumber.toString(),
		],
	)
}
