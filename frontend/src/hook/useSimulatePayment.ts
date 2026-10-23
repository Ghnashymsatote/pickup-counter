
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { simulatePayment } from "../services/paymentService";

export function useSimulatePayment(orderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => simulatePayment(orderId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["order", orderId],
      });

      await queryClient.invalidateQueries({
        queryKey: ["products"],
      });
    },
  });
}
