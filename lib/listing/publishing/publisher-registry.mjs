import { createMockPublisher } from "./mock-publisher.mjs";
import { assertKnownDestination, publishDestinations } from "./publisher-contract.mjs";

export function createPublisherRegistry({
  overrides = {}
} = {}) {
  const publishers = {
    [publishDestinations.MOCK_B_END]: createMockPublisher(),
    ...overrides
  };

  return {
    get(destinationContext = {}) {
      const destination = assertKnownDestination(destinationContext);
      return publishers[destination] || null;
    },
    list() {
      return Object.values(publishers);
    }
  };
}
