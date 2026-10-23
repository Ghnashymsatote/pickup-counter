
import { useMutation } from "@tanstack/react-query";
import { createOrder } from "../services/orderService";

export function useCreateOrder() {
  return useMutation({
    mutationFn: createOrder,
  });
}
