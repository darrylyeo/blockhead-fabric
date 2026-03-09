import { describe, expect, it } from 'vitest'

import {
	__private__,
	materializeErc1155Adapter,
	materializeErc721Adapter,
	materializeKnownErc20Adapter,
	materializeProtocolLandmarks,
} from './erc20Adapter.js'

const config = {
	databaseUrl: 'postgres://blockhead:blockhead@localhost:5432/blockhead',
	chainId: 1n,
	projectionPollIntervalMs: 1000,
	spineRecentBlockCount: 256,
	maxTxPulsesPerBlock: 24,
	spineBlockSpacing: 24,
	districtSpacing: 256,
	districtAtlasOffsetX: 512,
	districtAtlasOffsetZ: 0,
	slotSpacing: 12,
	topContractLandmarksPerDistrict: 8,
	projectionVersion: 1n,
	districtAlgorithmVersion: 1n,
	anchorAlgorithmVersion: 1n,
	corridorAlgorithmVersion: 1n,
	surfaceAlgorithmVersion: 1n,
} as const

describe('materializeKnownErc20Adapter', () => {
	it('materializes exact known-token entities, transfer events, and style hints', () => {
		const address = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
		const result = materializeKnownErc20Adapter({
			config,
			headBlockNumber: 100n,
			contracts: [
				{
					address,
				},
			],
			transferLogs: [
				{
					blockNumber: 100n,
					blockHash: '0xblock',
					txHash: '0xtx',
					logIndex: 0,
					address,
					topic1: '0x0000000000000000000000001111111111111111111111111111111111111111',
					topic2: '0x0000000000000000000000002222222222222222222222222222222222222222',
					data: '0x000000000000000000000000000000000000000000000000000000000000002a',
				},
			],
		})

		expect(result.adapterEntities).toEqual([
			expect.objectContaining({
				address,
				adapterId: 'erc20',
				confidence: 'exact',
				protocolId: `erc20:${address}`,
				metadataJson: expect.objectContaining({
					protocolLabel: 'USDC',
					familyLabel: 'erc20',
				}),
			}),
		])
		expect(result.adapterEvents).toEqual([
			expect.objectContaining({
				targetAddress: address,
				eventFamily: 'transfer',
				payloadJson: expect.objectContaining({
					from: '0x1111111111111111111111111111111111111111',
					to: '0x2222222222222222222222222222222222222222',
					protocolLabel: 'USDC',
					topic0: __private__.transferTopic0,
				}),
			}),
		])
		expect(result.adapterHints).toEqual([
			expect.objectContaining({
				address,
				hintType: 'object_style',
				payloadJson: expect.objectContaining({
					preferredEntrypoint: 'protocol-landmarks',
					preferredLabel: 'USDC',
				}),
			}),
		])
		expect(result.adapterSurfaces).toEqual([
			expect.objectContaining({
				address,
				surfaceId: 'transfer_velocity_32',
				surfaceKind: 'gauge',
				valueJson: 1,
				visualChannel: 'particleDensity',
				sourceMode: 'on_log',
			}),
		])
	})
})

