
const API_URL = "http://localhost:5001";

export type OrderDetails = {
  id: string;
  status: string;
  totalPaise: number;
  createdAt?: string;
  expiresAt?: string;
  expiresInSeconds?: number;
  items?: {
    id?: string;
    productId?: string;
    quantity: number;
    pricePaise?: number;
    product?: { name: string };
  }[];
};

export async function getOrder(orderId: string): Promise<OrderDetails> {
  const response = await fetch(`${API_URL}/orders/${orderId}`);

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message ?? "Could not load order.");
  }

  return data.order ?? data;
}
