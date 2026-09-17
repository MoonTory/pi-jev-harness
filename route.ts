import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext
} from '@earendil-works/pi-coding-agent'

import { choiceOf, noulOf, relevanceQuestions, routingQuestions, THRESHOLDS } from './jev.ts'
import { active, short, THRESHOLD_ALWAYS_KEEP, type Candidate, type Harness } from './types.ts'

const STOPWORDS = new Set([
	'about',
	'after',
	'again',
	'before',
	'being',
	'could',
	'does',
	'doing',
	'every',
	'first',
	'from',
	'have',
	'here',
	'into',
	'just',
	'like',
	'make',
	'more',
	'most',
	'need',
	'only',
	'other',
	'please',
	'should',
	'some',
	'than',
	'that',
	'them',
	'then',
	'there',
	'these',
	'they',
	'this',
	'those',
	'through',
	'want',
	'what',
	'when',
	'where',
	'which',
	'while',
	'with',
	'work',
	'would',
	'your'
])

/** Words in the prompt that could name code: paths, file names, identifiers, quoted strings, then plain words. */
export function termsIn(prompt: string): string[] {
	const out = new Set<string>()
	for (const m of prompt.matchAll(/`([^`]{2,80})`|"([^"]{2,80})"|'([^']{2,80})'/g)) {
		out.add((m[1] ?? m[2] ?? m[3] ?? '').trim())
	}
	for (const m of prompt.matchAll(
		/\b[\w.-]+\/[\w./-]+\b|\b[\w-]+\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|css|html|json|md|ya?ml|toml)\b/g
	)) {
		out.add(m[0])
	}
	for (const m of prompt.matchAll(
		/\b[a-z]+[A-Z][A-Za-z0-9]+\b|\b[a-z0-9]+_[a-z0-9_]+\b|\b[A-Z][a-z]+[A-Z][A-Za-z]+\b/g
	)) {
		out.add(m[0])
	}
	for (const m of prompt.matchAll(/\b[a-z]{4,}\b/g)) {
		if (!STOPWORDS.has(m[0])) out.add(m[0])
	}
	return [...out].filter((t) => t.length >= 3 && !/^https?:/.test(t)).slice(0, 8)
}

async function candidateFiles(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	terms: string[]
): Promise<Candidate[]> {
	const files = new Map<string, { term: string; line: string }[]>()
	for (const term of terms) {
		const args = [
			'-n',
			'-F',
			'--max-count',
			'1',
			'-g',
			'!node_modules',
			'-g',
			'!dist',
			'-g',
			'!.git',
			term,
			'.'
		]
		const options = { cwd: ctx.cwd, timeout: 4000, ...(ctx.signal ? { signal: ctx.signal } : {}) }
		const res = await pi.exec('rg', args, options).catch(() => null)
		const hits = (res?.stdout ?? '').split('\n').filter(Boolean)
		if (hits.length > 20) continue // a term that is everywhere says nothing
		for (const hit of hits) {
			const m = /^(.+?):\d+:(.*)$/.exec(hit)
			if (!m) continue
			const [, path = '', text = ''] = m
			files.set(path, [...(files.get(path) ?? []), { term, line: text.trim().slice(0, 120) }])
		}
	}
	return [...files.entries()].slice(0, 40).map(([path, matched]) => ({ path, matched }))
}

function readHead(cwd: string, path: string, maxLines: number): string | null {
	try {
		const lines = readFileSync(join(cwd, path), 'utf8').split('\n')
		const body = lines
			.slice(0, maxLines)
			.map((line, i) => `${String(i + 1).padStart(4)}  ${line}`)
			.join('\n')
		const note = lines.length > maxLines ? ` (first ${maxLines} of ${lines.length} lines)` : ''
		return `--- ${path}${note}\n${body}`
	} catch {
		// Deleted or unreadable since rg listed it.
		return null
	}
}

/** Step 2: pick the files worth reading before the model starts and return them as one message. */
async function prefetch(
	h: Harness,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	prompt: string
): Promise<{ message: string; note: string } | null> {
	const terms = termsIn(prompt)
	if (!terms.length) return null
	const list = await candidateFiles(pi, ctx, terms)
	if (!list.length) return null
	const result = await h.jev(
		'prefetch',
		{ task: prompt, files: list },
		relevanceQuestions(list.length),
		ctx
	)
	if (!result) return null
	const picked = list
		.map((file, i) => ({ ...file, p: noulOf(result.answers, `f${i}`) }))
		.filter((file) => file.p >= THRESHOLDS.prefetchFile)
		.sort((a, b) => b.p - a.p)
		.slice(0, h.config.prefetchFiles)
	const parts = picked
		.map((file) => readHead(ctx.cwd, file.path, h.config.prefetchLines))
		.filter((p) => p !== null)
	if (!parts.length) return null
	h.stats.prefetched += parts.length
	const note = `prefetched ${picked.map((f) => `${f.path} ${f.p.toFixed(2)}`).join(', ')} of ${list.length} candidates`
	const message = `Context pre-fetched by jev-harness for this request (matched terms: ${terms.join(', ')}). Read these files again only if you need lines beyond what is shown.\n\n${parts.join('\n\n')}`
	return { message, note }
}

/** Step 1: ask which kind of turn this is and which tools it needs; hide the rest for the turn. */
async function route(
	h: Harness,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	prompt: string
): Promise<{ kind: string; note: string } | null> {
	const names = pi.getActiveTools()
	const tools = pi
		.getAllTools()
		.filter((t) => names.includes(t.name))
		.map((t) => ({ name: t.name, description: short(t.description, 200) }))
	const result = await h.jev('route', { prompt, cwd: ctx.cwd, tools }, routingQuestions(names), ctx)
	if (!result) return null
	const kind = choiceOf(result.answers, 'kind')
	const keep = names.filter(
		(n) =>
			THRESHOLD_ALWAYS_KEEP.includes(n) ||
			noulOf(result.answers, `use_${n}`) >= THRESHOLDS.toolNeeded
	)
	const hidden = names.filter((n) => !keep.includes(n))
	let note = `kind ${kind.choice} (${kind.confidence.toFixed(2)}), tools ${keep.join(',')}`
	if (hidden.length) note += ` (hidden: ${hidden.join(',')})`
	if (h.config.mode === 'on' && kind.choice !== 'answer' && hidden.length) {
		h.allTools = names
		pi.setActiveTools(keep)
		h.stats.toolsHidden += hidden.length
	}
	if (h.config.mode === 'on' && kind.choice === 'unclear' && kind.confidence >= 0.7) {
		note += '; ask one clarifying question before using tools'
	}
	return { kind: kind.choice, note }
}

export async function onBeforeAgentStart(
	h: Harness,
	pi: ExtensionAPI,
	event: BeforeAgentStartEvent,
	ctx: ExtensionContext
) {
	h.task = event.prompt
	h.recent.length = 0
	h.loopChecked = false
	if (!active(h)) return undefined
	h.stats.turns++
	const notes: string[] = []
	let message: string | undefined
	if (h.config.route) {
		const routed = await route(h, pi, ctx, event.prompt)
		if (routed) notes.push(routed.note)
		const wantsContext = routed?.kind === 'explore' || routed?.kind === 'change'
		if (h.config.prefetch && wantsContext) {
			const fetched = await prefetch(h, pi, ctx, event.prompt)
			if (fetched) {
				notes.push(fetched.note)
				message = fetched.message
			}
		}
	}
	h.status(ctx, notes[0] ? `jev ${notes[0]}` : `jev-harness ${h.config.mode}`)
	if (h.config.mode !== 'on') return undefined
	const systemPrompt = notes.length
		? `${event.systemPrompt}\n\njev-harness routed this turn: ${notes.join('; ')}. Tools not listed are hidden for this turn; say so if you need one.`
		: undefined
	return {
		...(systemPrompt ? { systemPrompt } : {}),
		...(message ? { message: { customType: 'jev-harness', content: message, display: true } } : {})
	}
}
