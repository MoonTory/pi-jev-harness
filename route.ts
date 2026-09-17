import { closeSync, openSync, readSync } from 'node:fs'
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

const CANDIDATE_LIMIT = 40

const READ_BYTES = 64 * 1024

const IGNORED_GLOBS = ['-g', '!node_modules', '-g', '!dist', '-g', '!.git']

type Region = { start: number; end: number }

type ReadRegions = { content: string; ranges: Region[]; hasMoreLines: boolean }

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
	return [...out].filter((term) => term.length >= 3 && !/^https?:/.test(term)).slice(0, 8)
}

/** `src/foo.ts` or `foo.ts`, not `v2.0` or `e.g.`: the extension must be letters. */
function looksLikeFile(term: string): boolean {
	return /^[\w./-]*\w\.[A-Za-z]{1,8}$/.test(term)
}

function fileArgs(term: string): string[] {
	const base = term.split('/').pop() ?? term
	return ['--files', '--max-filesize', '200K', '-g', `**/${base}`, ...IGNORED_GLOBS]
}

async function hasNamedFile(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	terms: string[]
): Promise<boolean> {
	const options = { cwd: ctx.cwd, timeout: 2000, ...(ctx.signal ? { signal: ctx.signal } : {}) }
	for (const term of terms) {
		if (!looksLikeFile(term)) continue
		const result = await pi.exec('rg', fileArgs(term), options).catch(() => null)
		const paths = (result?.stdout ?? '').split('\n').filter(Boolean)
		// A path in the prompt must match as a path, not just by basename.
		if (paths.some((path) => path === term || path.endsWith(`/${term}`))) return true
	}
	return false
}

async function candidateFiles(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	terms: string[],
	sent: Set<string>
): Promise<Candidate[]> {
	const files = new Map<string, Candidate['matched']>()
	const options = { cwd: ctx.cwd, timeout: 2000, ...(ctx.signal ? { signal: ctx.signal } : {}) }
	for (const term of terms) {
		if (files.size >= CANDIDATE_LIMIT) break
		const args = [
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
		]
		const result = await pi.exec('rg', args, options).catch(() => null)
		const hits = (result?.stdout ?? '').split('\n').filter(Boolean)
		if (hits.length > 20) continue
		for (const hit of hits) {
			if (files.size >= CANDIDATE_LIMIT) break
			const match = /^(.+?):(\d+):(.*)$/.exec(hit)
			if (!match) continue
			const [, path = '', at = '', text = ''] = match
			if (sent.has(path)) continue
			files.set(path, [
				...(files.get(path) ?? []),
				{ term, line: text.trim().slice(0, 120), at: Number(at) }
			])
		}
	}
	return [...files.entries()].map(([path, matched]) => ({ path, matched }))
}

export function readRegions(
	cwd: string,
	path: string,
	lineNumbers: number[],
	maxLines: number
): ReadRegions | null {
	try {
		const file = openSync(join(cwd, path), 'r')
		try {
			const buffer = Buffer.alloc(READ_BYTES)
			const size = readSync(file, buffer, 0, buffer.length, 0)
			const text = buffer.toString('utf8', 0, size)
			// Drop a cut-off last line when the file is bigger than the buffer, and the empty line after a final newline.
			const whole =
				size === READ_BYTES ? text.slice(0, text.lastIndexOf('\n')) : text.replace(/\n$/, '')
			const lines = whole.split('\n')
			const windows = lineNumbers
				.filter((line) => line > 0 && line <= lines.length)
				.sort((a, b) => a - b)
				.map((line) => ({ start: Math.max(1, line - 15), end: Math.min(lines.length, line + 15) }))
			const merged = windows.reduce<Region[]>((regions, window) => {
				const last = regions.at(-1)
				if (last && window.start <= last.end + 1) last.end = Math.max(last.end, window.end)
				else regions.push(window)
				return regions
			}, [])
			const ranges: Region[] = []
			let remaining = maxLines
			for (const region of merged) {
				if (remaining <= 0) break
				const end = Math.min(region.end, region.start + remaining - 1)
				ranges.push({ start: region.start, end })
				remaining -= end - region.start + 1
			}
			if (!ranges.length) return null
			const content = ranges
				.map((region) => {
					const body = lines
						.slice(region.start - 1, region.end)
						.map((line, index) => `${String(region.start + index).padStart(4)}  ${line}`)
						.join('\n')
					return `--- ${path}:${region.start}-${region.end}\n${body}`
				})
				.join('\n\n')
			const selectedLines = ranges.reduce((total, range) => total + range.end - range.start + 1, 0)
			return { content, ranges, hasMoreLines: size === READ_BYTES || selectedLines < lines.length }
		} finally {
			closeSync(file)
		}
	} catch {
		// Deleted or unreadable since rg listed it.
		return null
	}
}

