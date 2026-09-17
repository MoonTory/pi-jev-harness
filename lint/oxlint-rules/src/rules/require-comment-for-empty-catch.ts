import { defineRule } from '@oxlint/plugins'

/** Require every swallowing catch to state the invariant that makes swallowing correct. */
export const requireCommentForEmptyCatchRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description: 'Require an explanatory comment inside every empty catch block.'
		},
		messages: {
			missingComment:
				'State the invariant that makes swallowing this failure safe inside the empty catch block.'
		}
	},
	createOnce(context) {
		return {
			CatchClause(node) {
				if (
					node.body.body.length !== 0 ||
					context.sourceCode.getCommentsInside(node.body).length !== 0
				)
					return
				context.report({ node: node.body, messageId: 'missingComment' })
			}
		}
	}
})