describe('materializeProtocolLandmarks', () => {
	it('materializes a shared protocol-landmarks entrypoint with family containers', () => {
		const state = materializeProtocolLandmarks({
			config,
			headBlockNumber: 100n,
			tokenContracts: [
				{
					address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
					entityId: 'contract:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
					districtId: 'd_a0',
					anchorX: 24,
					anchorY: 0,
					anchorZ: 48,
					protocolLabel: 'USDC',
					familyLabel: 'erc20',
					activity32: 9,
					incomingValue32: '42',
					outgoingValue32: '7',
					eventCount32: 7,
					transferVelocity32: 5,
					totalSupply: '1000000',
				},
			],
			collectionContracts: [
				{
					address: '0x9999999999999999999999999999999999999999',
					entityId: 'contract:1:0x9999999999999999999999999999999999999999',
					districtId: 'd_99',
					anchorX: 12,
					anchorY: 0,
					anchorZ: 24,
					protocolLabel: '0x999999...9999',
					familyLabel: 'erc721',
					activity32: 3,
					eventCount32: 3,
					mintActivity32: 1,
					transferActivity32: 3,
				},
			],
			multiTokenContracts: [
				{
					address: '0x8888888888888888888888888888888888888888',
					entityId: 'contract:1:0x8888888888888888888888888888888888888888',
					districtId: 'd_88',
					anchorX: 8,
					anchorY: 0,
					anchorZ: 16,
					protocolLabel: '0x888888...8888',
					familyLabel: 'erc1155',
					activity32: 4,
					eventCount32: 4,
					batchActivity32: 2,
					transferActivity32: 4,
				},
			],
			ammPoolContracts: [
				{
					address: '0x7777777777777777777777777777777777777777',
					entityId: 'contract:1:0x7777777777777777777777777777777777777777',
					districtId: 'd_77',
					anchorX: 4,
					anchorY: 0,
					anchorZ: 8,
					protocolLabel: '0x777777...7777',
					familyLabel: 'amm_pool',
					activity32: 6,
					eventCount32: 10,
					swapIntensity32: 6,
					reserve0: '123',
					reserve1: '456',
				},
			],
		})

		expect(state.entrypoints).toEqual([
			{
				scopeId: 'scope_eth_mainnet',
				entrypointId: 'entry_protocol_landmarks',
				name: 'Protocol Landmarks',
				rootObjectId: 'entry_protocol_landmarks',
				desiredRevision: 100n,
			},
		])
		expect(state.objects.find(({ objectId }) => (
			objectId === 'container:protocol:erc20'
		))?.name).toBe('ERC-20 Tokens')
		expect(state.objects.find(({ objectId }) => (
			objectId === 'container:protocol:erc721'
		))?.name).toBe('ERC-721 Collections')
		expect(state.objects.find(({ objectId }) => (
			objectId === 'container:protocol:erc1155'
		))?.name).toBe('ERC-1155 Collections')
		expect(state.objects.find(({ objectId }) => (
			objectId === 'container:protocol:amm_pool'
		))?.name).toBe('AMM Pools')
		expect(state.objects.find(({ objectId }) => (
			objectId === 'container:protocol:erc20'
		))?.resourceReference).toBe('action://objects/blockhead-district.gltf')
		expect(state.objects.find(({ objectId }) => (
			objectId === 'contract:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
		))?.resourceReference).toBe('action://objects/blockhead-token.gltf')
		expect(state.objects.find(({ objectId }) => (
			objectId === 'surface:contract:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48:activity_32'
		))?.resourceReference).toBe('action://objects/blockhead-state-activity.gltf')
		expect(state.objects.find(({ objectId }) => (
			objectId === 'contract:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
		))?.metadataJson).toMatchObject({
			protocolLabel: 'USDC',
			familyLabel: 'erc20',
			districtId: 'd_a0',
			stateSurfaces: [
				'activity_32',
				'incoming_value_32',
				'outgoing_value_32',
				'event_count_32',
			],
			surfaceValues: {
				activity_32: 9,
				incoming_value_32: '42',
				outgoing_value_32: '7',
				event_count_32: 7,
			},
			adapterSurfaces: [
				'transfer_velocity_32',
				'total_supply',
			],
			adapterSurfaceValues: {
				transfer_velocity_32: 5,
				total_supply: '1000000',
			},
			activity32: 9,
			incomingValue32: '42',
			outgoingValue32: '7',
			transferVelocity32: 5,
			totalSupply: '1000000',
		})
		expect(state.objects.find(({ objectId }) => (
			objectId === 'contract:1:0x9999999999999999999999999999999999999999'
		))?.metadataJson).toMatchObject({
			protocolLabel: '0x999999...9999',
			familyLabel: 'erc721',
			districtId: 'd_99',
			adapterSurfaces: [
				'mint_activity_32',
				'transfer_activity_32',
			],
			adapterSurfaceValues: {
				mint_activity_32: 1,
				transfer_activity_32: 3,
			},
			mintActivity32: 1,
			transferActivity32: 3,
		})
		expect(state.objects.find(({ objectId }) => (
			objectId === 'contract:1:0x8888888888888888888888888888888888888888'
		))?.metadataJson).toMatchObject({
			protocolLabel: '0x888888...8888',
			familyLabel: 'erc1155',
			districtId: 'd_88',
			adapterSurfaces: [
				'batch_activity_32',
				'transfer_activity_32',
			],
			adapterSurfaceValues: {
				batch_activity_32: 2,
				transfer_activity_32: 4,
			},
			batchActivity32: 2,
			transferActivity32: 4,
		})
		expect(state.objects.find(({ objectId }) => (
			objectId === 'contract:1:0x7777777777777777777777777777777777777777'
		))?.metadataJson).toMatchObject({
			protocolLabel: '0x777777...7777',
			familyLabel: 'amm_pool',
			districtId: 'd_77',
			adapterSurfaces: [
				'reserve0',
				'reserve1',
				'swap_intensity_32',
			],
			adapterSurfaceValues: {
				reserve0: '123',
				reserve1: '456',
				swap_intensity_32: 6,
			},
			swapIntensity32: 6,
			reserve0: '123',
			reserve1: '456',
		})
	})
})

