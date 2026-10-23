
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { claimPickup } from "../services/pickService";


export function useClaimPickup(orderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => claimPickup(orderId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["order", orderId],
      });
    },
  });
}
