
const API_URL = "http://localhost:5001";

export async function claimPickup(orderId: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/orders/${orderId}/pickup-claim`,
    { method: "POST" },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message ?? "Could not claim pickup.");
  }
}
