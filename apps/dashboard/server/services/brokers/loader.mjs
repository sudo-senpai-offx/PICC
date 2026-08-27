// Broker loader — imports all adapter modules to trigger registration.
// Import this file once at server startup (from index.mjs or handlers.mjs).
// Each adapter module calls registerBroker() on import.

import "./expertoption.mjs"
import "./ccxtAdapter.mjs"
import "./yahooAdapter.mjs"
import "./paperAdapter.mjs"

// Re-export the registry for convenience
export { getBroker, listBrokers, getActiveBrokers, anyBrokerAlive, registerBroker } from "./index.mjs"
