
import { useQuery } from "@tanstack/react-query";
import { getOrder } from "../services/orderStatusService";

export function useOrderQuery(orderId: string) {
  return useQuery({
    queryKey: ["order", orderId],
    queryFn: () => getOrder(orderId),
    enabled: Boolean(orderId),
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? 5000 : false,
  });
}
