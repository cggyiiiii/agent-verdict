export { observe, type ObserveOptions, type MCPClientLike } from './observe.js';
export { VerdictEmitter, type EmitterOptions } from './emitter.js';
export { classifyMessage, errorToMessage, mcpResultText } from './classify.js';
export type {
  Decision,
  DecisionEvent,
  DecisionEventInput,
  Reason,
  ReasonSource,
  BudgetSnapshot,
  DelegationHop,
} from './types.js';
export { DEFAULT_PORT } from './types.js';
export { lineToEvent, tailFile, type FieldMap, type TailOptions } from './tail.js';
