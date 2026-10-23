
const API_URL = "http://localhost:5001";

export type CreateOrderRequest = {
  items: {
    productId: string;
    quantity: number;
  }[];
};

export type CreatedOrder = {
  id: string;
  status: string;
  totalPaise: number;
  createdAt: string;
  expiresAt: string;
  expiresInSeconds: number;
  items: unknown[];
};

export async function createOrder(
  request: CreateOrderRequest,
): Promise<CreatedOrder> {
  const response = await fetch(`${API_URL}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message ?? "Could not create order.");
  }

  return data.order ?? data;
}
