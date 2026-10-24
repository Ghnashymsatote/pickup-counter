import { useMutation, useQueryClient } from "@tanstack/react-query";
import { claimPickup } from "../services/pickService";

export function useClaimPickup(orderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => claimPickup(orderId),
    // A claim permanently reduces stock, so both the order and the product
    // list are stale afterwards.
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["order", orderId] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
    },
  });
}
