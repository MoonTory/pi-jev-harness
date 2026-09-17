import { readdir } from 'node:fs/promises'

const directory = new URL('./src/rules/', import.meta.url)
const files = (await readdir(directory)).filter((file) => file.endsWith('.test.ts')).sort()

for (const file of files) {
	process.stdout.write(`${file}\n`)
	await import(new URL(file, directory).href)
}
