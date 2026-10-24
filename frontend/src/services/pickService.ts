import { apiFetch } from "../lib/api";

export type ClaimResponse = {
  success: true;
  orderId: string;
  status: "claimed";
  claimedAt: string;
  message: string;
};

export async function claimPickup(
  orderId: string,
): Promise<ClaimResponse> {
  return apiFetch<ClaimResponse>(
    `/orders/${encodeURIComponent(orderId)}/pickup-claim`,
    { method: "POST" },
  );
}
