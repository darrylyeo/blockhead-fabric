import 'dotenv/config'

/**
 * End-to-end run: migrate → ingest → projection → publisher → validate.
 *
 * Requires: Postgres, the local Fabric server, Manifolder.
 * 1. Start Postgres.
 * 2. Start the Fabric server (for example `pnpm service:fabric:up`) so .msf is at FABRIC_URL
 *    (default http://localhost:2000/fabric/70/1/ for the explicit RMRoot descriptor).
 * 3. Bootstrap Fabric if needed (login/admin so publisher can connect).
 * 4. Start Manifolder (e.g. http://localhost:3000/app.html).
 * 5. Set DATABASE_URL, RPC_WSS_URL; optionally FABRIC_URL, FABRIC_ADMIN_KEY, MANIFOLDER_URL.
 * 6. Run: pnpm service:test:e2e
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = `${__dirname}/..`

const requiredEnv = ['DATABASE_URL', 'RPC_WSS_URL'] as const

for (const key of requiredEnv) {
	if (!process.env[key]) {
		console.error(`Missing required env: ${key}`)
		process.exitCode = 1
		process.exit(1)
	}
}

const run = (
	cmd: string,
	args: string[],
	opts: { timeoutMs?: number } = {},
) => new Promise<{ code: number | null, signal: string | null }>((resolve, reject) => {
	const child = spawn(cmd, args, {
		cwd: root,
		env: process.env,
		stdio: 'inherit',
	})

	const timeoutMs = opts.timeoutMs ?? 0
	let timeout: ReturnType<typeof setTimeout> | undefined

	if (timeoutMs > 0) {
		timeout = setTimeout(() => {
			child.kill('SIGINT')
			timeout = undefined
		}, timeoutMs)
	}

	child.on('close', (code, signal) => {
		if (timeout) clearTimeout(timeout)
		resolve({
			code,
			signal: signal ? String(signal) : null,
		})
	})

	child.on('error', (err) => {
		if (timeout) clearTimeout(timeout)
		reject(err)
	})
})

const ingestSeconds = Number(process.env.INGEST_E2E_SECONDS ?? 60)
const projectionSeconds = Number(process.env.PROJECTION_E2E_SECONDS ?? 30)
const publisherSeconds = Number(process.env.PUBLISHER_E2E_SECONDS ?? 20)

const main = async () => {
	console.log('e2e: migrate')
	const { code: migrateCode } = await run('pnpm', ['exec', 'tsx', 'src/db/migrate.ts'])

	if (migrateCode !== 0) {
		console.error('e2e: migrate failed')
		process.exit(1)
	}

	console.log(`e2e: ingest (${ingestSeconds}s)`)
	const { code: ingestCode, signal: ingestSignal } = await run(
		'pnpm',
		['exec', 'tsx', 'src/ingest/index.ts'],
		{ timeoutMs: ingestSeconds * 1000 },
	)

	const exitOk = (code: number | null, signal: string | null) => (
		code === 0 || code === 130 || (code === null && signal !== null)
	)

	if (!exitOk(ingestCode, ingestSignal)) {
		console.error('e2e: ingest exited with error')
		process.exit(1)
	}

	console.log(`e2e: projection (${projectionSeconds}s)`)
	const { code: projectionCode, signal: projectionSignal } = await run(
		'pnpm',
		['exec', 'tsx', 'src/projection/index.ts'],
		{ timeoutMs: projectionSeconds * 1000 },
	)

	if (!exitOk(projectionCode, projectionSignal)) {
		console.error('e2e: projection exited with error')
		process.exit(1)
	}

	console.log(`e2e: publisher (${publisherSeconds}s)`)
	const { code: publisherCode, signal: publisherSignal } = await run(
		'pnpm',
		['exec', 'tsx', 'src/publisher/index.ts'],
		{ timeoutMs: publisherSeconds * 1000 },
	)

	if (!exitOk(publisherCode, publisherSignal)) {
		console.error('e2e: publisher exited with error')
		process.exit(1)
	}

	const fabricUrl = process.env.FABRIC_URL ?? 'http://localhost:2000/fabric/70/1/'
	const fabricRes = await fetch(fabricUrl, { headers: { accept: 'application/json' } })
	if (!fabricRes.ok) {
		console.error('e2e: fabric root descriptor fetch failed', { fabricUrl, status: fabricRes.status })
		process.exit(1)
	}
	const fabricBody = (await fabricRes.json()) as { map?: unknown }
	const descriptor = (fabricBody?.map ?? fabricBody) as { sConnect?: unknown, wClass?: unknown, twObjectIx?: unknown }
	if (
		typeof descriptor.sConnect !== 'string' ||
		typeof descriptor.wClass !== 'number' ||
		(typeof descriptor.twObjectIx !== 'number' && typeof descriptor.twObjectIx !== 'string')
	) {
		console.error('e2e: fabric root descriptor fetch failed', { fabricUrl, reason: 'invalid root descriptor', descriptor })
		process.exit(1)
	}
	console.log('e2e: fabric root descriptor ok', { fabricUrl, wClass: descriptor.wClass, twObjectIx: String(descriptor.twObjectIx) })

	const db = new Pool({ connectionString: process.env.DATABASE_URL })
	const { rows: checkpointRows } = await db.query(
		'select count(*)::int as n from publication_checkpoints where status in (\'failed\', \'degraded\')',
	)
	if ((checkpointRows[0]?.n ?? 0) > 0) {
		console.error('e2e: publisher reconcile failed', { failedOrDegraded: checkpointRows[0]?.n })
		process.exit(1)
	}
	console.log('e2e: publisher reconcile ok')

	const manifolderUrl = process.env.MANIFOLDER_URL ?? 'http://localhost:3000/app.html'
	const manifolderPageUrl = `${manifolderUrl}?msf=${encodeURIComponent(fabricUrl)}`
	const manifolderRes = await fetch(manifolderPageUrl)
	if (!manifolderRes.ok) {
		console.error('e2e: Manifolder page fetch failed', { manifolderPageUrl, status: manifolderRes.status })
		process.exit(1)
	}
	const manifolderHtml = await manifolderRes.text()
	if (!manifolderHtml.includes('Manifolder') || !manifolderHtml.includes('hierarchy')) {
		console.error('e2e: Manifolder page content unexpected')
		process.exit(1)
	}
	console.log('e2e: Manifolder ok', { manifolderUrl })

	const { rows: blockRows } = await db.query(
		'select count(*)::int as n from blocks where canonical = true',
	)
	const { rows: scopeRows } = await db.query('select count(*)::int as n from fabric_scopes')
	const { rows: objectRows } = await db.query('select count(*)::int as n from fabric_objects')
	await db.end()
	const canonicalBlocks = blockRows[0]?.n ?? 0
	const scopes = scopeRows[0]?.n ?? 0
	const objects = objectRows[0]?.n ?? 0
	if (canonicalBlocks === 0 || scopes === 0 || objects === 0) {
		console.error('e2e: validation failed', {
			canonicalBlocks,
			fabricScopes: scopes,
			fabricObjects: objects,
		})
		process.exit(1)
	}
	console.log('e2e: validation ok', { canonicalBlocks, fabricScopes: scopes, fabricObjects: objects })
	console.log('e2e: done')
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
