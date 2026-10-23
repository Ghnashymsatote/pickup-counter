
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { useCart } from "../../feature/cart/useCart";
import { formatPrice } from "../../feature/cart/CartUtil";
import { useCreateOrder } from "../../hook/useCreateOrder";


export default function CheckoutPage() {
  const { items, itemCount, totalPaise, clearCart } = useCart();
  const navigate = useNavigate();
  const createOrderMutation = useCreateOrder();

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [pickupNote, setPickupNote] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (items.length === 0) return;

    try {
      const order = await createOrderMutation.mutateAsync({
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
      });

      clearCart();
      navigate(`/orders/${order.id}`);
    } catch (error) {
      console.error("Order creation failed:", error);
    }
  }

  if (items.length === 0) {
    return (
      <main className="store-page">
        <h2>Your cart is empty</h2>
        <p>Add some products before proceeding to checkout.</p>
        <Link to="/">Back to Store</Link>
      </main>
    );
  }

  return (
    <main className="store-page">
      <section className="welcome-section">
        <h2>Checkout</h2>
        <p>Review your items and enter your pickup details.</p>
      </section>

      <div className="cart-layout">
        <section className="cart-summary">
          <h2>Order Summary</h2>

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
            <span>Total items</span>
            <strong>{itemCount}</strong>
          </div>

          <div className="cart-summary-row">
            <span>Total amount</span>
            <strong>{formatPrice(totalPaise)}</strong>
          </div>

          <Link to="/" className="checkout-button">
            Continue Shopping
          </Link>
        </section>

        <section className="cart-summary">
          <h2>Pickup Details</h2>

          <form onSubmit={handleSubmit}>
            <label htmlFor="customerName">Full Name</label>
            <input
              id="customerName"
              name="customerName"
              type="text"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              required
              minLength={2}
              autoComplete="name"
            />

            <label htmlFor="phone">Phone Number</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
              pattern="[0-9]{10}"
              title="Enter a 10-digit phone number"
              autoComplete="tel"
            />

            <label htmlFor="pickupNote">Pickup Note (Optional)</label>
            <textarea
              id="pickupNote"
              name="pickupNote"
              value={pickupNote}
              onChange={(event) => setPickupNote(event.target.value)}
              rows={3}
              placeholder="Any special pickup instructions?"
            />

            {createOrderMutation.isError && (
              <p className="message error-message" role="alert">
                {createOrderMutation.error instanceof Error
                  ? createOrderMutation.error.message
                  : "Could not create your order. Please try again."}
              </p>
            )}

            <button
              type="submit"
              className="add-to-cart-button"
              disabled={createOrderMutation.isPending}
            >
              {createOrderMutation.isPending
                ? "Creating Order..."
                : "Place Order"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
