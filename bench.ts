import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { gradeRuns, table } from './bench/lib.ts'

type Arm = 'harness' | 'plain'

type Kind = 'named' | 'vague' | 'run'

type Prompt = { id: string; prompt: string; kind: Kind; expect: string[] }

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

type Run = {
	id: string
	kind: Kind
	arm: Arm
	run: number
	wallMs: number
	modelCalls: number
	inputTokens: number
	cacheRead: number
	cacheWrite: number
	outputTokens: number
	toolCalls: number
	toolNames: string[]
	jevCalls: number
	jevTokens: number
	jevMs: number
	pass: boolean
	finalAnswer: string
	factScores: number[]
}

type RunOptions = {
	repo: string
	prompts: string
	runs: number
	model?: string
	arms: Arm[]
	parallel: number
	out: string
	only?: Set<string>
}

type RegradeOptions = { regrade: string }

type Options = RunOptions | RegradeOptions

type StoredRun = Omit<Run, 'factScores'> & { factScores?: number[] }

type JsonRecord = Record<string, unknown>

const ROOT = dirname(fileURLToPath(import.meta.url))

const JEV_LOG = resolve(process.env.HOME ?? '', '.jev-harness/log.jsonl')

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPrompt(value: unknown): value is Prompt {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.prompt === 'string' &&
		(value.kind === 'named' || value.kind === 'vague' || value.kind === 'run') &&
		Array.isArray(value.expect) &&
		value.expect.every((item) => typeof item === 'string')
	)
}

function stringOption(value: string | boolean | undefined, flag: string): string {
	if (typeof value === 'string' && value) return value
	throw new Error(`${flag} needs a value`)
}

function numberOption(value: string | boolean | undefined, flag: string, fallback: number): number {
	if (value === undefined) return fallback
	const number = Number(value)
	if (Number.isInteger(number) && number > 0) return number
	throw new Error(`${flag} must be a positive integer`)
}

function parseOptions(): Options {
	const { values } = parseArgs({
		options: {
			repo: { type: 'string' },
			prompts: { type: 'string' },
			runs: { type: 'string', default: '3' },
			model: { type: 'string' },
			arm: { type: 'string', default: 'both' },
			parallel: { type: 'string', default: '2' },
			out: { type: 'string', default: 'bench/results' },
			only: { type: 'string' },
			regrade: { type: 'string' }
		}
	})
	if (values.regrade !== undefined)
		return { regrade: resolve(stringOption(values.regrade, '--regrade')) }
	const arm = stringOption(values.arm, '--arm')
	if (arm !== 'both' && arm !== 'harness' && arm !== 'plain')
		throw new Error('--arm must be both, harness, or plain')
	const only =
		typeof values.only === 'string' ? new Set(values.only.split(',').filter(Boolean)) : undefined
	return {
		repo: resolve(stringOption(values.repo, '--repo')),
		prompts: resolve(stringOption(values.prompts, '--prompts')),
		runs: numberOption(values.runs, '--runs', 3),
		...(typeof values.model === 'string' ? { model: values.model } : {}),
		arms: arm === 'both' ? ['harness', 'plain'] : [arm],
		parallel: numberOption(values.parallel, '--parallel', 2),
		out: resolve(stringOption(values.out, '--out')),
		...(only ? { only } : {})
	}
}

function readPrompts(path: string, only?: Set<string>): Prompt[] {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
	if (!Array.isArray(parsed) || !parsed.every(isPrompt))
		throw new Error(`${path} must contain benchmark prompts`)
	const prompts = only ? parsed.filter((prompt) => only.has(prompt.id)) : parsed
	if (!prompts.length) throw new Error('no prompts selected')
	if (only && prompts.length !== only.size) throw new Error('--only includes an unknown prompt id')
	return prompts
}

function isStoredRun(value: unknown): value is StoredRun {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.finalAnswer === 'string' &&
		(value.arm === 'harness' || value.arm === 'plain') &&
		(value.kind === 'named' || value.kind === 'vague' || value.kind === 'run') &&
		typeof value.pass === 'boolean' &&
		(value.factScores === undefined ||
			(Array.isArray(value.factScores) &&
				value.factScores.every((score) => typeof score === 'number')))
	)
}

