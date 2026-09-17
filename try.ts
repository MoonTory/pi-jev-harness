// Dry run of the routing and pre-fetch questions on a prompt, against the current directory:
//   node try.ts "fix the failing test in src/parser.ts"
import { execFileSync } from 'node:child_process'

import { ask, choiceOf, noulOf, relevanceQuestions, routingQuestions, THRESHOLDS } from './jev.ts'
import { namedIn, termsIn } from './route.ts'

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

const routed = await ask(
	{ prompt, cwd: process.cwd(), tools },
	routingQuestions(tools.map((t) => t.name))
)

const kind = choiceOf(routed.answers, 'kind')

console.log(
	`kind: ${kind.choice} (${kind.confidence.toFixed(2)})  ${routed.ms}ms ${routed.inputTokens} tok`
)

for (const tool of tools) {
	const p = noulOf(routed.answers, `use_${tool.name}`)
	console.log(
		`  ${p >= THRESHOLDS.toolNeeded ? 'keep' : 'hide'} ${tool.name.padEnd(6)} ${p.toFixed(2)}`
	)
}

const terms = termsIn(prompt)

const files = new Map<string, { term: string; line: string }[]>()

for (const term of terms) {
	let hits: string[] = []
	try {
		const args = ['-n', '-F', '--max-count', '1', '-g', '!node_modules', term, '.']
		hits = execFileSync('rg', args).toString().split('\n').filter(Boolean)
	} catch {
		// rg exits 1 when nothing matches.
	}
	if (hits.length > 20) continue
	for (const hit of hits) {
		const m = /^(.+?):\d+:(.*)$/.exec(hit)
		if (!m) continue
		const [, path = '', text = ''] = m
		files.set(path, [...(files.get(path) ?? []), { term, line: text.trim().slice(0, 120) }])
	}
}

const list = [...files.entries()].slice(0, 40).map(([path, matched]) => ({ path, matched }))

console.log(`terms: ${terms.join(', ') || '(none)'} → ${list.length} candidate files`)

if (list.length) {
	const named = namedIn(prompt, list).map((f) => f.path)
	if (named.length) console.log(`pinned (named in prompt): ${named.join(', ')}`)
	const rel = await ask({ task: prompt, files: list }, relevanceQuestions(list.map((f) => f.path)))
	const first = choiceOf(rel.answers, 'first')
	console.log(
		`relevance: ${rel.ms}ms ${rel.inputTokens} tok, first: ${first.choice} (${first.confidence.toFixed(2)})`
	)
	list
		.map((file, i) => ({ ...file, p: noulOf(rel.answers, `f${i}`) }))
		.sort((a, b) => b.p - a.p)
		.slice(0, 8)
		.forEach((file) =>
			console.log(
				`  ${file.p >= THRESHOLDS.prefetchFile ? 'read' : 'skip'} ${file.p.toFixed(2)} ${file.path}  (${file.matched.map((m) => m.term).join(', ')})`
			)
		)
}
