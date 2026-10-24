import { useMutation, useQueryClient } from "@tanstack/react-query";
import { simulatePayment } from "../services/paymentService";

export function useSimulatePayment(orderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => simulatePayment(orderId),
    // onSettled, not onSuccess: a failed capture also changes the order
    // (it may now be needs_review), so the screen must re-read it either way.
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["order", orderId] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
    },
  });
}
