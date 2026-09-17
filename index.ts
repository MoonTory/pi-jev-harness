/**
 * jev-harness: let TypeSafe's Jev do the reasoning around tool calls so the main model does not have to.
 *
 * 1. route     before_agent_start: Jev picks the kind of turn and which tools it will need; the rest are hidden for the turn
 * 2. prefetch  before_agent_start: code finds candidate files from terms in the prompt, Jev picks which to read, they are injected
 * 3. trim      tool_result: Jev judges whether the output matters; irrelevant or repetitive output is cut before the model sees it
 * 4. loop      tool_call: repeated calls are checked with Jev and blocked with a reason when it says the agent is stuck
 * 5. guard     tool_call: risk and secrets, in the same request as loop control; destructive calls prompt or block
 *
 * All questions and thresholds live in jev.ts. Every Jev call is logged to ~/.jev-harness/log.jsonl.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { ask } from './jev.ts'
import { onBeforeAgentStart } from './route.ts'
import { onToolCall, onToolResult } from './tools.ts'
import { active, type Config, type Harness, type Stats } from './types.ts'

const DEFAULTS: Config = {
	mode: 'on',
	route: false,
	prefetch: true,
	trim: true,
	loop: true,
	guard: true,
	prefetchFiles: 2,
	prefetchLines: 120,
	trimMinChars: 6000,
	keepHeadChars: 2000,
	timeoutMs: 3000,
	showStatus: true
}

const CONFIG_FILE = join(homedir(), '.pi', 'agent', 'jev-harness.json')

const LOG_DIR = join(homedir(), '.jev-harness')

const PRICE_PER_MTOK = 0.042

function loadConfig(): Config {
	try {
		// SAFETY: the user's own settings file; unknown keys are harmless and missing ones fall back to DEFAULTS.
		const fromFile = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Partial<Config>
		return { ...DEFAULTS, ...fromFile }
	} catch {
		// No config file, or an unreadable one: run with defaults.
		return { ...DEFAULTS }
	}
}

function log(entry: Record<string, unknown>): void {
	try {
		mkdirSync(LOG_DIR, { recursive: true })
		appendFileSync(
			join(LOG_DIR, 'log.jsonl'),
			`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`
		)
	} catch {
		// Logging must never break a turn.
	}
}

function report(h: Harness, ctx: ExtensionContext): void {
	const s = h.stats
	const avg = s.jevCalls ? Math.round(s.jevMs / s.jevCalls) : 0
	const saved = Math.round(s.charsSaved / 4)
	const cost = ((s.jevTokens / 1e6) * PRICE_PER_MTOK).toFixed(4)
	ctx.ui.notify(
		[
			`jev-harness ${h.config.mode} · ${s.turns} turns seen, ${s.prefetched} files pre-fetched, ${s.prefetchSkipped} turns skipped (named file), ${s.toolsHidden} tool schemas hidden`,
			`${s.trimmed} results trimmed (~${saved.toLocaleString()} model tokens saved), ${s.loopsCaught} loops caught, guard asked ${s.guardAsked} blocked ${s.guardBlocked}`,
			`jev: ${s.jevCalls} successful calls, ${avg}ms avg, ${s.jevTokens.toLocaleString()} tokens ($${cost}), ${s.errors} errors · log ~/.jev-harness/log.jsonl`
		].join('\n'),
		'info'
	)
}

function createHarness(): Harness {
	const config = loadConfig()
	const stats: Stats = {
		jevCalls: 0,
		jevMs: 0,
		jevTokens: 0,
		errors: 0,
		turns: 0,
		prefetchSkipped: 0,
		toolsHidden: 0,
		prefetched: 0,
		trimmed: 0,
		charsSaved: 0,
		loopsCaught: 0,
		guardAsked: 0,
		guardBlocked: 0
	}
	const h: Harness = {
		config,
		stats,
		task: '',
		allTools: null,
		recent: [],
		sent: new Set(),
		loopChecked: false,
		status: (ctx, text) => {
			if (ctx.hasUI && config.showStatus) ctx.ui.setStatus('jev-harness', text)
		},
		log,
		jev: async (what, state, questions, ctx) => {
			try {
				const result = await ask(state, questions, {
					timeoutMs: config.timeoutMs,
					signal: ctx.signal
				})
				stats.jevCalls++
				stats.jevMs += result.ms
				stats.jevTokens += result.inputTokens
				log({ what, ms: result.ms, tokens: result.inputTokens, answers: result.answers })
				return result
			} catch (err) {
				stats.errors++
				log({ what, error: err instanceof Error ? err.message : String(err) })
				return null
			}
		}
	}
	return h
}

export default function (pi: ExtensionAPI) {
	const h = createHarness()

	pi.on('session_start', (_event, ctx) => {
		Object.assign(h.config, loadConfig())
		h.sent.clear()
		h.status(ctx, active(h) ? `jev-harness ${h.config.mode}` : undefined)
	})

	pi.on('before_agent_start', (event, ctx) => onBeforeAgentStart(h, pi, event, ctx))

	pi.on('agent_end', () => {
		if (!h.allTools) return
		pi.setActiveTools(h.allTools)
		h.allTools = null
	})

	pi.on('tool_call', (event, ctx) => onToolCall(h, event, ctx))

	pi.on('tool_result', (event, ctx) => onToolResult(h, event, ctx))

	pi.registerCommand('jev-harness', {
		description: 'jev-harness: on | log | off | stats',
		handler: async (args, ctx) => {
			const mode = (args ?? '').trim()
			if (mode !== 'on' && mode !== 'log' && mode !== 'off') {
				report(h, ctx)
				return
			}
			h.config.mode = mode
			h.status(ctx, mode === 'off' ? undefined : `jev-harness ${mode}`)
			ctx.ui.notify(`jev-harness ${mode}`, 'info')
		}
	})
}
