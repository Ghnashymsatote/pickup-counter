import { apiFetch } from "../lib/api";
import type { Order } from "../types/order";

export async function getOrder(orderId: string): Promise<Order> {
  const data = await apiFetch<{ order: Order }>(
    `/orders/${encodeURIComponent(orderId)}`,
  );

  return data.order;
}
