import { EventEmitter } from 'node:events'

import WebSocket from 'ws'

import type { Eip1193RequestArguments, ManagedProvider, ProviderHealth } from '../shared/types.js'

type JsonRpcRequest = {
	jsonrpc: "2.0"
	id: number
	method: string
	params: unknown
}

type JsonRpcSuccess = {
	jsonrpc: "2.0"
	id: number
	result: unknown
}

type JsonRpcError = {
	jsonrpc: "2.0"
	id: number
	error: {
		code: number
		message: string
		data?: unknown
	}
}

type PendingRequest = {
	resolve: (value: unknown) => void
	reject: (reason: Error) => void
	timeout: NodeJS.Timeout
}

const isJsonRpcSuccess = (value: unknown): value is JsonRpcSuccess => (
	typeof value === 'object'
	&& value !== null
	&& 'result' in value
	&& 'id' in value
)

const isJsonRpcError = (value: unknown): value is JsonRpcError => (
	typeof value === 'object'
	&& value !== null
	&& 'error' in value
	&& 'id' in value
)

const createDisconnectedError = (message: string) => (
	new Error(`Provider disconnected: ${message}`)
)

const wait = async (ms: number) => {
	await new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

export const createWsProvider = ({
	url,
	requestTimeoutMs,
	reconnectBackoffMinMs,
	reconnectBackoffMaxMs,
}: {
	url: string
	requestTimeoutMs: number
	reconnectBackoffMinMs: number
	reconnectBackoffMaxMs: number
}): ManagedProvider => {
	const events = new EventEmitter()
	let socket: WebSocket | null = null
	let connectPromise: Promise<WebSocket> | null = null
	let nextRequestId = 1
	let reconnectAttempts = 0
	let closedByUser = false
	let health: ProviderHealth = {
		connected: false,
		lastConnectedAt: null,
		lastDisconnectedAt: null,
		lastError: null,
	}

	const pending = new Map<number, PendingRequest>()

	const rejectPending = (error: Error) => {
		for (const [id, request] of pending) {
			clearTimeout(request.timeout)
			request.reject(error)
			pending.delete(id)
		}
	}

	const resetSocket = (reason: string) => {
		health = {
			...health,
			connected: false,
			lastDisconnectedAt: Date.now(),
			lastError: reason,
		}
		events.emit('disconnect', createDisconnectedError(reason))
		socket = null
		connectPromise = null
		rejectPending(createDisconnectedError(reason))
	}

	const attachSocket = (ws: WebSocket) => {
		ws.on('message', (data) => {
			try {
				const payload = JSON.parse(data.toString()) as unknown
				const messages = Array.isArray(payload) ? payload : [payload]

				for (const message of messages) {
					if (isJsonRpcSuccess(message)) {
						const request = pending.get(message.id)

						if (request) {
							clearTimeout(request.timeout)
							request.resolve(message.result)
							pending.delete(message.id)
						}
					}

					if (isJsonRpcError(message)) {
						const request = pending.get(message.id)

						if (request) {
							clearTimeout(request.timeout)
							request.reject(new Error(`RPC ${message.error.code}: ${message.error.message}`))
							pending.delete(message.id)
						}
					}
				}
			} catch (error) {
				health = {
					...health,
					lastError: error instanceof Error ? error.message : String(error),
				}
			}
		})

		ws.on('close', () => {
			if (!closedByUser) {
				resetSocket('socket closed')
			}
		})

		ws.on('error', (error) => {
			health = {
				...health,
				lastError: error.message,
			}
		})
	}

	const connect = async (): Promise<WebSocket> => {
		if (socket?.readyState === WebSocket.OPEN) {
			return socket
		}

		if (connectPromise) {
			return connectPromise
		}

		connectPromise = new Promise<WebSocket>((resolve, reject) => {
			const ws = new WebSocket(url)
			let settled = false

			ws.once('open', () => {
				settled = true
				socket = ws
				reconnectAttempts = 0
				health = {
					...health,
					connected: true,
					lastConnectedAt: Date.now(),
					lastError: null,
				}
				events.emit('connect')
				attachSocket(ws)
				resolve(ws)
			})

			ws.once('error', async (error) => {
				if (settled) {
					return
				}

				health = {
					...health,
					connected: false,
					lastError: error.message,
				}

				if (closedByUser) {
					reject(error)
					return
				}

				const delayMs = Math.min(
					reconnectBackoffMinMs * (2 ** reconnectAttempts),
					reconnectBackoffMaxMs,
				)

				reconnectAttempts += 1
				connectPromise = null

				void wait(delayMs).then(() => {
					void connect()
				})

				reject(error)
			})
		})

		return connectPromise
	}

	const request = async ({ method, params = [] }: Eip1193RequestArguments) => {
		const ws = await connect()
		const id = nextRequestId++

		return new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				pending.delete(id)
				reject(new Error(`RPC timeout after ${requestTimeoutMs}ms for ${method}`))
			}, requestTimeoutMs)

			pending.set(id, {
				resolve,
				reject,
				timeout,
			})

			const payload: JsonRpcRequest = {
				jsonrpc: '2.0',
				id,
				method,
				params,
			}

			ws.send(JSON.stringify(payload), (error) => {
				if (!error) {
					return
				}

				const request = pending.get(id)

				if (!request) {
					return
				}

				clearTimeout(request.timeout)
				pending.delete(id)
				request.reject(error)
			})
		})
	}

	const close = async () => {
		closedByUser = true
		rejectPending(createDisconnectedError('closed by caller'))

		if (!socket) {
			return
		}

		await new Promise<void>((resolve) => {
			socket?.once('close', () => {
				resolve()
			})
			socket?.close()
		})
	}

	return {
		request,
		on(event: PropertyKey, listener: (...args: unknown[]) => void) {
			events.on(typeof event === 'number' ? String(event) : event, listener)
			return this
		},
		removeListener(event: PropertyKey, listener: (...args: unknown[]) => void) {
			events.removeListener(typeof event === 'number' ? String(event) : event, listener)
			return this
		},
		close,
		getHealth: () => health,
	}
}
