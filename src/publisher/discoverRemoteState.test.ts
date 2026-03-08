import { describe, expect, it } from 'vitest'

import { discoverRemoteState } from './discoverRemoteState.js'
import { createMockFabricClient, createRemoteObject, createScopeSnapshot } from './testFactories.js'

describe('discoverRemoteState', () => {
	it('discovers only managed entrypoint subtrees', async () => {
		const remoteByAnchor = new Map([
			[
				'70:1',
				[
					createRemoteObject({
						objectId: 'entry_latest_spine',
						parentObjectId: '70:1',
					}),
					createRemoteObject({
						objectId: 'unmanaged_root_child',
						parentObjectId: '70:1',
					}),
				],
			],
			[
				'entry_latest_spine',
				[
					createRemoteObject({
						objectId: 'block_1',
						parentObjectId: 'entry_latest_spine',
					}),
				],
			],
			[
				'block_1',
				[
					createRemoteObject({
						objectId: 'tx_1',
						parentObjectId: 'block_1',
						classId: 73,
					}),
				],
			],
			[
				'tx_1',
				[],
			],
		])

		const remoteState = await discoverRemoteState({
			fabricClient: createMockFabricClient({
				getObject: async ({ objectId }) => (
					createRemoteObject({
						objectId,
						parentObjectId: null,
						classId: 70,
						name: 'Root',
					})
				),
				listObjects: async ({ anchorObjectId }) => (
					remoteByAnchor.get(anchorObjectId) ?? []
				),
			}),
			fabricUrl: 'http://localhost:2000/fabric',
			timeoutMs: 1000,
			snapshot: createScopeSnapshot(),
		})

		expect(remoteState.rootChildren.map(({ objectId }) => (
			objectId
		))).toEqual([
			'entry_latest_spine',
			'unmanaged_root_child',
		])
		expect(remoteState.managedObjects.map(({ objectId }) => (
			objectId
		))).toEqual([
			'entry_latest_spine',
			'block_1',
			'tx_1',
		])
	})
})
