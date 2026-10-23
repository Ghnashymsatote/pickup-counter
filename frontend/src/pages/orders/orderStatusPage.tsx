
import { Link, useParams } from "react-router";
import { formatPrice } from "../../feature/cart/CartUtil";
import { useOrderQuery } from "../../hook/userOrderQuery";
import { useClaimPickup } from "../../hook/useClaimpickup";
import { useSimulatePayment } from "../../hook/useSimulatePayment";
export default function OrderStatusPage() {
  const { orderId = "" } = useParams();
const paymentMutation = useSimulatePayment(orderId);
  const {
    data: order,
    isPending,
    isError,
    error,
    refetch,
  } = useOrderQuery(orderId);

  const claimMutation = useClaimPickup(orderId);

  if (isPending) {
    return (
      <main className="store-page">
        <p>Loading order...</p>
      </main>
    );
  }

  if (isError || !order) {
    return (
      <main className="store-page">
        <h2>Unable to load order</h2>

        <p>
          {error instanceof Error
            ? error.message
            : "Order not found."}
        </p>

        <button
          type="button"
          onClick={() => void refetch()}
        >
          Try again
        </button>

        <p>
          <Link to="/">Back to Store</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="store-page">
      <section className="welcome-section">
        <h2>Order Status</h2>

        <p>Order ID: {order.id}</p>

        <h3>
          Status: {order.status.replaceAll("_", " ")}
        </h3>

        <p>Total: {formatPrice(order.totalPaise)}</p>
      </section>

      {/* Pickup claim section */}
      {order.status === "paid" && (
        <section className="cart-summary">
          <h3>Ready to claim your pickup?</h3>

          <p>
            Your payment is confirmed. Claim your order when
            you are ready to collect it.
          </p>

          <button
            type="button"
            disabled={claimMutation.isPending}
            onClick={() => claimMutation.mutate()}
          >
            {claimMutation.isPending
              ? "Claiming..."
              : "Claim Pickup"}
          </button>

          {claimMutation.isError && (
            <p role="alert">
              {claimMutation.error instanceof Error
                ? claimMutation.error.message
                : "Could not claim pickup. Please try again."}
            </p>
          )}
        </section>
      )}

{order.status === "pending" && (
  <section className="cart-summary">
    <h3>Complete Your Payment</h3>

    <p>
      This button simulates payment for local development only.
    </p>

    <button
      type="button"
      disabled={paymentMutation.isPending}
      onClick={() => paymentMutation.mutate()}
    >
      {paymentMutation.isPending
        ? "Processing Payment..."
        : "Simulate Successful Payment"}
    </button>

    {paymentMutation.isError && (
      <p role="alert">
        {paymentMutation.error instanceof Error
          ? paymentMutation.error.message
          : "Payment simulation failed."}
      </p>
    )}
  </section>
)}

      {/* Order items */}
      <section className="cart-summary">
        <h2>Order Items</h2>

        {order.items?.map((item, index) => (
          <div
            key={item.id ?? `${item.productId ?? "item"}-${index}`}
          >
            <p>
              {item.product?.name ??
                `Product ${item.productId ?? ""}`}
              {" × "}
              {item.quantity}
            </p>
          </div>
        ))}
      </section>

      {/* Order status message */}
      <p>
        {order.status === "pending"
          ? "Waiting for payment confirmation."
          : order.status === "paid"
            ? "Payment confirmed. Your order is awaiting pickup claim."
            : order.status === "claimed"
              ? "Your order has been claimed for pickup."
              : `Current order status: ${order.status.replaceAll("_", " ")}`}
      </p>

      <Link to="/">Back to Store</Link>
    </main>
  );
}
