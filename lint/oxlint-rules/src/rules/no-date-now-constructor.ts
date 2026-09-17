import {
	defineRule,
	type ESTree,
	type Scope,
	type SourceCode,
	type Variable
} from '@oxlint/plugins'

function resolveVariable(
	sourceCode: SourceCode,
	identifier: ESTree.IdentifierReference
): Variable | null {
	let scope: Scope | null = sourceCode.getScope(identifier)
	while (scope !== null) {
		const variable = scope.set.get(identifier.name)
		if (variable !== undefined) return variable
		scope = scope.upper
	}
	return null
}

function globalDateIdentifier(
	sourceCode: SourceCode,
	node: ESTree.Expression
): node is ESTree.IdentifierReference {
	if (node.type !== 'Identifier' || node.name !== 'Date') return false
	if (sourceCode.isGlobalReference(node)) return true
	const variable = resolveVariable(sourceCode, node)
	return variable === null || variable.defs.length === 0
}

function dateNowCall(
	sourceCode: SourceCode,
	node: ESTree.Expression | ESTree.SpreadElement
): boolean {
	if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false
	if (!globalDateIdentifier(sourceCode, node.callee.object)) return false
	const property = node.callee.property
	return node.callee.computed
		? property.type === 'Literal' && property.value === 'now'
		: property.type === 'Identifier' && property.name === 'now'
}

/** Reject `new Date(Date.now())`; `new Date()` is the one spelling for the current time. */
export const noDateNowConstructorRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow constructing the current date from Date.now().'
		},
		messages: {
			redundantClock: 'Use `new Date()` instead of the redundant `new Date(Date.now())` form.'
		}
	},
	createOnce(context) {
		return {
			NewExpression(node) {
				if (!globalDateIdentifier(context.sourceCode, node.callee) || node.arguments.length !== 1)
					return
				const argument = node.arguments[0]
				if (argument !== undefined && dateNowCall(context.sourceCode, argument)) {
					context.report({ node, messageId: 'redundantClock' })
				}
			}
		}
	}
})
