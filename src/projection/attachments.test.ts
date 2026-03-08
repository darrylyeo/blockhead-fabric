import { describe, expect, it } from 'vitest'

import { materializeAttachmentCandidates } from './attachments.js'

const config = {
	databaseUrl: 'postgres://blockhead:blockhead@localhost:5432/blockhead',
	chainId: 1n,
	projectionPollIntervalMs: 1000,
	spineRecentBlockCount: 256,
	maxTxPulsesPerBlock: 24,
	spineBlockSpacing: 24,
	districtSpacing: 256,
	slotSpacing: 12,
	topContractLandmarksPerDistrict: 8,
	projectionVersion: 1n,
	districtAlgorithmVersion: 1n,
	anchorAlgorithmVersion: 1n,
	corridorAlgorithmVersion: 1n,
	surfaceAlgorithmVersion: 1n,
} as const

describe('materializeAttachmentCandidates', () => {
	it('publishes AMM attachment objects, rows, and child scopes from attachment hints', () => {
		const result = materializeAttachmentCandidates({
			config,
			headBlockNumber: 120n,
			pools: [
				{
					address: '0x7777777777777777777777777777777777777777',
					entityId: 'contract:1:0x7777777777777777777777777777777777777777',
					districtId: 'd_01',
					anchorX: 10,
					anchorY: 0,
					anchorZ: 20,
					protocolLabel: 'Pool 7777',
					familyLabel: 'AMM Pools',
					activity32: 4,
					eventCount32: 9,
					swapIntensity32: 2,
					reserve0: '123',
					reserve1: '456',
				},
			],
			candidates: [
				{
					address: '0x7777777777777777777777777777777777777777',
					kind: 'amm-pool-inspect',
					title: 'Inspect Pool',
					priority: '80',
				},
			],
		})

		expect(result.childScopes).toEqual([
			{
				scopeId: 'scope_attachment_1_amm_pool_inspect_7777777777777777777777777777777777777777',
				chainId: 1n,
				name: 'Inspect Pool',
				entryMsfPath: '/fabric/scopes/scope_attachment_1_amm_pool_inspect_7777777777777777777777777777777777777777/',
				desiredRevision: 120n,
				status: 'active',
			},
		])
		expect(result.entrypoints).toEqual([
			{
				scopeId: 'scope_attachment_1_amm_pool_inspect_7777777777777777777777777777777777777777',
				entrypointId: 'entry_inspect_attachment',
				name: 'Inspect Pool',
				rootObjectId: 'entry_inspect_attachment',
				desiredRevision: 120n,
			},
		])
		expect(result.attachments).toEqual([
			{
				scopeId: 'scope_eth_mainnet',
				objectId: 'attachment:1:amm-pool-inspect:0x7777777777777777777777777777777777777777',
				childScopeId: 'scope_attachment_1_amm_pool_inspect_7777777777777777777777777777777777777777',
				resourceReference: '/fabric/scopes/scope_attachment_1_amm_pool_inspect_7777777777777777777777777777777777777777/',
				desiredRevision: 120n,
			},
		])
		expect(result.objects).toEqual(expect.arrayContaining([
			expect.objectContaining({
				scopeId: 'scope_eth_mainnet',
				objectId: 'attachment:1:amm-pool-inspect:0x7777777777777777777777777777777777777777',
				entrypointId: 'entry_protocol_landmarks',
				parentObjectId: 'contract:1:0x7777777777777777777777777777777777777777',
				classId: 73,
				subtype: 255,
				name: 'Inspect Pool',
				resourceReference: '/fabric/scopes/scope_attachment_1_amm_pool_inspect_7777777777777777777777777777777777777777/',
				resourceName: 'attachment-inspect',
				metadataJson: expect.objectContaining({
					entityKind: 'attachment',
					kind: 'amm-pool-inspect',
					childScopeId: 'scope_attachment_1_amm_pool_inspect_7777777777777777777777777777777777777777',
					parentEntityId: 'contract:1:0x7777777777777777777777777777777777777777',
				}),
			}),
			expect.objectContaining({
				scopeId: 'scope_attachment_1_amm_pool_inspect_7777777777777777777777777777777777777777',
				objectId: 'entry_inspect_attachment',
				entrypointId: 'entry_inspect_attachment',
				parentObjectId: 'root',
				classId: 72,
				name: 'Inspect Pool',
			}),
			expect.objectContaining({
				scopeId: 'scope_attachment_1_amm_pool_inspect_7777777777777777777777777777777777777777',
				objectId: 'contract:1:0x7777777777777777777777777777777777777777',
				parentObjectId: 'entry_inspect_attachment',
				resourceName: 'amm-pool',
			}),
			expect.objectContaining({
				scopeId: 'scope_attachment_1_amm_pool_inspect_7777777777777777777777777777777777777777',
				objectId: 'container:inspect:surfaces',
				parentObjectId: 'entry_inspect_attachment',
				classId: 72,
			}),
			expect.objectContaining({
				scopeId: 'scope_attachment_1_amm_pool_inspect_7777777777777777777777777777777777777777',
				objectId: 'surface:contract:1:0x7777777777777777777777777777777777777777:reserve0',
				parentObjectId: 'container:inspect:surfaces',
				resourceName: 'state-surface',
			}),
		]))
		expect(result.objects).toHaveLength(7)
	})

	it('ignores attachment hints without a projected parent pool and deduplicates repeated hints', () => {
		const result = materializeAttachmentCandidates({
			config,
			headBlockNumber: 120n,
			pools: [
				{
					address: '0x7777777777777777777777777777777777777777',
					entityId: 'contract:1:0x7777777777777777777777777777777777777777',
					districtId: 'd_01',
					anchorX: 10,
					anchorY: 0,
					anchorZ: 20,
					protocolLabel: 'Pool 7777',
					familyLabel: 'AMM Pools',
					activity32: 4,
					eventCount32: 9,
					swapIntensity32: 2,
					reserve0: '123',
					reserve1: '456',
				},
			],
			candidates: [
				{
					address: '0x8888888888888888888888888888888888888888',
					kind: 'amm-pool-inspect',
					title: 'Inspect Pool',
					priority: '80',
				},
				{
					address: '0x7777777777777777777777777777777777777777',
					kind: 'amm-pool-inspect',
					title: 'Inspect Pool',
					priority: '80',
				},
				{
					address: '0x7777777777777777777777777777777777777777',
					kind: 'amm-pool-inspect',
					title: 'Inspect Pool',
					priority: '60',
				},
			],
		})

		expect(result.childScopes).toHaveLength(1)
		expect(result.entrypoints).toHaveLength(1)
		expect(result.attachments).toHaveLength(1)
		expect(result.objects).toHaveLength(7)
	})
})
