/*
 *   OBSERVER
 ***************************************************************************************************/
/** The attributes whose change can move a field or form in or out of tracking, or out of storage. */
export function observedAttributes(attributes: {
	readonly form: string
	readonly ignore: string
	readonly persist: string
}): string[] {
	return [
		'name',
		'type',
		'disabled',
		'autocomplete',
		attributes.form,
		attributes.ignore,
		attributes.persist,
	]
}

/**
 * The nodes a batch of mutations touched. Each one is reconciled against the DOM as it is now, so
 * a node that was added, removed or moved needs no record of how it got there.
 */
export function collectTargets(records: readonly MutationRecord[]): Set<Node> {
	const targets = new Set<Node>()

	// Removals first, so a replacement doesn't bind while the element it replaces still owns the name
	for (const record of records) {
		for (const node of record.removedNodes) {
			targets.add(node)
		}
	}

	for (const record of records) {
		if (record.type === 'attributes') {
			targets.add(record.target)
		}

		for (const node of record.addedNodes) {
			targets.add(node)
		}
	}

	return targets
}
