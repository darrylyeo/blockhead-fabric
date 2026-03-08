import { connectDb } from '../db/connect.js'
import { createWsProvider } from '../provider/createWsProvider.js'

import { loadProjectionConfig } from './config.js'
import { materializeAttachmentCandidates } from './attachments.js'
import {
	claimNextProjectionJob,
	completeProjectionJob,
	failProjectionJob,
	loadAmmPoolLogs,
	loadAmmPoolAttachmentCandidates,
	loadContractSurfaceStats,
	loadContractCalls,
	loadDueErc20TotalSupplyTargets,
	loadDistrictAtlasEntities,
	loadErc1155TransferLogs,
	loadErc721TransferLogs,
	loadEventEffectLogs,
	loadErc20Transfers,
	loadKnownErc20SourceContracts,
	loadKnownErc20TransferLogs,
	loadKnownCollectionContracts,
	loadKnownAmmPoolContracts,
	loadKnownMultiTokenContracts,
	loadKnownTokenContracts,
	loadNativeTransfers,
	loadRecentTxPulses,
	loadSpineWindow,
	persistAdapterEntities,
	persistAdapterEvents,
	persistAdapterHints,
	persistAdapterSurfaces,
	persistCorridors,
	persistDistrictMemberships,
	persistDistrictRows,
	persistEntityAnchors,
	persistProjectedFabricState,
	persistStateSurfaces,
	upsertProjectionCheckpoint,
} from './db.js'
import { materializeCorridors } from './corridors.js'
import { materializeDistrictAtlas } from './districts.js'
import {
	__private__ as ammAdapterPrivate,
	materializeAmmPoolAdapter,
} from './ammAdapter.js'
import {
	__private__ as eventEffectsPrivate,
	materializeEventEffects,
} from './eventEffects.js'
import {
	__private__ as erc20AdapterPrivate,
	materializeErc1155Adapter,
	materializeErc721Adapter,
	materializeKnownErc20Adapter,
	materializeProtocolLandmarks,
} from './erc20Adapter.js'
import { materializeContractStateSurfaces } from './stateSurfaces.js'
import { materializeLatestSpine } from './spine.js'
import { materializeTxPulses } from './txPulses.js'
import {
	__private__ as erc20ReadsPrivate,
	readErc20TotalSupplySurfaces,
} from './erc20Reads.js'

