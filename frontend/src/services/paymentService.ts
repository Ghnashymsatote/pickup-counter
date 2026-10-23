
const API_URL = "http://localhost:5001";

export async function simulatePayment(
  orderId: string,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/payments/simulate/${encodeURIComponent(orderId)}`,
    {
      method: "POST",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message ?? "Could not simulate payment.",
    );
  }
}
