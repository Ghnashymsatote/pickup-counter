import { useQuery } from "@tanstack/react-query";
import { getOrder } from "../services/orderStatusService";
import { isTerminal } from "../types/order";
import { ApiError } from "../lib/api";

/**
 * Polls one order until it reaches a status that cannot change on its own.
 *
 * A pending order is polled every second: the hold is only 120 seconds, and
 * the screen has to notice the switch to paid (or expired) quickly. Polling
 * stops as soon as the status is terminal, so a finished order does not keep
 * hitting the API.
 */
export function useOrderQuery(orderId: string) {
  return useQuery({
    queryKey: ["order", orderId],
    queryFn: () => getOrder(orderId),
    enabled: Boolean(orderId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;

      if (!status) return 1000;

      return isTerminal(status) ? false : 1000;
    },
    // Keep polling while the screen is in the background; the customer may
    // be in their UPI app on the same device.
    refetchIntervalInBackground: true,
    retry: (failureCount, error) =>
      // A 404 will not become a 200; only retry transport-level failures.
      error instanceof ApiError && error.status >= 400 && error.status < 500
        ? false
        : failureCount < 3,
  });
}
