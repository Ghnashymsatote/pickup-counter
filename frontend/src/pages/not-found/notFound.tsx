import { Link } from "react-router";

export default function NotFoundPage() {
  return (
    <div className="store-page narrow">
      <section className="empty-state">
        <h1>404 &mdash; page not found</h1>
        <p>The page you are looking for does not exist.</p>
        <Link to="/" className="add-to-cart-button">
          Return to the store
        </Link>
      </section>
    </div>
  );
}