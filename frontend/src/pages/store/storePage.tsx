import ProductGrid from "../../components/products/ProductGrid";
import CartItem from "../../components/Cart/CartItem";
import CartSummary from "../../components/Cart/CartSummery";
import { useCart } from "../../feature/cart/useCart";
import { useProductsQuery } from "../../hook/useProductQuery";

export default function StorePage() {
  const {
    data: products = [],
    isPending,
    isError,
    error,
    refetch,
  } = useProductsQuery();

  const { items } = useCart();

  return (
    <div className="store-page">
      <section className="welcome-section">
        <p className="eyebrow">Your local store</p>
        <h2>What would you like today?</h2>
        <p>
          Pick your snacks, pay by UPI, and collect them from the locker.
          Availability updates every few seconds.
        </p>
      </section>

      <section className="products-section">
        <div className="section-heading">
          <div>
            <h2>Available products</h2>
            <p>Choose from our current stock.</p>
          </div>

          {!isPending && !isError && (
            <span className="product-count">
              {products.length} products
            </span>
          )}
        </div>

        {isPending && (
          <p className="message" role="status">
            Loading products...
          </p>
        )}

        {isError && (
          <div className="message error-message" role="alert">
            <p>
              {error instanceof Error
                ? error.message
                : "Unable to load products. Please try again."}
            </p>

            <button type="button" onClick={() => void refetch()}>
              Try again
            </button>
          </div>
        )}

        {!isPending && !isError && products.length === 0 && (
          <p className="message">No products are available right now.</p>
        )}

        {!isPending && !isError && products.length > 0 && (
          <ProductGrid products={products} />
        )}
      </section>

      <section className="cart-section">
        <h2>Your cart</h2>

        {items.length === 0 ? (
          <p className="message">
            Your cart is empty. Add a snack to get started.
          </p>
        ) : (
          <div className="cart-layout">
            <div className="cart-items">
              {items.map((item) => (
                <CartItem key={item.product.id} item={item} />
              ))}
            </div>

            <CartSummary />
          </div>
        )}
      </section>
    </div>
  );
}
