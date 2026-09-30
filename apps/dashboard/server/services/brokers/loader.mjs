// Broker loader — imports all adapter modules to trigger registration.
// Import this file once at server startup (from index.mjs or handlers.mjs).
// Each adapter module calls registerBroker() on import.
//
// D2/AC-005: `./expertoption.mjs` is REMOVED from this list. The ExpertOption
// broker adapter was the only side-effecting registration here, so the registry
// now holds CCXT, Yahoo and Paper only. There is no dangling entry: adapters
// register themselves on import and nothing keyed on the `expertoption` slug is
// declared in this file, so dropping the import leaves the registry self-consistent
// (3 adapters, not a 4th with a missing module).

import "./ccxtAdapter.mjs"
import "./yahooAdapter.mjs"
import "./paperAdapter.mjs"

// Re-export the registry for convenience
export { getBroker, listBrokers, getActiveBrokers, anyBrokerAlive, registerBroker } from "./index.mjs"
