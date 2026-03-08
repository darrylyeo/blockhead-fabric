import 'dotenv/config'

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'

import { WebSocketServer } from 'ws'

import { createLogger } from '../shared/log.js'

type JsonRpcId = number | string | null

type JsonRpcRequest = {
	jsonrpc?: string
	id?: JsonRpcId
	method?: string
	params?: unknown
}

type JsonRpcResponse = {
	jsonrpc: '2.0'
	id: JsonRpcId
	result?: unknown
	error?: {
		code: number
		message: string
		data?: unknown
	}
}

type LocalLassoConfig = {
	bindHost: string
	port: number
	requestTimeoutMs: number
	upstreamWssUrls: string[]
	upstreamHttpUrls: string[]
}

type UpstreamResult = {
	upstreamHttpUrl: string
	result: unknown
	elapsedMs: number
}

const DEFAULT_BIND_HOST = '127.0.0.1'
const DEFAULT_PORT = 8545
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

const getEnvNumber = (name: string, fallback: number) => {
	const rawValue = process.env[name] ?? String(fallback)
	const value = Number(rawValue)

	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`Invalid numeric environment variable: ${name}=${rawValue}`)
	}

	return value
}

const splitEnvList = (rawValue: string | undefined) => (
	(rawValue ?? '')
		.split(/[\s,]+/)
		.map((value) => value.trim())
		.filter(Boolean)
)

export const getRpcHttpUrl = (rpcWssUrl: string) => (
	rpcWssUrl
		.replace(/^wss:\/\//, 'https://')
		.replace(/^ws:\/\//, 'http://')
		.replace('/ws/', '/')
)

export const loadLocalLassoConfig = (): LocalLassoConfig => {
	const upstreamWssUrls = Array.from(new Set(splitEnvList(process.env.LASSO_UPSTREAM_WSS_URLS)))

	if (upstreamWssUrls.length === 0) {
		throw new Error('Missing required environment variable: LASSO_UPSTREAM_WSS_URLS')
	}

	return {
		bindHost: process.env.LASSO_BIND_HOST?.trim() || DEFAULT_BIND_HOST,
		port: getEnvNumber('LASSO_PORT', DEFAULT_PORT),
		requestTimeoutMs: getEnvNumber('RPC_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS),
		upstreamWssUrls,
		upstreamHttpUrls: upstreamWssUrls.map(getRpcHttpUrl),
	}
}

const createJsonRpcError = ({
	id,
	code,
	message,
	data,
}: {
	id: JsonRpcId
	code: number
	message: string
	data?: unknown
}): JsonRpcResponse => ({
	jsonrpc: '2.0',
	id,
	error: {
		code,
		message,
		data,
	},
})

const createJsonRpcResult = ({
	id,
	result,
}: {
	id: JsonRpcId
	result: unknown
}): JsonRpcResponse => ({
	jsonrpc: '2.0',
	id,
	result,
})

const isRecord = (value: unknown): value is Record<string, unknown> => (
	typeof value === 'object' && value !== null && !Array.isArray(value)
)

const parseJsonRpcRequest = (value: unknown): JsonRpcRequest => {
	if (!isRecord(value)) {
		throw new Error('Expected a JSON-RPC object request')
	}

	return value
}

const isReadOnlyRpcMethod = (method: string) => {
	const lower = method.toLowerCase()

	return !(
		lower.startsWith('eth_send')
		|| lower.startsWith('engine_')
		|| lower.startsWith('personal_')
		|| lower.startsWith('wallet_')
		|| lower.includes('sign')
	)
}

const createUpstreamRequestTask = ({
	upstreamHttpUrl,
	method,
	params,
	timeoutMs,
}: {
	upstreamHttpUrl: string
	method: string
	params: unknown
	timeoutMs: number
}) => {
	const controller = new AbortController()
	const startedAt = Date.now()
	const timeout = setTimeout(() => {
		controller.abort(new Error(`Timed out after ${timeoutMs}ms`))
	}, timeoutMs)

	const promise = (async (): Promise<UpstreamResult> => {
		try {
			const response = await fetch(upstreamHttpUrl, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method,
					params: params ?? [],
				}),
				signal: controller.signal,
			})

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			const payload = await response.json() as {
				result?: unknown
				error?: {
					code: number
					message: string
				}
			}

			if (payload.error) {
				throw new Error(`RPC ${payload.error.code}: ${payload.error.message}`)
			}

			return {
				upstreamHttpUrl,
				result: payload.result,
				elapsedMs: Date.now() - startedAt,
			}
		} finally {
			clearTimeout(timeout)
		}
	})()

	return {
		promise,
		abort: () => controller.abort(),
	}
}

