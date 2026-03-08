import { createServer } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { __private__, createFabricClient } from './fabricClient.js'

const servers = new Set<{
	close(): void
}>()

afterEach(() => {
	for (const server of servers) {
		server.close()
	}

	servers.clear()
})

const createJsonServer = async (body: unknown, statusCode = 200) => {
	const server = createServer((_, response) => {
		response.statusCode = statusCode
		response.setHeader('content-type', 'application/json')
		response.end(JSON.stringify(body))
	})

	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve)
	})

	servers.add(server)

	const address = server.address()

	if (!address || typeof address === 'string') {
		throw new Error('Failed to read test server address')
	}

	return `http://127.0.0.1:${address.port}/fabric`
}

describe('createFabricClient', () => {
	it('parses the root descriptor', async () => {
		const fabricUrl = await createJsonServer({
			map: {
				sConnect: 'secure=false;server=127.0.0.1;port=2000;session=RP1',
				wClass: 70,
				twObjectIx: 1,
			},
		})

		await expect(
			createFabricClient({
				ioImpl: (() => ({
					connected: false,
					timeout() {
						return {
							emitWithAck: async () => ({
								nResult: 0,
							}),
						}
					},
					on(_event: string, _handler: () => void) {
						return this
					},
					once(event: string, handler: () => void) {
						if (event === 'connect') {
							queueMicrotask(() => {
								this.connected = true
								handler()
							})
						}

						return this
					},
					off() {
						return this
					},
					connect() {
						return this
					},
					close() {
						this.connected = false
						return this
					},
				})) as never,
			}).connectRoot({
				fabricUrl,
				timeoutMs: 1000,
			}),
		).resolves.toEqual({
			scopeId: 'root',
			rootObjectId: '70:1',
		})
	})

	it('rejects invalid descriptors', () => {
		expect(() => {
			__private__.parseRootDescriptor({
				map: {
					sConnect: 'secure=false;server=127.0.0.1;port=2000;session=RP1',
					wClass: 70,
				},
			})
		}).toThrow('Fabric root descriptor missing twObjectIx')
	})

	it('uses socket actions for read and write methods', async () => {
		const actions: {
			action: string
			payload: Record<string, unknown>
		}[] = []
		const socket = {
			connected: false,
			timeout() {
				return {
					emitWithAck: async (action: string, payload: Record<string, unknown>) => {
						actions.push({
							action,
							payload,
						})

						return action === 'login' ?
							{
								nResult: 0,
							}
						: action === 'RMRoot:update' ?
							{
								nResult: 0,
								Parent: {
									pObjectHead: {
										twParentIx: 0,
										twObjectIx: 1,
										wClass_Parent: 0,
										wClass_Object: 70,
									},
									pName: {
										wsRMRootId: 'World',
									},
								},
								aChild: [
									{
										pObjectHead: {
											twParentIx: 1,
											twObjectIx: 2,
											wClass_Parent: 70,
											wClass_Object: 72,
										},
										pName: {
											wsRMTObjectId: 'entry_latest_spine',
										},
										pType: {
											bType: 1,
											bSubtype: 2,
										},
										pResource: {
											sName: 'entry',
											sReference: '/fabric/72/2/',
										},
										pTransform: {
											Position: [
												1,
												2,
												3,
											],
											Rotation: [
												0,
												0,
												0,
												1,
											],
											Scale: [
												1,
												1,
												1,
											],
										},
										pBound: {
											Max: [
												4,
												5,
												6,
											],
										},
									},
								],
							}
						: action === 'RMTObject:update' ?
							{
								nResult: 0,
								Parent: {
									pObjectHead: {
										twParentIx: 1,
										twObjectIx: 2,
										wClass_Parent: 70,
										wClass_Object: 72,
									},
									pName: {
										wsRMTObjectId: 'entry_latest_spine',
									},
									pType: {
										bType: 1,
										bSubtype: 2,
									},
									pResource: {
										sName: 'entry',
										sReference: '/fabric/72/2/',
									},
									pTransform: {
										Position: [
											1,
											2,
											3,
										],
										Rotation: [
											0,
											0,
											0,
											1,
										],
										Scale: [
											1,
											1,
											1,
										],
									},
									pBound: {
										Max: [
											4,
											5,
											6,
										],
									},
								},
								aChild: [
									[
										{
											pObjectHead: {
												twParentIx: 2,
												twObjectIx: 3,
												wClass_Parent: 72,
												wClass_Object: 73,
											},
											pName: {
												wsRMPObjectId: 'tx_1',
											},
										},
									],
								],
							}
						: action === 'RMRoot:rmtobject_open' ?
							{
								nResult: 0,
								twRMTObjectIx: 4,
							}
						:
							{
								nResult: 0,
							}
					},
				}
			},
			on(_event: string, _handler: () => void) {
				return this
			},
			once(event: string, handler: () => void) {
				if (event === 'connect') {
					queueMicrotask(() => {
						this.connected = true
						handler()
					})
				}

				return this
			},
			off() {
				return this
			},
			connect() {
				return this
			},
			close() {
				this.connected = false
				return this
			},
		}
		const client = createFabricClient({
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					map: {
						sConnect: 'secure=false;server=127.0.0.1;port=2000;session=RP1',
						wClass: 70,
						twObjectIx: 1,
					},
				}),
			})) as never,
			ioImpl: vi.fn(() => (
				socket
			)) as never,
		})

		await client.connectRoot({
			fabricUrl: 'http://localhost:2000/fabric',
			adminKey: 'secret',
			timeoutMs: 1000,
		})

		await expect(client.listObjects({
			scopeId: 'root',
			anchorObjectId: '70:1',
		})).resolves.toEqual([
			{
				objectId: 'entry_latest_spine',
				parentObjectId: '70:1',
				name: 'entry_latest_spine',
				classId: 72,
				type: 1,
				subtype: 2,
				resourceReference: '/fabric/72/2/',
				resourceName: 'entry',
				transform: {
					position: {
						x: 1,
						y: 2,
						z: 3,
					},
					rotation: {
						x: 0,
						y: 0,
						z: 0,
						w: 1,
					},
					scale: {
						x: 1,
						y: 1,
						z: 1,
					},
				},
				bounds: {
					x: 4,
					y: 5,
					z: 6,
				},
			},
		])

		await expect(client.getObject({
			scopeId: 'root',
			objectId: 'entry_latest_spine',
		})).resolves.toEqual({
			objectId: 'entry_latest_spine',
			parentObjectId: '70:1',
			name: 'entry_latest_spine',
			classId: 72,
			type: 1,
			subtype: 2,
			resourceReference: '/fabric/72/2/',
			resourceName: 'entry',
			transform: {
				position: {
					x: 1,
					y: 2,
					z: 3,
				},
				rotation: {
					x: 0,
					y: 0,
					z: 0,
					w: 1,
				},
				scale: {
					x: 1,
					y: 1,
					z: 1,
				},
			},
			bounds: {
				x: 4,
				y: 5,
				z: 6,
			},
		})

		await client.createObject({
			scopeId: 'root',
			parentId: '70:1',
			objectId: 'new_entry',
			name: 'New Entry',
			classId: 72,
			type: 7,
			subtype: 8,
			resourceName: 'new-entry',
			resourceReference: '/fabric/72/4/',
			transform: {},
			bounds: null,
		})
		await client.updateObject({
			scopeId: 'root',
			parentId: '70:1',
			objectId: 'new_entry',
			name: 'New Entry',
			classId: 72,
			type: 7,
			subtype: 8,
			resourceName: 'new-entry',
			resourceReference: '/fabric/72/4/',
			transform: {},
			bounds: null,
		})

		expect(actions.map(({ action }) => (
			action
		))).toEqual([
			'login',
			'RMRoot:update',
			'RMTObject:update',
			'RMRoot:rmtobject_open',
			'RMTObject:name',
			'RMTObject:type',
			'RMTObject:transform',
			'RMTObject:bound',
			'RMTObject:resource',
		])
	})
})