function readRegrade(path: string): {
	record: JsonRecord
	prompts: Prompt[]
	runs: Run[]
	arms: Arm[]
} {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
	if (!isRecord(parsed) || !Array.isArray(parsed.runs))
		throw new Error(`${path} must contain benchmark runs`)
	const storedRuns = parsed.runs.filter(isStoredRun)
	if (storedRuns.length !== parsed.runs.length)
		throw new Error(`${path} must contain benchmark runs`)
	const ids = new Set(storedRuns.map((run) => run.id))
	const prompts = readPrompts(resolve(ROOT, 'bench/prompts.jev-snake.json')).filter((prompt) =>
		ids.has(prompt.id)
	)
	if (prompts.length !== ids.size) throw new Error(`${path} includes runs with unknown prompt ids`)
	const arms: Arm[] = ['harness', 'plain'].filter((arm): arm is Arm =>
		storedRuns.some((run) => run.arm === arm)
	)
	return {
		record: parsed,
		prompts,
		runs: storedRuns.map((run) => ({ ...run, factScores: run.factScores ?? [] })),
		arms
	}
}

function numberAt(record: JsonRecord, key: string): number {
	const value = record[key]
	return typeof value === 'number' ? value : 0
}

function usageFrom(value: unknown): Usage {
	if (!isRecord(value)) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
	return {
		input: numberAt(value, 'input'),
		output: numberAt(value, 'output'),
		cacheRead: numberAt(value, 'cacheRead'),
		cacheWrite: numberAt(value, 'cacheWrite')
	}
}

function assistantText(message: JsonRecord): string {
	const content = message.content
	if (!Array.isArray(content)) return ''
	return content
		.filter(isRecord)
		.filter((block) => block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text)
		.join('')
}

function parseEvents(stdout: string): {
	usage: Usage
	modelCalls: number
	toolNames: string[]
	answer: string
} {
	let usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
	let modelCalls = 0
	let answer = ''
	const toolNames: string[] = []
	for (const line of stdout.split('\n')) {
		try {
			const event: unknown = JSON.parse(line)
			if (!isRecord(event)) continue
			if (event.type === 'tool_execution_start' && typeof event.toolName === 'string')
				toolNames.push(event.toolName)
			if (
				event.type !== 'message_end' ||
				!isRecord(event.message) ||
				event.message.role !== 'assistant'
			)
				continue
			const next = usageFrom(event.message.usage)
			usage = {
				input: usage.input + next.input,
				output: usage.output + next.output,
				cacheRead: usage.cacheRead + next.cacheRead,
				cacheWrite: usage.cacheWrite + next.cacheWrite
			}
			modelCalls++
			answer = assistantText(event.message)
		} catch {
			// JSON mode can write startup errors to stdout.
		}
	}
	return { usage, modelCalls, toolNames, answer }
}

function runPi(args: string[], cwd: string): Promise<{ stdout: string; code: number }> {
	return new Promise((resolveRun) => {
		const child = spawn('pi', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
		let stdout = ''
		child.stdout.setEncoding('utf8')
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk
		})
		child.on('error', () => resolveRun({ stdout, code: -1 }))
		child.on('close', (code) => resolveRun({ stdout, code: code ?? -1 }))
	})
}

function jevCost(started: number, ended: number): { calls: number; tokens: number; ms: number } {
	if (!existsSync(JEV_LOG)) return { calls: 0, tokens: 0, ms: 0 }
	let calls = 0
	let tokens = 0
	let ms = 0
	for (const line of readFileSync(JEV_LOG, 'utf8').split('\n')) {
		try {
			const entry: unknown = JSON.parse(line)
			if (!isRecord(entry) || typeof entry.at !== 'string') continue
			const at = Date.parse(entry.at)
			if (at >= started && at <= ended) {
				calls++
				tokens += numberAt(entry, 'tokens')
				ms += numberAt(entry, 'ms')
			}
		} catch {
			// A partial final log line is not a completed Jev call.
		}
	}
	return { calls, tokens, ms }
}