const getAggregateErrorMessages = (error: unknown) => {
	if (!(error instanceof AggregateError)) {
		return [
			error instanceof Error ? error.message : String(error),
		]
	}

	return error.errors.map((cause) => (
		cause instanceof Error ? cause.message : String(cause)
	))
}

export const raceUpstreamRequests = async ({
	upstreamHttpUrls,
	method,
	params,
	timeoutMs,
}: {
	upstreamHttpUrls: string[]
	method: string
	params: unknown
	timeoutMs: number
}) => {
	if (!isReadOnlyRpcMethod(method)) {
		throw new Error(`Method not supported by local lasso proxy: ${method}`)
	}

	const tasks = upstreamHttpUrls.map((upstreamHttpUrl) => (
		createUpstreamRequestTask({
			upstreamHttpUrl,
			method,
			params,
			timeoutMs,
		})
	))

	try {
		return await Promise.any(tasks.map(({ promise }) => promise))
	} catch (error) {
		throw new Error(
			`All upstream RPC requests failed for ${method}: ${getAggregateErrorMessages(error).join(' | ')}`,
		)
	} finally {
		for (const task of tasks) {
			task.abort()
		}
	}
}

const readRequestBody = async (request: IncomingMessage) => {
	const chunks: Buffer[] = []

	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	}

	return Buffer.concat(chunks).toString('utf8')
}

const writeJson = ({
	response,
	statusCode,
	body,
}: {
	response: ServerResponse
	statusCode: number
	body: unknown
}) => {
	response.writeHead(statusCode, {
		'content-type': 'application/json',
	})
	response.end(JSON.stringify(body))
}

const handleSingleRequest = async ({
	payload,
	config,
}: {
	payload: unknown
	config: LocalLassoConfig
}): Promise<JsonRpcResponse | null> => {
	let request: JsonRpcRequest

	try {
		request = parseJsonRpcRequest(payload)
	} catch (error) {
		return createJsonRpcError({
			id: null,
			code: -32600,
			message: error instanceof Error ? error.message : 'Invalid request',
		})
	}

	const id = request.id ?? null

	if (!request.method || typeof request.method !== 'string') {
		return createJsonRpcError({
			id,
			code: -32600,
			message: 'JSON-RPC request missing method',
		})
	}

	try {
		const result = await raceUpstreamRequests({
			upstreamHttpUrls: config.upstreamHttpUrls,
			method: request.method,
			params: request.params,
			timeoutMs: config.requestTimeoutMs,
		})

		return id === null ?
			null
		:
			createJsonRpcResult({
				id,
				result: result.result,
			})
	} catch (error) {
		return createJsonRpcError({
			id,
			code: -32000,
			message: error instanceof Error ? error.message : String(error),
		})
	}
}

