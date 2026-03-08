import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { connectDb } from './connect.js'

const directoryName = path.dirname(fileURLToPath(import.meta.url))
const migrationsDirectory = path.join(directoryName, 'migrations')

const run = async () => {
	const databaseUrl = process.env.DATABASE_URL

	if (!databaseUrl) {
		throw new Error('DATABASE_URL is required')
	}

	const db = connectDb({
		databaseUrl,
	})

	try {
		const files = (await readdir(migrationsDirectory))
			.filter((file) => (
				file.endsWith('.sql')
			))
			.sort()

		for (const file of files) {
			const sql = await readFile(path.join(migrationsDirectory, file), 'utf8')
			await db.query(sql)
			console.log(`Applied migration ${file}`)
		}
	} finally {
		await db.end()
	}
}

void run()