describe('materializeErc721Adapter', () => {
	it('materializes ERC-721 entities, events, hints, and adapter surfaces', () => {
		const address = '0x9999999999999999999999999999999999999999'
		const result = materializeErc721Adapter({
			config,
			headBlockNumber: 100n,
			transferLogs: [
				{
					blockNumber: 99n,
					blockHash: '0xblock',
					txHash: '0xtx',
					logIndex: 0,
					address,
					topic1: __private__.zeroAddressTopic,
					topic2: '0x0000000000000000000000002222222222222222222222222222222222222222',
					topic3: '0x0000000000000000000000000000000000000000000000000000000000000001',
				},
				{
					blockNumber: 100n,
					blockHash: '0xblock2',
					txHash: '0xtx2',
					logIndex: 1,
					address,
					topic1: '0x0000000000000000000000002222222222222222222222222222222222222222',
					topic2: '0x0000000000000000000000003333333333333333333333333333333333333333',
					topic3: '0x0000000000000000000000000000000000000000000000000000000000000001',
				},
			],
		})

		expect(result.adapterEntities).toEqual([
			expect.objectContaining({
				address,
				adapterId: 'erc721',
				confidence: 'high',
				protocolId: `erc721:${address}`,
				metadataJson: expect.objectContaining({
					familyLabel: 'erc721',
				}),
			}),
		])
		expect(result.adapterEvents).toEqual([
			expect.objectContaining({
				targetAddress: address,
				eventFamily: 'transfer',
				payloadJson: expect.objectContaining({
					from: '0x0000000000000000000000000000000000000000',
					to: '0x2222222222222222222222222222222222222222',
					tokenId: '0x0000000000000000000000000000000000000000000000000000000000000001',
				}),
			}),
			expect.objectContaining({
				targetAddress: address,
				eventFamily: 'transfer',
			}),
		])
		expect(result.adapterHints).toEqual([
			expect.objectContaining({
				address,
				hintType: 'object_style',
				payloadJson: expect.objectContaining({
					preferredEntrypoint: 'protocol-landmarks',
					preferredResourceName: 'erc721-collection',
					preferredLabel: '0x999999...9999',
				}),
			}),
		])
		expect(result.adapterSurfaces).toEqual([
			expect.objectContaining({
				address,
				surfaceId: 'mint_activity_32',
				valueJson: 1,
			}),
			expect.objectContaining({
				address,
				surfaceId: 'transfer_activity_32',
				valueJson: 2,
			}),
		])
	})
})

describe('materializeErc1155Adapter', () => {
	it('materializes ERC-1155 entities, events, hints, and adapter surfaces', () => {
		const address = '0x8888888888888888888888888888888888888888'
		const result = materializeErc1155Adapter({
			config,
			headBlockNumber: 100n,
			transferLogs: [
				{
					blockNumber: 99n,
					blockHash: '0xblock',
					txHash: '0xtx',
					logIndex: 0,
					address,
					topic0: __private__.erc1155TransferSingleTopic0,
				},
				{
					blockNumber: 100n,
					blockHash: '0xblock2',
					txHash: '0xtx2',
					logIndex: 1,
					address,
					topic0: __private__.erc1155TransferBatchTopic0,
				},
			],
		})

		expect(result.adapterEntities).toEqual([
			expect.objectContaining({
				address,
				adapterId: 'erc1155',
				confidence: 'high',
				protocolId: `erc1155:${address}`,
				metadataJson: expect.objectContaining({
					familyLabel: 'erc1155',
				}),
			}),
		])
		expect(result.adapterEvents).toEqual([
			expect.objectContaining({
				targetAddress: address,
				eventFamily: 'transfer_single',
			}),
			expect.objectContaining({
				targetAddress: address,
				eventFamily: 'transfer_batch',
			}),
		])
		expect(result.adapterHints).toEqual([
			expect.objectContaining({
				address,
				hintType: 'object_style',
				payloadJson: expect.objectContaining({
					preferredEntrypoint: 'protocol-landmarks',
					preferredResourceName: 'erc1155-collection',
					preferredLabel: '0x888888...8888',
				}),
			}),
		])
		expect(result.adapterSurfaces).toEqual([
			expect.objectContaining({
				address,
				surfaceId: 'batch_activity_32',
				valueJson: 1,
			}),
			expect.objectContaining({
				address,
				surfaceId: 'transfer_activity_32',
				valueJson: 2,
			}),
		])
	})
})
