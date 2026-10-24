import { apiFetch } from "../lib/api";
import type { Order } from "../types/order";

export type CreateOrderRequest = {
  items: {
    productId: string;
    quantity: number;
  }[];
};

export async function createOrder(
  request: CreateOrderRequest,
): Promise<Order> {
  const data = await apiFetch<{ order: Order }>("/orders", {
    method: "POST",
    body: JSON.stringify(request),
  });

  return data.order;
}
