import { Link, useParams } from "react-router";

import { formatPrice } from "../../feature/cart/CartUtil";
import { useOrderQuery } from "../../hook/userOrderQuery";
import { useClaimPickup } from "../../hook/useClaimpickup";
import { useSimulatePayment } from "../../hook/useSimulatePayment";
import {
  formatCountdown,
  useHoldCountdown,
} from "../../hook/useHoldCountdown";
import type { Order, OrderStatus } from "../../types/order";

/** What the customer should be told, per status. */
const STATUS_MESSAGE: Record<OrderStatus, { title: string; body: string }> = {
  pending: {
    title: "Waiting for payment",
    body:
      "Pay with UPI before the timer runs out. Your items are held until then.",
  },
  paid: {
    title: "Payment received",
    body: "Collect your order from the locker.",
  },
  claimed: {
    title: "Collected",
    body: "This order has been handed over. Enjoy!",
  },
  expired: {
    title: "Hold expired",
    body:
      "Your items were not paid for in time and have been released to other " +
      "customers. Nothing has been charged. Please order again.",
  },
  needs_review: {
    title: "Needs review",
    body:
      "We received a payment we could not match to this order — either the " +
      "amount differed, or it arrived after the hold expired. Staff will " +
      "check and refund or hand over your items. Please speak to the counter.",
  },
};

function PaymentPanel({ order }: { order: Order }) {
  const payment = useSimulatePayment(order.id);
  const secondsLeft = useHoldCountdown(order.expiresInSeconds);
  const expired = secondsLeft <= 0;

  return (
    <section className="cart-summary">
      <h3>Pay {formatPrice(order.totalPaise)} by UPI</h3>

      <p
        className={expired ? "countdown expired" : "countdown"}
        role="timer"
        aria-live="off"
      >
        {expired ? "Hold expired" : `${formatCountdown(secondsLeft)} left`}
      </p>

      <p className="muted">
        {expired
          ? "Checking with the counter..."
          : "Your items are held until the timer reaches zero."}
      </p>

      <button
        type="button"
        className="add-to-cart-button"
        disabled={payment.isPending || expired}
        onClick={() => payment.mutate()}
      >
        {payment.isPending ? "Confirming payment..." : "Pay with UPI"}
      </button>

      <p className="muted small">
        There is no real payment provider in this build. This button asks the
        backend to sign a capture event and send it through the same webhook
        path a real provider would use.
      </p>

      {payment.isError && (
        <p className="message error-message" role="alert">
          {payment.error instanceof Error
            ? payment.error.message
            : "Payment could not be confirmed."}
        </p>
      )}
    </section>
  );
}

function PickupPanel({ order }: { order: Order }) {
  const claim = useClaimPickup(order.id);

  return (
    <section className="cart-summary">
      <h3>Collect from the locker</h3>

      <p>Payment is confirmed. Open the locker when you are ready.</p>

      <button
        type="button"
        className="add-to-cart-button"
        disabled={claim.isPending}
        onClick={() => claim.mutate()}
      >
        {claim.isPending ? "Opening locker..." : "Open locker"}
      </button>

      {claim.isError && (
        <p className="message error-message" role="alert">
          {claim.error instanceof Error
            ? claim.error.message
            : "Could not open the locker. Please ask at the counter."}
        </p>
      )}
    </section>
  );
}

export default function OrderStatusPage() {
  const { orderId = "" } = useParams();
  const { data: order, isPending, isError, error, refetch } =
    useOrderQuery(orderId);

  if (isPending) {
    return (
      <main className="store-page">
        <p className="message" role="status">
          Loading your order...
        </p>
      </main>
    );
  }

  if (isError || !order) {
    return (
      <main className="store-page">
        <section className="welcome-section">
          <h2>We could not load this order</h2>

          <p>
            {error instanceof Error
              ? error.message
              : "This order could not be found."}
          </p>

          <button type="button" onClick={() => void refetch()}>
            Try again
          </button>

          <p>
            <Link to="/">Back to the store</Link>
          </p>
        </section>
      </main>
    );
  }

  const message = STATUS_MESSAGE[order.status];

  return (
    <main className="store-page">
      <section className="welcome-section">
        <p className="eyebrow">ORDER {order.id.slice(0, 8).toUpperCase()}</p>
        <h2>{message.title}</h2>
        <p>{message.body}</p>
        <p className={`status-pill status-${order.status}`}>
          {order.status.replaceAll("_", " ")}
        </p>
      </section>

      {order.status === "pending" && <PaymentPanel order={order} />}
      {order.status === "paid" && <PickupPanel order={order} />}

      <section className="cart-summary">
        <h3>Your items</h3>

        {order.items.map((item) => (
          <div className="cart-summary-row" key={item.productId}>
            <span>
              {item.name} × {item.quantity}
            </span>
            <strong>{formatPrice(item.lineTotalPaise)}</strong>
          </div>
        ))}

        <hr />

        <div className="cart-summary-row">
          <span>Total</span>
          <strong>{formatPrice(order.totalPaise)}</strong>
        </div>
      </section>

      <p>
        <Link to="/">Back to the store</Link>
      </p>
    </main>
  );
}
