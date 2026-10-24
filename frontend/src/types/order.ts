export type OrderStatus =
  | "pending"
  | "paid"
  | "expired"
  | "needs_review"
  | "claimed";

export type OrderItem = {
  productId: string;
  name: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
};

export type Order = {
  id: string;
  status: OrderStatus;
  totalPaise: number;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  claimedAt: string | null;
  /**
   * Seconds left on the hold, measured by the server's clock when the
   * response was sent. The counter's own clock may be minutes out, so this
   * is the only safe basis for the countdown.
   */
  expiresInSeconds: number;
  serverTime: string;
  items: OrderItem[];
};

/** Statuses where the order will not change again on its own. */
export const TERMINAL_STATUSES: OrderStatus[] = [
  "paid",
  "expired",
  "needs_review",
  "claimed",
];

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