/** Step 2: pick vague-prompt files worth reading before the model starts. */
async function prefetch(
	h: Harness,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	prompt: string
): Promise<{ message?: string; note: string } | null> {
	const terms = termsIn(prompt)
	if (!terms.length) return null
	if (await hasNamedFile(pi, ctx, terms)) return { note: 'named file, model reads it' }
	const list = await candidateFiles(pi, ctx, terms, h.sent)
	if (!list.length) return null
	const paths = list.map((file) => file.path)
	const result = await h.jev(
		'prefetch',
		{ task: prompt, files: list },
		relevanceQuestions(paths),
		ctx
	)
	if (!result) return null
	const first = choiceOf(result.answers, 'first')
	const picked = paths
		.map((path, index) => {
			const noul = noulOf(result.answers, `f${index}`)
			const confidence = path === first.choice ? first.confidence : 0
			return { path, score: Math.max(noul, confidence) }
		})
		.filter((file) => file.score >= THRESHOLDS.prefetchFile)
		.sort((a, b) => b.score - a.score)
		.slice(0, h.config.prefetchFiles)
	const parts = picked.flatMap((file) => {
		const candidate = list.find((item) => item.path === file.path)
		const read = readRegions(
			ctx.cwd,
			file.path,
			candidate?.matched.map((match) => match.at) ?? [],
			h.config.prefetchLines
		)
		if (!read) return []
		if (h.config.mode === 'on') h.sent.add(file.path)
		return [{ path: file.path, read }]
	})
	if (!parts.length) return null
	h.stats.prefetched += parts.length
	const regions = parts.flatMap(({ path, read }) =>
		read.ranges.map((range) => `${path}:${range.start}-${range.end}`)
	)
	const moreLines = parts.filter((part) => part.read.hasMoreLines).map((part) => part.path)
	const moreNote = moreLines.length
		? ` More lines outside the excerpt: ${moreLines.join(', ')}.`
		: ''
	const message = `Context pre-fetched by jev-harness for this request. These excerpts show matching regions.${moreNote}\n\n${parts.map((part) => part.read.content).join('\n\n')}`
	return { message, note: `pre-fetched ${regions.join(', ')}` }
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
		.filter((tool) => names.includes(tool.name))
		.map((tool) => ({ name: tool.name, description: short(tool.description, 200) }))
	const result = await h.jev('route', { prompt, cwd: ctx.cwd, tools }, routingQuestions(names), ctx)
	if (!result) return null
	const kind = choiceOf(result.answers, 'kind')
	const keep = names.filter(
		(name) =>
			THRESHOLD_ALWAYS_KEEP.includes(name) ||
			noulOf(result.answers, `use_${name}`) >= THRESHOLDS.toolNeeded
	)
	const hidden = names.filter((name) => !keep.includes(name))
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
	if (h.config.route || h.config.prefetch) h.status(ctx, 'jev: looking for context…')
	const routePromise = h.config.route ? route(h, pi, ctx, event.prompt) : Promise.resolve(null)
	const prefetchPromise = h.config.prefetch
		? prefetch(h, pi, ctx, event.prompt)
		: Promise.resolve(null)
	const [routed, fetched] = await Promise.all([routePromise, prefetchPromise]).catch(
		(err: unknown) => {
			h.stats.errors++
			h.log({ what: 'error', error: err instanceof Error ? err.message : String(err) })
			return [null, null] as const
		}
	)
	const notes = [routed?.note, fetched?.note].filter((note): note is string => !!note)
	h.status(ctx, notes[0] ? `jev ${notes.join('; ')}` : `jev-harness ${h.config.mode}`)
	if (h.config.mode !== 'on') return undefined
	const systemPrompt = routed
		? `${event.systemPrompt}\n\njev-harness routed this turn: ${routed.note}. Tools not listed are hidden for this turn; say so if you need one.`
		: undefined
	return {
		...(systemPrompt ? { systemPrompt } : {}),
		...(fetched?.message
			? { message: { customType: 'jev-harness', content: fetched.message, display: false } }
			: {})
	}
}
