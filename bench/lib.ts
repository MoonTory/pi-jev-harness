import { ask, noul, noulOf } from '../jev.ts'

type Arm = 'harness' | 'plain'

type Prompt = { id: string; prompt: string; expect: string[] }

type Run = {
	id: string
	arm: Arm
	wallMs: number
	inputTokens: number
	cacheRead: number
	toolCalls: number
	pass: boolean
	finalAnswer: string
	factScores: number[]
}

type GradeCost = { tokens: number; ms: number }

function factQuestions(facts: string[]): Record<string, ReturnType<typeof noul>> {
	return Object.fromEntries(
		facts.map((_, index) => [
			`fact_${index}`,
			noul(
				`Does \`answer\` state fact ${index} in \`facts\`, in any wording? Judge only what the answer says, not whether it is true.`
			)
		])
	)
}

async function gradeRun(prompt: Prompt, run: Run): Promise<GradeCost> {
	const result = await ask(
		{ question: prompt.prompt, answer: run.finalAnswer, facts: prompt.expect },
		factQuestions(prompt.expect)
	)
	run.factScores = prompt.expect.map((_, index) => noulOf(result.answers, `fact_${index}`))
	run.pass = run.factScores.every((score) => score >= 0.6)
	return { tokens: result.inputTokens, ms: result.ms }
}

export async function gradeRuns(prompts: Prompt[], runs: Run[]): Promise<GradeCost> {
	const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]))
	let tokens = 0
	let ms = 0
	for (const run of runs) {
		const prompt = byId.get(run.id)
		if (!prompt) throw new Error(`no facts for prompt ${run.id}`)
		const cost = await gradeRun(prompt, run)
		tokens += cost.tokens
		ms += cost.ms
	}
	return { tokens, ms }
}

function median(values: number[]): number {
	const sorted = [...values].sort((first, second) => first - second)
	const middle = Math.floor(sorted.length / 2)
	const current = sorted[middle] ?? 0
	return sorted.length % 2 ? current : ((sorted[middle - 1] ?? 0) + current) / 2
}

function formatArm(runs: Run[]): string[] {
	const wall = median(runs.map((run) => run.wallMs))
	const input = median(runs.map((run) => run.inputTokens + run.cacheRead))
	const cacheRead = median(runs.map((run) => run.cacheRead))
	const tools = median(runs.map((run) => run.toolCalls))
	const pass = runs.length ? runs.filter((run) => run.pass).length / runs.length : 0
	return [
		`${(wall / 1000).toFixed(1)}s`,
		Math.round(input).toLocaleString(),
		Math.round(cacheRead).toLocaleString(),
		tools.toFixed(1),
		`${Math.round(pass * 100)}%`
	]
}

export function table(title: string, prompts: Prompt[], runs: Run[], arms: Arm[]): string {
	const ids = new Set(prompts.map((prompt) => prompt.id))
	const scoped = runs.filter((run) => ids.has(run.id))
	const labels = arms.flatMap((arm) => [
		`${arm} wall`,
		`${arm} input+cache`,
		`${arm} cache read`,
		`${arm} tools`,
		`${arm} pass`
	])
	const header = `| Prompt | ${labels.join(' | ')} |`
	const divider = `| --- | ${labels.map(() => '---:').join(' | ')} |`
	const rows = prompts.map((prompt) => {
		const cells = arms.flatMap((arm) =>
			formatArm(runs.filter((run) => run.id === prompt.id && run.arm === arm))
		)
		return `| ${prompt.id} | ${cells.join(' | ')} |`
	})
	const totals = arms.flatMap((arm) => formatArm(scoped.filter((run) => run.arm === arm)))
	return `\n### ${title}\n\n${header}\n${divider}\n${rows.join('\n')}\n| **Total** | ${totals.join(' | ')} |`
}
