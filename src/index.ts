/*
 *   EXPORTS
 ***************************************************************************************************/
export { Drift, DriftError } from './drift.js'

/*
 *   TYPE EXPORTS
 ***************************************************************************************************/
export type { InferSchemaOutput, StandardSchemaV1 } from './schema.js'
export type { ProgrammaticTracker } from './track.js'

export type {
	DeepReadonly,
	DriftConfig,
	DriftErrorCode,
	DriftEventMap,
	ErrorPhase,
	FieldOptions,
	FieldValidator,
	FormHandle,
	FormOptions,
	FormOutput,
	FormState,
	FormStatus,
	FormValidator,
	Issue,
	PersistConfig,
	PersistStorage,
	ResetHandler,
	SchemaFormOptions,
	SubmitHandler,
	SubmitResult,
	ValidateResult,
	ValidationTrigger,
	ValidatorContext,
	Values,
} from './types.js'