export const runProjectionRound = async (args: {
	config: ReturnType<typeof loadProjectionConfig>
	db: ReturnType<typeof connectDb>
	provider: ReturnType<typeof createWsProvider>
}) => {
	const job = await claimNextProjectionJob(args.db, args.config.chainId)

	if (!job) {
		return false
	}

	const client = await args.db.connect()

	try {
		await client.query('begin')

		const blocks = await loadSpineWindow(client, {
			chainId: args.config.chainId,
			spineRecentBlockCount: args.config.spineRecentBlockCount,
		})
		const projection = materializeLatestSpine({
			config: args.config,
			blocks,
		})
		const headBlock = blocks.at(-1)
		const spineFromBlockNumber = blocks[0]?.blockNumber ?? 0n
		const corridorFromBlockNumber = headBlock && headBlock.blockNumber > 127n ?
			headBlock.blockNumber - 127n
		:
			0n
		const txPulseFromBlockNumber = headBlock && headBlock.blockNumber > 31n ?
			headBlock.blockNumber - 31n
		:
			0n
		const districtEntities = await loadDistrictAtlasEntities(client, args.config.chainId)
		const districtAtlas = !headBlock ?
			null
		:
			materializeDistrictAtlas({
				config: args.config,
				entities: districtEntities,
				headBlockNumber: headBlock.blockNumber,
			})

		if (districtAtlas) {
			await persistDistrictRows(client, districtAtlas.districts)
			await persistDistrictMemberships(client, districtAtlas.memberships)
			await persistEntityAnchors(client, districtAtlas.anchors)
		}

		const knownTokenAddresses = Object.keys(erc20AdapterPrivate.knownTokens)
		const erc20Adapter = !headBlock ?
			null
		:
			materializeKnownErc20Adapter({
				config: args.config,
				headBlockNumber: headBlock.blockNumber,
				contracts: await loadKnownErc20SourceContracts(client, {
					chainId: args.config.chainId,
					addresses: knownTokenAddresses,
				}),
				transferLogs: await loadKnownErc20TransferLogs(client, {
					chainId: args.config.chainId,
					addresses: knownTokenAddresses,
					topic0: erc20AdapterPrivate.transferTopic0,
				}),
			})

		if (headBlock && erc20Adapter) {
			await persistAdapterEntities(client, erc20Adapter.adapterEntities, {
				chainId: args.config.chainId,
				adapterId: 'erc20',
			})
			await persistAdapterEvents(client, erc20Adapter.adapterEvents, {
				chainId: args.config.chainId,
				adapterId: 'erc20',
			})
			await persistAdapterHints(client, erc20Adapter.adapterHints, {
				chainId: args.config.chainId,
				adapterId: 'erc20',
			})
			await persistAdapterSurfaces(client, erc20Adapter.adapterSurfaces, {
				chainId: args.config.chainId,
				adapterId: 'erc20',
				sourceMode: 'on_log',
				replaceExisting: true,
			})
			await persistAdapterSurfaces(client, await readErc20TotalSupplySurfaces({
				provider: args.provider,
				chainId: args.config.chainId,
				headBlockNumber: headBlock.blockNumber,
				addresses: await loadDueErc20TotalSupplyTargets(client, {
					chainId: args.config.chainId,
					headBlockNumber: headBlock.blockNumber,
					minBlocksBetweenReads: erc20ReadsPrivate.minBlocksBetweenReads,
					maxTargetsPerBlock: erc20ReadsPrivate.maxTargetsPerBlock,
				}),
			}), {
				chainId: args.config.chainId,
				adapterId: 'erc20',
				sourceMode: 'scheduled_read',
				replaceExisting: false,
			})
		}
		const erc721Adapter = !headBlock ?
			null
		:
			materializeErc721Adapter({
				config: args.config,
				headBlockNumber: headBlock.blockNumber,
				transferLogs: await loadErc721TransferLogs(client, {
					chainId: args.config.chainId,
					fromBlockNumber: 0n,
				}),
			})

		if (erc721Adapter) {
			await persistAdapterEntities(client, erc721Adapter.adapterEntities, {
				chainId: args.config.chainId,
				adapterId: 'erc721',
			})
			await persistAdapterEvents(client, erc721Adapter.adapterEvents, {
				chainId: args.config.chainId,
				adapterId: 'erc721',
			})
			await persistAdapterHints(client, erc721Adapter.adapterHints, {
				chainId: args.config.chainId,
				adapterId: 'erc721',
			})
			await persistAdapterSurfaces(client, erc721Adapter.adapterSurfaces, {
				chainId: args.config.chainId,
				adapterId: 'erc721',
				sourceMode: 'on_log',
				replaceExisting: true,
			})
		}
		const erc1155Adapter = !headBlock ?
			null
		:
			materializeErc1155Adapter({
				config: args.config,
				headBlockNumber: headBlock.blockNumber,
				transferLogs: await loadErc1155TransferLogs(client, {
					chainId: args.config.chainId,
					fromBlockNumber: 0n,
				}),
			})

		if (erc1155Adapter) {
			await persistAdapterEntities(client, erc1155Adapter.adapterEntities, {
				chainId: args.config.chainId,
				adapterId: 'erc1155',
			})
			await persistAdapterEvents(client, erc1155Adapter.adapterEvents, {
				chainId: args.config.chainId,
				adapterId: 'erc1155',
			})
			await persistAdapterHints(client, erc1155Adapter.adapterHints, {
				chainId: args.config.chainId,
				adapterId: 'erc1155',
			})
			await persistAdapterSurfaces(client, erc1155Adapter.adapterSurfaces, {
				chainId: args.config.chainId,
				adapterId: 'erc1155',
				sourceMode: 'on_log',
				replaceExisting: true,
			})
		}
		const ammPoolAdapter = !headBlock ?
			null
		:
			materializeAmmPoolAdapter({
				config: args.config,
				headBlockNumber: headBlock.blockNumber,
				logs: await loadAmmPoolLogs(client, {
					chainId: args.config.chainId,
					fromBlockNumber: 0n,
				}),
			})

		if (ammPoolAdapter) {
			await persistAdapterEntities(client, ammPoolAdapter.adapterEntities, {
				chainId: args.config.chainId,
				adapterId: 'amm_pool',
			})
			await persistAdapterEvents(client, ammPoolAdapter.adapterEvents, {
				chainId: args.config.chainId,
				adapterId: 'amm_pool',
			})
			await persistAdapterHints(client, ammPoolAdapter.adapterHints, {
				chainId: args.config.chainId,
				adapterId: 'amm_pool',
			})
			await persistAdapterSurfaces(client, ammPoolAdapter.adapterSurfaces, {
				chainId: args.config.chainId,
				adapterId: 'amm_pool',
				sourceMode: 'on_log',
				replaceExisting: true,
			})
		}

		const knownTokenContracts = !headBlock ?
			null
		:
			await loadKnownTokenContracts(client, {
				chainId: args.config.chainId,
				headBlockNumber: headBlock.blockNumber,
				limitPerDistrict: args.config.topContractLandmarksPerDistrict,
			})
		const tokenSurfaceStats = !headBlock || !knownTokenContracts ?
			[]
		:
			await loadContractSurfaceStats(client, {
				chainId: args.config.chainId,
				headBlockNumber: headBlock.blockNumber,
				addresses: knownTokenContracts.map(({ address }) => (
					address
				)),
			})
		const tokenSurfaceStatsByEntityId = new Map(
			tokenSurfaceStats.map((stats) => (
				[
					stats.entityId,
					stats,
				]
			)),
		)
		const surfacedTokenContracts = knownTokenContracts?.map((contract) => ({
			...contract,
			...tokenSurfaceStatsByEntityId.get(contract.entityId),
		})) ?? []
		const knownCollectionContracts = !headBlock ?
			[]
		:
			await loadKnownCollectionContracts(client, {
				chainId: args.config.chainId,
				headBlockNumber: headBlock.blockNumber,
				limitPerDistrict: args.config.topContractLandmarksPerDistrict,
			})
		const knownMultiTokenContracts = !headBlock ?
			[]
		:
			await loadKnownMultiTokenContracts(client, {
				chainId: args.config.chainId,
				headBlockNumber: headBlock.blockNumber,
				limitPerDistrict: args.config.topContractLandmarksPerDistrict,
			})
		const knownAmmPoolContracts = !headBlock ?
			[]
		:
			await loadKnownAmmPoolContracts(client, {
				chainId: args.config.chainId,
				headBlockNumber: headBlock.blockNumber,
				limitPerDistrict: args.config.topContractLandmarksPerDistrict,
			})

		if (headBlock) {
			await persistStateSurfaces(client, {
				entityIds: surfacedTokenContracts.map(({ entityId }) => (
					entityId
				)),
				rows: materializeContractStateSurfaces({
					contracts: surfacedTokenContracts,
					headBlockNumber: headBlock.blockNumber,
				}),
			})
		}

		const protocolLandmarks = !headBlock ?
			null
		:
			materializeProtocolLandmarks({
				config: args.config,
				headBlockNumber: headBlock.blockNumber,
				tokenContracts: surfacedTokenContracts,
				collectionContracts: knownCollectionContracts,
				multiTokenContracts: knownMultiTokenContracts,
				ammPoolContracts: knownAmmPoolContracts,
			})
		const attachments = !headBlock ?
			null
		:
			materializeAttachmentCandidates({
				config: args.config,
				headBlockNumber: headBlock.blockNumber,
				pools: knownAmmPoolContracts,
				candidates: await loadAmmPoolAttachmentCandidates(client, {
					chainId: args.config.chainId,
				}),
			})
		const txPulses = !headBlock ?
			[]
		:
			materializeTxPulses({
				config: args.config,
				headBlockNumber: headBlock.blockNumber,
				blocks,
				transactions: await loadRecentTxPulses(client, {
					chainId: args.config.chainId,
					fromBlockNumber: txPulseFromBlockNumber,
				}),
			})
		const eventEffects = !headBlock ?
			[]
		:
			materializeEventEffects({
				config: args.config,
				blocks,
				logs: await loadEventEffectLogs(client, {
					chainId: args.config.chainId,
					fromBlockNumber: spineFromBlockNumber,
					toBlockNumber: headBlock.blockNumber,
					topic0s: [
						eventEffectsPrivate.ercTransferTopic0,
						eventEffectsPrivate.erc1155TransferSingleTopic0,
						eventEffectsPrivate.erc1155TransferBatchTopic0,
						ammAdapterPrivate.swapTopic0,
						ammAdapterPrivate.mintTopic0,
						ammAdapterPrivate.burnTopic0,
						ammAdapterPrivate.syncTopic0,
					],
				}),
			})
		const corridors = !headBlock || !districtAtlas ?
			null
		:
			materializeCorridors({
				config: args.config,
				headBlockNumber: headBlock.blockNumber,
				entities: districtEntities,
				memberships: districtAtlas.memberships,
				districts: districtAtlas.districts,
				nativeTransfers: await loadNativeTransfers(client, {
					chainId: args.config.chainId,
					fromBlockNumber: corridorFromBlockNumber,
				}),
				contractCalls: await loadContractCalls(client, {
					chainId: args.config.chainId,
					fromBlockNumber: corridorFromBlockNumber,
				}),
				erc20Transfers: await loadErc20Transfers(client, {
					chainId: args.config.chainId,
					fromBlockNumber: corridorFromBlockNumber,
				}),
			})

		if (corridors) {
			await persistCorridors(client, {
				chainId: args.config.chainId,
				rows: corridors.rows,
			})
		}

		await persistProjectedFabricState(client, {
			scope: projection.scope,
			entrypoints: [
				...projection.entrypoints,
				...(districtAtlas?.state.entrypoints ?? []),
				...(protocolLandmarks?.entrypoints ?? []),
				...(attachments?.entrypoints ?? []),
			],
			objects: [
				...projection.objects,
				...txPulses,
				...eventEffects,
				...(districtAtlas?.state.objects ?? []),
				...(corridors?.objects ?? []),
				...(protocolLandmarks?.objects ?? []),
				...(attachments?.objects ?? []),
			],
			childScopes: attachments?.childScopes,
			attachments: attachments?.attachments,
		})

		if (headBlock) {
			await upsertProjectionCheckpoint(client, {
				config: args.config,
				headBlock,
			})
		}

		await completeProjectionJob(client, job.id)
		await client.query('commit')

		return true
	} catch (error) {
		await client.query('rollback')
		await failProjectionJob(
			args.db,
			job.id,
			error instanceof Error ?
				error.message
			:
				String(error),
		)
		throw error
	} finally {
		client.release()
	}
}
