
import { useCart } from "../../feature/cart/useCart";
import { formatPrice } from "../../feature/cart/CartUtil";
import type { Product } from "../../types/product";


type ProductCardProps = {
  product: Product;
};

export default function ProductCard({ product }: ProductCardProps) {
  const { items, addItem, updateQuantity } = useCart();

  const cartItem = items.find(
    (item) => item.product.id === product.id,
  );

  const quantity = cartItem?.quantity ?? 0;
  const isAvailable = product.availableStock > 0;
  const canAddMore = quantity < product.availableStock;

  function handleAddToCart() {
    if (!isAvailable || !canAddMore) return;

    addItem(product);
  }

  function handleQuantityChange(nextQuantity: number) {
    updateQuantity(product.id, nextQuantity);
  }

  return (
    <article className="product-card">
      <div className="product-visual">
        <span className="product-initial">
          {product.name.charAt(0)}
        </span>
      </div>

      <div className="product-details">
        <h3>{product.name}</h3>

        <p className="product-price">
          {formatPrice(product.pricePaise)}
        </p>

        <div className="product-footer">
          <span
            className={
              isAvailable
                ? "stock available"
                : "stock unavailable"
            }
          >
            {isAvailable
              ? `${product.availableStock} available`
              : "Out of stock"}
          </span>

          <span className="stock-label">
            {isAvailable ? "In stock" : "Unavailable"}
          </span>
        </div>

        {quantity === 0 ? (
          <button
            type="button"
            className="add-to-cart-button"
            disabled={!isAvailable}
            onClick={handleAddToCart}
          >
            {isAvailable ? "Add to Cart" : "Out of Stock"}
          </button>
        ) : (
          <div className="quantity-control">
            <button
              type="button"
              aria-label={`Remove one ${product.name}`}
              onClick={() => handleQuantityChange(quantity - 1)}
            >
              −
            </button>

            <span>{quantity}</span>

            <button
              type="button"
              aria-label={`Add one ${product.name}`}
              disabled={!canAddMore}
              onClick={handleAddToCart}
            >
              +
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
