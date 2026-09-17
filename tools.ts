import type {
	ExtensionContext,
	ToolCallEvent,
	ToolResultEvent
} from '@earendil-works/pi-coding-agent'

import {
	choiceOf,
	guardQuestions,
	loopQuestions,
	noulOf,
	resultQuestions,
	scoreOf,
	THRESHOLDS,
	type Answers
} from './jev.ts'
import { active, READ_TOOLS, short, type Block, type Harness } from './types.ts'

const resultText = (event: ToolResultEvent): string =>
	event.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n')

/** Step 4: the same call three times in the last twelve gets a second opinion. */
function loopVerdict(
	h: Harness,
	answers: Answers,
	event: ToolCallEvent,
	repeats: number
): Block | undefined {
	h.loopChecked = true
	const stuck = noulOf(answers, 'stuck')
	if (stuck < THRESHOLDS.stuck) return undefined
	h.stats.loopsCaught++
	if (h.config.mode !== 'on') return undefined
	const advice =
		noulOf(answers, 'wrong_approach') >= 0.5
			? 'Try a different approach or ask the user.'
			: 'Check the earlier result before running it again.'
	return {
		block: true,
		reason: `jev-harness: this is the ${repeats}th time you ran the same ${event.toolName} call and Jev judges you are stuck (${stuck.toFixed(2)}). ${advice}`
	}
}

function guardReason(answers: Answers): string | null {
	const secrets = noulOf(answers, 'secrets')
	if (secrets >= THRESHOLDS.secrets) return `may expose credentials (${secrets.toFixed(2)})`
	const risk = scoreOf(answers, 'risk')
	if (risk.confidence < THRESHOLDS.askConfidence) return null
	const level = Math.round(risk.score)
	if (level === 3) return `destructive (${risk.confidence.toFixed(2)})`
	if (level === 2) return `hard to reverse (${risk.confidence.toFixed(2)})`
	return null
}

/** Step 5: destructive or secret-touching calls need a human. */
async function guardVerdict(
	h: Harness,
	answers: Answers,
	event: ToolCallEvent,
	ctx: ExtensionContext
): Promise<Block | undefined> {
	const reason = guardReason(answers)
	if (!reason) return undefined
	h.stats.guardAsked++
	h.status(ctx, `jev guard: ${reason}`)
	if (h.config.mode !== 'on') return undefined
	const what = event.toolName === 'bash' ? String(event.input.command) : short(event.input, 400)
	if (ctx.hasUI) {
		const ok = await ctx.ui.confirm(
			`jev-harness: ${reason}`,
			`${event.toolName}: ${what}\n\nRun it?`
		)
		if (ok) return undefined
	}
	h.stats.guardBlocked++
	const who = ctx.hasUI ? 'The user declined.' : 'No one is here to confirm; ask the user first.'
	return { block: true, reason: `jev-harness blocked this call: ${reason}. ${who}` }
}

export async function onToolCall(
	h: Harness,
	event: ToolCallEvent,
	ctx: ExtensionContext
): Promise<Block | undefined> {
	if (!active(h)) return undefined
	const key = `${event.toolName}:${JSON.stringify(event.input)}`
	h.recent.push({ tool: event.toolName, key, input: event.input })
	if (h.recent.length > 12) h.recent.shift()
	const repeats = h.recent.filter((r) => r.key === key).length
	const checkLoop = h.config.loop && repeats >= 3 && !h.loopChecked
	const checkGuard = h.config.guard && !READ_TOOLS.includes(event.toolName)
	if (!checkLoop && !checkGuard) return undefined
	const questions = { ...(checkLoop ? loopQuestions : {}), ...(checkGuard ? guardQuestions : {}) }
	const state = {
		task: h.task,
		tool: event.toolName,
		input: event.input,
		cwd: ctx.cwd,
		recentCalls: h.recent.map((c) => ({ tool: c.tool, input: short(c.input, 160) }))
	}
	const result = await h.jev('tool_call', state, questions, ctx)
	if (!result) return undefined
	if (checkLoop) {
		const blocked = loopVerdict(h, result.answers, event, repeats)
		if (blocked) return blocked
	}
	if (checkGuard) return guardVerdict(h, result.answers, event, ctx)
	return undefined
}

/** Step 3: cut tool output the model does not need before it lands in context. */
export async function onToolResult(h: Harness, event: ToolResultEvent, ctx: ExtensionContext) {
	if (!active(h) || !h.config.trim || event.isError) return undefined
	if (!['bash', 'grep', 'find', 'read', 'ls'].includes(event.toolName)) return undefined
	const full = resultText(event)
	if (full.length < h.config.trimMinChars) return undefined
	const state = {
		task: h.task,
		tool: event.toolName,
		input: event.input,
		totalChars: full.length,
		head: full.slice(0, 1500),
		tail: full.slice(-500)
	}
	const result = await h.jev('result', state, resultQuestions, ctx)
	if (!result) return undefined
	const keep = choiceOf(result.answers, 'keep')
	const relevant = noulOf(result.answers, 'relevant')
	const succeeded = noulOf(result.answers, 'succeeded') >= 0.5 ? 'successfully' : 'with problems'
	let replacement: string | null = null
	if (keep.choice === 'drop' && relevant < THRESHOLDS.dropResult && keep.confidence >= 0.6) {
		replacement = `[jev-harness dropped ${full.length} chars of ${event.toolName} output judged not needed for the task (relevance ${relevant.toFixed(2)}). It ran ${succeeded}. Re-run it if you need the output.]`
	} else if (
		keep.choice === 'head' &&
		keep.confidence >= 0.6 &&
		full.length > h.config.keepHeadChars
	) {
		const cut = full.length - h.config.keepHeadChars
		replacement = `${full.slice(0, h.config.keepHeadChars)}\n[jev-harness cut ${cut} more chars judged repetitive (relevance ${relevant.toFixed(2)}). Re-run with a narrower filter if you need them.]`
	}
	if (!replacement) return undefined
	h.stats.trimmed++
	h.stats.charsSaved += full.length - replacement.length
	h.status(ctx, `jev trim: ${keep.choice}, saved ${full.length - replacement.length} chars`)
	if (h.config.mode !== 'on') return undefined
	return { content: [{ type: 'text' as const, text: replacement }] }
}
