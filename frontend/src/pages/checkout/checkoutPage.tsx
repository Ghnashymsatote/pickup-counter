import { Link, useNavigate } from "react-router";

import { useCart } from "../../feature/cart/useCart";
import { formatPrice } from "../../feature/cart/CartUtil";
import { useCreateOrder } from "../../hook/useCreateOrder";

export default function CheckoutPage() {
  const { items, itemCount, totalPaise, clearCart } = useCart();
  const navigate = useNavigate();
  const createOrder = useCreateOrder();

  async function handlePlaceOrder() {
    if (items.length === 0) return;

    try {
      const order = await createOrder.mutateAsync({
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
      });

      // Only clear the cart once the hold actually exists. If the order was
      // rejected for stock, the customer keeps their cart and can adjust it.
      clearCart();
      void navigate(`/orders/${order.id}`);
    } catch {
      // Surfaced from createOrder.error below.
    }
  }

  if (items.length === 0) {
    return (
      <div className="store-page narrow">
        <section className="empty-state">
          <h2>Your cart is empty</h2>
          <p>Pick a few snacks before checking out.</p>
          <Link to="/" className="add-to-cart-button">
            Back to the store
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="store-page narrow">
      <section className="welcome-section">
        <p className="eyebrow">Step 1 of 2</p>
        <h2>Checkout</h2>
        <p>
          Placing the order holds your items for 120 seconds while you pay.
        </p>
      </section>

      <section className="cart-summary">
        <h3>Order summary</h3>

        {items.map((item) => (
          <div className="cart-summary-row" key={item.product.id}>
            <span>
              {item.product.name} × {item.quantity}
            </span>
            <strong>
              {formatPrice(item.product.pricePaise * item.quantity)}
            </strong>
          </div>
        ))}

        <hr />

        <div className="cart-summary-row">
          <span>Items</span>
          <strong>{itemCount}</strong>
        </div>

        <div className="cart-summary-row">
          <span>Total</span>
          <strong>{formatPrice(totalPaise)}</strong>
        </div>

        {createOrder.isError && (
          <p className="message error-message" role="alert">
            {createOrder.error instanceof Error
              ? createOrder.error.message
              : "Could not place your order. Please try again."}
          </p>
        )}

        <button
          type="button"
          className="add-to-cart-button"
          disabled={createOrder.isPending}
          onClick={() => void handlePlaceOrder()}
        >
          {createOrder.isPending ? "Holding your items..." : "Place order"}
        </button>

        <Link to="/">Keep shopping</Link>
      </section>
    </div>
  );
}