async function runArm(options: RunOptions, prompt: Prompt, arm: Arm, run: number): Promise<Run> {
	const args = [
		'--mode',
		'json',
		'--no-session',
		'--no-skills',
		'--no-extensions',
		'-p',
		prompt.prompt
	]
	if (options.model) args.push('--model', options.model)
	if (arm === 'harness') args.push('-e', resolve(ROOT, 'index.ts'))
	const started = performance.timeOrigin + performance.now()
	const result = await runPi(args, options.repo)
	const ended = performance.timeOrigin + performance.now()
	const parsed = parseEvents(result.stdout)
	const answer = parsed.answer.slice(0, 2000)
	const jev = arm === 'harness' ? jevCost(started, ended) : { calls: 0, tokens: 0, ms: 0 }
	return {
		id: prompt.id,
		kind: prompt.kind,
		arm,
		run,
		wallMs: Math.round(ended - started),
		modelCalls: parsed.modelCalls,
		inputTokens: parsed.usage.input,
		cacheRead: parsed.usage.cacheRead,
		cacheWrite: parsed.usage.cacheWrite,
		outputTokens: parsed.usage.output,
		toolCalls: parsed.toolNames.length,
		toolNames: parsed.toolNames,
		jevCalls: jev.calls,
		jevTokens: jev.tokens,
		jevMs: jev.ms,
		pass: false,
		finalAnswer: answer,
		factScores: []
	}
}

async function runJobs(options: RunOptions, prompts: Prompt[]): Promise<Run[]> {
	const jobs = prompts.flatMap((prompt) =>
		Array.from({ length: options.runs }, (_, run) => ({ prompt, run: run + 1 }))
	)
	const results: Run[] = []
	let next = 0

	async function worker(): Promise<void> {
		while (next < jobs.length) {
			const job = jobs[next]
			next++
			if (!job) continue
			for (const arm of options.arms) results.push(await runArm(options, job.prompt, arm, job.run))
		}
	}

	await Promise.all(Array.from({ length: Math.min(options.parallel, jobs.length) }, worker))
	return results
}

function printReport(
	prompts: Prompt[],
	runs: Run[],
	arms: Arm[],
	grader: { tokens: number; ms: number }
): void {
	console.log(table('All prompts', prompts, runs, arms))
	const kinds: Kind[] = ['named', 'vague', 'run']
	for (const kind of kinds) {
		const group = prompts.filter((prompt) => prompt.kind === kind)
		if (group.length) console.log(table(kind, group, runs, arms))
	}
	const jevTokens = runs.reduce((sum, run) => sum + run.jevTokens, 0)
	console.log(
		`\nRun Jev tokens: ${jevTokens.toLocaleString()} ($${((jevTokens / 1_000_000) * 0.042).toFixed(6)} at $0.042/M)`
	)
	console.log(
		`Grader Jev tokens: ${grader.tokens.toLocaleString()} ($${((grader.tokens / 1_000_000) * 0.042).toFixed(6)} at $0.042/M)`
	)
}

async function main(): Promise<void> {
	const options = parseOptions()
	if ('regrade' in options) {
		const results = readRegrade(options.regrade)
		const grader = await gradeRuns(results.prompts, results.runs)
		results.record.prompts = results.prompts
		results.record.runs = results.runs
		writeFileSync(options.regrade, `${JSON.stringify(results.record, null, '\t')}\n`)
		console.log(`Regraded: ${options.regrade}`)
		printReport(results.prompts, results.runs, results.arms, grader)
		return
	}
	if (!existsSync(options.repo)) throw new Error(`repo not found: ${options.repo}`)
	const prompts = readPrompts(options.prompts, options.only)
	const runs = await runJobs(options, prompts)
	const grader = await gradeRuns(prompts, runs)
	mkdirSync(options.out, { recursive: true })
	const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
	const output = resolve(options.out, `${timestamp}.json`)
	writeFileSync(
		output,
		`${JSON.stringify({ options: { ...options, only: options.only ? [...options.only] : undefined }, prompts, runs }, null, '\t')}\n`
	)
	console.log(`Raw runs: ${output}`)
	printReport(prompts, runs, options.arms, grader)
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