const handleHttpRequest = async ({
	request,
	response,
	config,
}: {
	request: IncomingMessage
	response: ServerResponse
	config: LocalLassoConfig
}) => {
	if (request.method !== 'POST') {
		response.writeHead(405)
		response.end()
		return
	}

	let parsedBody: unknown

	try {
		parsedBody = JSON.parse(await readRequestBody(request))
	} catch {
		writeJson({
			response,
			statusCode: 400,
			body: createJsonRpcError({
				id: null,
				code: -32700,
				message: 'Failed to parse JSON request body',
			}),
		})
		return
	}

	if (Array.isArray(parsedBody)) {
		const batchResponses = (await Promise.all(parsedBody.map((entry) => (
			handleSingleRequest({
				payload: entry,
				config,
			})
		)))).filter((entry): entry is JsonRpcResponse => entry !== null)

		if (batchResponses.length === 0) {
			response.writeHead(204)
			response.end()
			return
		}

		writeJson({
			response,
			statusCode: 200,
			body: batchResponses,
		})
		return
	}

	const singleResponse = await handleSingleRequest({
		payload: parsedBody,
		config,
	})

	if (!singleResponse) {
		response.writeHead(204)
		response.end()
		return
	}

	writeJson({
		response,
		statusCode: 200,
		body: singleResponse,
	})
}

export const startLocalLassoServer = async () => {
	const logger = createLogger()
	const config = loadLocalLassoConfig()
	const server = createServer((request, response) => {
		void handleHttpRequest({
			request,
			response,
			config,
		}).catch((error) => {
			logger.errorFrom('local_lasso.http.failed', error)
			if (!response.headersSent) {
				writeJson({
					response,
					statusCode: 500,
					body: createJsonRpcError({
						id: null,
						code: -32000,
						message: 'Local lasso proxy failed to handle request',
					}),
				})
				return
			}

			response.end()
		})
	})
	const wsServer = new WebSocketServer({
		server,
	})

	wsServer.on('connection', (socket) => {
		socket.on('message', (data) => {
			void (async () => {
				let parsedBody: unknown

				try {
					parsedBody = JSON.parse(data.toString())
				} catch {
					socket.send(JSON.stringify(createJsonRpcError({
						id: null,
						code: -32700,
						message: 'Failed to parse JSON request body',
					})))
					return
				}

				if (Array.isArray(parsedBody)) {
					const batchResponses = (await Promise.all(parsedBody.map((entry) => (
						handleSingleRequest({
							payload: entry,
							config,
						})
					)))).filter((entry): entry is JsonRpcResponse => entry !== null)

					if (batchResponses.length > 0) {
						socket.send(JSON.stringify(batchResponses))
					}

					return
				}

				const singleResponse = await handleSingleRequest({
					payload: parsedBody,
					config,
				})

				if (singleResponse) {
					socket.send(JSON.stringify(singleResponse))
				}
			})().catch((error) => {
				logger.errorFrom('local_lasso.ws.failed', error)
				socket.send(JSON.stringify(createJsonRpcError({
					id: null,
					code: -32000,
					message: 'Local lasso proxy failed to handle websocket request',
				})))
			})
		})
	})

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(config.port, config.bindHost, () => {
			server.removeListener('error', reject)
			resolve()
		})
	})

	logger.info('local_lasso.start', {
		bindHost: config.bindHost,
		port: config.port,
		upstreamCount: config.upstreamWssUrls.length,
		upstreams: config.upstreamWssUrls,
	})

	const close = async () => {
		await new Promise<void>((resolve, reject) => {
			wsServer.close((error) => {
				if (error) {
					reject(error)
					return
				}

				server.close((serverError) => {
					if (serverError) {
						reject(serverError)
						return
					}

					resolve()
				})
			})
		})
	}

	return {
		close,
	}
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntrypoint) {
	const logger = createLogger()
	const { close } = await startLocalLassoServer()
	let closing = false

	const shutdown = (signal: string) => {
		if (closing) {
			return
		}

		closing = true
		logger.info('local_lasso.stop', {
			signal,
		})
		void close().catch((error) => {
			logger.errorFrom('local_lasso.stop.failed', error, {
				signal,
			})
			process.exitCode = 1
		})
	}

	process.on('SIGINT', () => {
		shutdown('SIGINT')
	})
	process.on('SIGTERM', () => {
		shutdown('SIGTERM')
	})
}
