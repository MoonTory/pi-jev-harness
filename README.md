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

**1. Route the turn** (`before_agent_start`). Jev reads the prompt and the active tool list and answers what kind of turn it is (answer, explore, change, run, unclear) and, per tool, whether that tool will be needed. Tools under the threshold are hidden for the turn with `setActiveTools`, and restored at `agent_end`. The model sees fewer schemas and a one-line note in the system prompt saying what was routed. A confident `unclear` adds "ask one clarifying question before using tools".

**2. Pre-fetch context** (`before_agent_start`, explore and change turns only). Code pulls terms from the prompt (paths, file names, identifiers, quoted strings, plain words), runs `rg -l` for each, and drops terms that hit more than twenty files. Jev gets the candidate list, up to forty paths with the terms they matched, and answers per file whether the model will need to read it. The top three at or above 0.6 are read (first 120 lines) and injected as one message before the model's first turn. The model starts with the right files open instead of spending two or three tool turns finding them.

**3. Trim results** (`tool_result`, for bash, grep, find, read, ls over 1,500 chars). Jev sees the head and tail of the output with the task and answers: did it succeed, is it relevant, and how much should the model see (all, head, drop). Irrelevant output is replaced by a one-line note with the relevance score and how to get it back; repetitive output is cut to its first 2,000 chars. The model never pays for output it did not need.

**4. Loop control** (`tool_call`). When the same call with the same input shows up three times in the last twelve, Jev sees the recent calls and answers whether the agent is stuck and whether a different approach would be better. If so the call is blocked with a reason the model can act on. Checked once per turn.

**5. Guard** (`tool_call`, non-read tools). A compact version of [pi-jev-guard](https://github.com/MoonTory/pi-jev-guard) in the same request as loop control: a risk Score (read only, reversible, hard to reverse, destructive) and a secrets Noul. Hard to reverse or destructive calls get a confirm dialog with Jev's reason; with no UI they are blocked so the model asks the user.

The footer shows the last Jev verdict. Every Jev call is logged with its answers to `~/.jev-harness/log.jsonl`.

## Commands

```
/jev-harness on      # default: route, pre-fetch, trim, loop control, guard
/jev-harness log     # ask Jev and log every answer, change nothing
/jev-harness off
/jev-harness         # stats: turns routed, tool schemas hidden, files pre-fetched, results trimmed
                     # and model tokens saved, loops caught, guard verdicts, Jev calls, latency, tokens, cost
```

Run in `log` mode for a day first. The log shows what it would have hidden, pre-fetched, or cut without changing anything.

## Config

Optional `~/.pi/agent/jev-harness.json`:

```json
{
	"mode": "on",
	"route": true,
	"prefetch": true,
	"trim": true,
	"loop": true,
	"guard": true,
	"prefetchFiles": 3,
	"prefetchLines": 120,
	"trimMinChars": 1500,
	"keepHeadChars": 2000,
	"timeoutMs": 3000,
	"showStatus": true
}
```

Thresholds live in `jev.ts` next to the questions: tool kept at 0.35, file pre-fetched at 0.6, result dropped below 0.3 relevance, stuck at 0.7, secrets at 0.7.

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
node ~/code/pi-jev-harness/try.ts "where is the tick loop and how does the veto work in bot.ts?"
```

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
