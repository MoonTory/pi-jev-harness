# pi-jev-harness

A [Pi](https://pi.dev) extension where [TypeSafe's Jev](https://typesafe.ai) does the reasoning around tool calls, so the main model spends its tokens on generation only.

Jev is a System One model: it never writes text, it only answers typed questions (Choice, Score, yes/no Noul) with probabilities and confidence, in about 300 ms, at $0.042 per million input tokens. It cannot write a bash command or an edit. It can decide which tool a turn needs, which of forty files are worth reading, whether a 9,000-character test log matters, and whether the agent is going in circles. Those decisions are most of what a frontier model burns tokens on between the moments it actually writes something.

## Install

```
pi install git:github.com/MoonTory/pi-jev-harness
export TYPESAFE_API_KEY=...    # https://console.typesafe.ai/keys
```

No runtime dependencies. Node 22.18 or newer. `rg` (ripgrep) on the path for context pre-fetch.

## What it does

Five things, each one Jev request, each switchable in config.

**1. Route the turn** (`before_agent_start`, opt-in). Jev can read the prompt and the active tool list, then decide which tools to keep for the turn. It is off by default: tool schemas live in Pi's cached system prompt, so hiding them per turn saves little and can break that cache. When enabled, hidden tools are restored at `agent_end`, and the system prompt notes the route.

**2. Pre-fetch context** (`before_agent_start`, when pre-fetch is enabled). Code pulls terms from a vague prompt and sends matching lines from up to forty files to Jev. If the prompt names a file and `rg --files` finds it, pre-fetch stops: the model can make a cheaper targeted read itself. Otherwise Jev ranks the candidates. At most two files qualify when Jev's `first` confidence or file score reaches 0.6. The harness injects 15-line windows around matching lines, merges overlapping windows, and caps the total at 120 lines per file. It never injects a file twice in one session. The injected message stays out of the transcript; the footer lists its file ranges.

**3. Trim results** (`tool_result`, for bash, grep, find, ls output over 6,000 chars; file reads are never judged, the model asked for exactly that). Jev sees the head and tail of the output with the task and answers: did it succeed, is it relevant, and how much should the model see (all, head, drop). Irrelevant output is replaced by a one-line note with the relevance score and how to get it back; repetitive output is cut to its first 2,000 chars. The model never pays for output it did not need. The judgement waits on Jev before the model sees the result, so the floor is high on purpose: only long test logs, wide greps and big listings are worth the round trip.

**4. Loop control** (`tool_call`). When the same call with the same input shows up three times in the last twelve, Jev sees the recent calls and answers whether the agent is stuck and whether a different approach would be better. If so the call is blocked with a reason the model can act on. Checked once per turn.

**5. Guard** (`tool_call`, non-read tools). A compact version of [pi-jev-guard](https://github.com/MoonTory/pi-jev-guard) in the same request as loop control: a risk Score (read only, reversible, hard to reverse, destructive) and a secrets Noul. Hard to reverse or destructive calls get a confirm dialog with Jev's reason; with no UI they are blocked so the model asks the user.

### When it helps

Pre-fetch pays off on vague prompts that would take several tool calls to locate. On prompts that name a file, the model's own read is cheaper, so the harness stays out of the way.

The footer shows the last Jev verdict. Every Jev call is logged with its answers to `~/.jev-harness/log.jsonl`.

## Commands

```
/jev-harness on      # default: pre-fetch, trim, loop control, guard (route is opt-in)
/jev-harness log     # ask Jev and log every answer, change nothing
/jev-harness off
/jev-harness         # stats: turns seen, files pre-fetched, turns skipped, results trimmed, Jev cost
                     # and model tokens saved, loops caught, guard verdicts, Jev calls, latency, tokens, cost
```

Run in `log` mode for a day first. The log shows what it would have hidden, pre-fetched, or cut without changing anything.

## Config

Optional `~/.pi/agent/jev-harness.json`:

```json
{
	"mode": "on",
	"route": false,
	"prefetch": true,
	"trim": true,
	"loop": true,
	"guard": true,
	"prefetchFiles": 2,
	"prefetchLines": 120,
	"trimMinChars": 6000,
	"keepHeadChars": 2000,
	"timeoutMs": 3000,
	"showStatus": true
}
```

Set `route` to `true` only if you accept its cache tradeoff. Thresholds live in `jev.ts` next to the questions: tool kept at 0.35, file pre-fetched at 0.6, result dropped below 0.3 relevance, stuck at 0.7, secrets at 0.7.

## Files

- `jev.ts`: the client and every question and threshold. Read this first.
- `route.ts`: term extraction, candidate files, routing, pre-fetch.
- `tools.ts`: loop control, guard, result trimming.
- `types.ts`: config, stats, shared types.
- `index.ts`: wiring, stats, the command.
- `try.ts`: dry run of routing and pre-fetch on a prompt against the current directory.

## Try it without pi

```
cd some-repo
node ~/code/pi-jev-harness/try.ts "where is the tick loop and how does the veto work in bot.ts"
```

It reports `named file in prompt → no pre-fetch` for a prompt that names a file. For vague prompts, it reports the ranked files and the matching line ranges it would inject.

On the jev-snake repo:

```
kind: explore (1.00)  744ms 884 tok
  keep read   0.95
  keep bash   0.35
  hide edit   0.15
  hide write  0.11
  keep grep   0.82
  hide find   0.33
  keep ls     0.39
```

## Benchmark

Compare plain Pi with the harness on a fixed prompt set. Pi JSON mode writes per-turn usage and tool events to stdout; the benchmark sums final assistant-message usage and tool starts. It counts harness Jev calls from `~/.jev-harness/log.jsonl` whose timestamps fall within each harness run. After all runs finish, Jev grades each answer against its plain-English facts, so pass rates do not depend on exact code names or wording. Grader tokens print separately and do not count as run cost.

```
npm run bench -- --repo ~/code/jev-snake --prompts bench/prompts.jev-snake.json --runs 3 --model gpt-5.6-sol
```

Use `--arm both|harness|plain`, `--parallel 2`, `--out bench/results`, or `--only named-tick-loop,named-veto` to narrow a run. Use `node bench.ts --regrade bench/results/example.json` to grade saved answers without running Pi. Each result JSON records raw answers, per-fact Jev scores, model and run Jev token use, tool calls, and wall time. The report prints per-prompt and per-kind medians; pass rate means every fact scored at least 0.6.

## Development

```
npm install
npm run check    # typecheck, oxlint --type-aware, prettier --check
```

Linting follows the adminty ruleset: oxlint with the correctness and suspicious categories as errors, the typescript type-aware rules, and a copy of adminty's custom `oxlint-rules` plugin (no unexplained type assertions, no empty catch without a comment, readable spacing, no nested ternaries, functions under 60 lines). Formatting is prettier with tabs, no semicolons, single quotes.

## Limits

- Jev sees trimmed inputs: the prompt, tool descriptions cut to 200 chars, result head and tail, recent calls cut to 160 chars. It does not see the conversation.
- Hiding a tool is a bet. If the model says it needs one, the system prompt note tells it to say so; the tool comes back next turn. `ALWAYS_KEEP` in `types.ts` pins `read`.
- Trimming replaces content the model never saw. The note always says how many chars were cut and the relevance score, and the full output stays in the pane.
- Confidence drifts by a few hundredths between identical calls, so near a threshold the same output can be kept one time and cut the next.
- Token savings shown by the stats command are chars saved divided by four, an estimate.
