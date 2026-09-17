// Dry run of the routing and pre-fetch decisions on a prompt, against the current directory:
//   node try.ts "fix the failing test in src/parser.ts"
import { execFileSync } from 'node:child_process'

import { ask, choiceOf, noulOf, relevanceQuestions, routingQuestions, THRESHOLDS } from './jev.ts'
import { readRegions, termsIn } from './route.ts'

const CANDIDATE_LIMIT = 40

const PREFETCH_FILES = 2

const PREFETCH_LINES = 120

const IGNORED_GLOBS = ['-g', '!node_modules', '-g', '!dist', '-g', '!.git']

const prompt =
	process.argv.slice(2).join(' ') || 'where is the tick loop and how does the veto work?'

const tools = [
	['read', 'Read file contents'],
	['bash', 'Run a shell command'],
	['edit', 'Make a targeted edit to a file'],
	['write', 'Create or overwrite a file'],
	['grep', 'Search file contents with regex'],
	['find', 'Find files by glob'],
	['ls', 'List a directory']
].map(([name = '', description = '']) => ({ name, description }))

function runRg(args: string[]): string[] {
	try {
		return execFileSync('rg', args).toString().split('\n').filter(Boolean)
	} catch {
		// rg exits 1 when nothing matches.
		return []
	}
}

function namedFileIn(terms: string[]): boolean {
	return terms.some((term) => {
		if (!term.includes('/') && !/\.[A-Za-z0-9]+$/.test(term)) return false
		const base = term.split('/').pop() ?? term
		return (
			runRg(['--files', '--max-filesize', '200K', '-g', `**/${base}`, ...IGNORED_GLOBS]).length > 0
		)
	})
}

function candidates(terms: string[]) {
	const files = new Map<string, { term: string; line: string; at: number }[]>()
	for (const term of terms) {
		if (files.size >= CANDIDATE_LIMIT) break
		const hits = runRg([
			'-n',
			'-F',
			'--max-filesize',
			'200K',
			'--max-count',
			'1',
			'--max-columns',
			'200',
			...IGNORED_GLOBS,
			term,
			'.'
		])
		if (hits.length > 20) continue
		for (const hit of hits) {
			if (files.size >= CANDIDATE_LIMIT) break
			const match = /^(.+?):(\d+):(.*)$/.exec(hit)
			if (!match) continue
			const [, path = '', at = '', text = ''] = match
			files.set(path, [
				...(files.get(path) ?? []),
				{ term, line: text.trim().slice(0, 120), at: Number(at) }
			])
		}
	}
	return [...files.entries()].map(([path, matched]) => ({ path, matched }))
}

const routed = await ask(
	{ prompt, cwd: process.cwd(), tools },
	routingQuestions(tools.map((tool) => tool.name))
)

const kind = choiceOf(routed.answers, 'kind')

console.log(
	`kind: ${kind.choice} (${kind.confidence.toFixed(2)})  ${routed.ms}ms ${routed.inputTokens} tok`
)

for (const tool of tools) {
	const probability = noulOf(routed.answers, `use_${tool.name}`)
	console.log(
		`  ${probability >= THRESHOLDS.toolNeeded ? 'keep' : 'hide'} ${tool.name.padEnd(6)} ${probability.toFixed(2)}`
	)
}

const terms = termsIn(prompt)

if (namedFileIn(terms)) {
	console.log('named file in prompt → no pre-fetch')
} else {
	const list = candidates(terms)
	console.log(`terms: ${terms.join(', ') || '(none)'} → ${list.length} candidate files`)
	if (list.length) {
		const relevance = await ask(
			{ task: prompt, files: list },
			relevanceQuestions(list.map((file) => file.path))
		)
		const first = choiceOf(relevance.answers, 'first')
		console.log(
			`relevance: ${relevance.ms}ms ${relevance.inputTokens} tok, first: ${first.choice} (${first.confidence.toFixed(2)})`
		)
		const ranked = list
			.map((file, index) => {
				const noul = noulOf(relevance.answers, `f${index}`)
				const confidence = file.path === first.choice ? first.confidence : 0
				return { ...file, score: Math.max(noul, confidence) }
			})
			.sort((a, b) => b.score - a.score)
		const injected = ranked
			.filter((file) => file.score >= THRESHOLDS.prefetchFile)
			.slice(0, PREFETCH_FILES)
		const injectedPaths = new Set(injected.map((file) => file.path))
		console.log(`ranked files; ${injected.length} to inject:`)
		for (const file of ranked) {
			const read = readRegions(
				process.cwd(),
				file.path,
				file.matched.map((match) => match.at),
				PREFETCH_LINES
			)
			const ranges =
				read?.ranges.map((range) => `${range.start}-${range.end}`).join(', ') ?? 'unreadable'
			const decision = injectedPaths.has(file.path) ? 'inject' : 'skip'
			console.log(`  ${decision} ${file.score.toFixed(2)} ${file.path}:${ranges}`)
		}
	}
}
