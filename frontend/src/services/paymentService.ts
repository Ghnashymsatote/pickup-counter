import { apiFetch } from "../lib/api";

export type PaymentResult = {
  received: true;
  duplicate: boolean;
  outcome: string;
  orderStatus: string;
};

/**
 * Stands in for the UPI app. The backend signs a capture event for this
 * order's exact total and puts it through the real webhook path.
 */
export async function simulatePayment(
  orderId: string,
): Promise<PaymentResult> {
  return apiFetch<PaymentResult>(
    `/payments/simulate/${encodeURIComponent(orderId)}`,
    { method: "POST" },
  );
}
