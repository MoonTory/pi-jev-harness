// Minimal TypeSafe System One client. Plain fetch, no dependencies.
// Every question this extension asks is defined here so the whole policy is reviewable in one file.

export type Question =
	| { type: 'noul'; instructions: string }
	| { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
	| { type: 'score'; instructions: string; criteria: string[] }

export type Answer =
	| { type: 'noul'; noul: number }
	| { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
	| { type: 'score'; score: number; confidence: number; probabilities: Record<string, number> }

export type Answers = Record<string, Answer>

export type Result = { answers: Answers; inputTokens: number; ms: number }

type ApiResponse = { answers: Answers; usage: { input_tokens: number } }

export type AskOptions = {
	timeoutMs?: number | undefined
	signal?: AbortSignal | undefined
	apiKey?: string | undefined
}

export async function ask(
	state: unknown,
	questions: Record<string, Question>,
	options: AskOptions = {}
): Promise<Result> {
	const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY
	if (!apiKey) throw new Error('TYPESAFE_API_KEY is not set')
	const started = performance.now()
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 3000)
	options.signal?.addEventListener('abort', () => controller.abort(), { once: true })
	try {
		const response = await fetch('https://api.typesafe.ai/v1/systemone', {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: 'jev-latest', state, questions }),
			signal: controller.signal
		})
		if (!response.ok) {
			throw new Error(`TypeSafe API ${response.status}: ${(await response.text()).slice(0, 200)}`)
		}
		// SAFETY: the documented System One response shape; the accessors below throw on any mismatch.
		const { answers, usage } = (await response.json()) as ApiResponse
		return { answers, inputTokens: usage.input_tokens, ms: Math.round(performance.now() - started) }
	} finally {
		clearTimeout(timer)
	}
}

export const noul = (instructions: string): Question => ({ type: 'noul', instructions })

export const choice = (
	instructions: string,
	criteria: Record<string, string | null>
): Question => ({
	type: 'choice',
	instructions,
	criteria
})

export const score = (instructions: string, criteria: string[]): Question => ({
	type: 'score',
	instructions,
	criteria
})

/** Typed readers. A missing or wrongly typed answer is a contract break, so they throw. */
export function noulOf(answers: Answers, key: string): number {
	const a = answers[key]
	if (a?.type !== 'noul') throw new Error(`expected a noul answer for ${key}`)
	return a.noul
}

export function choiceOf(answers: Answers, key: string): { choice: string; confidence: number } {
	const a = answers[key]
	if (a?.type !== 'choice') throw new Error(`expected a choice answer for ${key}`)
	return { choice: a.choice, confidence: a.confidence }
}

export function scoreOf(answers: Answers, key: string): { score: number; confidence: number } {
	const a = answers[key]
	if (a?.type !== 'score') throw new Error(`expected a score answer for ${key}`)
	return { score: a.score, confidence: a.confidence }
}

// ---- 1. routing: what kind of turn is it, and which tools will it need ----
export const KINDS: Record<string, string> = {
	answer:
		'A question or request the model can answer from what it already knows or from the conversation, with no tool use',
	explore:
		'The model has to find, read, or search code or files to answer or to understand something',
	change: 'The model has to create or edit files, then probably verify',
	run: 'The model has to run a command, script, test, build, or git operation as the main action',
	unclear: 'Too vague or ambiguous to act on; the model should ask one question first'
}

export function routingQuestions(toolNames: string[]): Record<string, Question> {
	const questions: Record<string, Question> = {
		kind: choice("What kind of turn is the user's `prompt` asking for?", KINDS)
	}
	for (const name of toolNames) {
		questions[`use_${name}`] = noul(
			`Will the \`${name}\` tool likely be needed at some point while doing what \`prompt\` asks? Consider the tool's description in \`tools\`.`
		)
	}
	return questions
}

// ---- 2. pre-fetch: which candidate files should be read before the model starts ----
// Files named in the prompt are pinned by code and never asked about. Jev ranks the rest.
export function relevanceQuestions(paths: string[]): Record<string, Question> {
	const questions: Record<string, Question> = {
		first: choice(
			'Which file in `files` should the model read first to do `task`? Judge from the path and the matching lines.',
			Object.fromEntries(paths.map((path) => [path, null]))
		)
	}
	paths.forEach((path, i) => {
		questions[`f${i}`] = noul(
			`Will the model need to read \`${path}\` to do \`task\`? Judge from the matching lines in \`files\`, not from how many terms matched. A file that only matches common words usually is not needed.`
		)
	})
	return questions
}

// ---- 3. result judgement: what part of a tool result does the model need ----
export const resultQuestions: Record<string, Question> = {
	succeeded: noul('Did the tool call do what it was meant to do, regardless of exit code wording?'),
	relevant: noul(
		'Does the output contain information the model needs for `task`, or that changes what it should do next?'
	),
	keep: choice('How much of this output should the model see?', {
		all: 'All of it; details throughout matter',
		head: 'Only the beginning; the rest is repetition, noise, or long listings',
		drop: 'None of it; a one-line note that it ran is enough'
	})
}

// ---- 4. loop control ----
export const loopQuestions: Record<string, Question> = {
	stuck: noul(
		'Looking at `recentCalls`, is the agent repeating the same actions without making progress on `task`?'
	),
	wrong_approach: noul(
		'Would a different approach, or asking the user, be better than continuing this way?'
	)
}

// ---- 5. guard: a compact version of pi-jev-guard, asked in the same request as loop control ----
export const guardQuestions: Record<string, Question> = {
	risk: score(
		'How hard would it be to undo what this tool call does? Judge the actual command or edit in `input`.',
		[
			'Only reads or inspects: reading, listing, searching, git status or diff, tests, type checks, a GET request.',
			'Easy to undo: editing or creating project files, project-local installs, branch, add, commit, mkdir, build.',
			'Awkward to undo or outside the project: push, reset --hard, discarding checkout, deleting files, editing dotfiles or global config, killing processes, POST to a real service, sending messages.',
			'Cannot be undone or damages the machine or data: rm -rf on broad paths, force push, deleting remote branches, dropping databases, curl piped to a shell, sudo that changes the OS.'
		]
	),
	secrets: noul(
		'Does this call read, print, copy, or send credentials, API keys, tokens, private keys, or .env files?'
	)
}

export const THRESHOLDS = {
	toolNeeded: 0.35, // keep a tool if Jev gives it at least this much
	prefetchFile: 0.6, // read a candidate file at or above this
	dropResult: 0.3, // drop a result when relevance is below this and keep says drop
	stuck: 0.7,
	secrets: 0.7,
	askConfidence: 0.5 // hard_to_reverse or destructive needs this much confidence to prompt
}
