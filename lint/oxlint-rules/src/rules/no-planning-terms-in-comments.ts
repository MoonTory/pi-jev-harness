import { defineRule } from '@oxlint/plugins'

const planningId = /\b[EHR]\d+\b/u
const planningLabel =
	/\b(?:(?:batch|wave|iteration)\s+(?:[EHR]?\d+|one|two|three|four|five|six|seven|eight|nine|ten)|alpha\s+2|take\s+two)\b/iu

/** Reject planning ids and round labels left in comments. */
export const noPlanningTermsInCommentsRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow planning and implementation-round labels in source comments.'
		},
		messages: {
			planningTerm:
				'Remove planning term "{{term}}"; source comments must describe only lasting invariants.'
		}
	},
	createOnce(context) {
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					const match = planningId.exec(comment.value) ?? planningLabel.exec(comment.value)
					if (match === null) continue
					context.report({ node: comment, messageId: 'planningTerm', data: { term: match[0] } })
				}
			}
		}
	}
})
