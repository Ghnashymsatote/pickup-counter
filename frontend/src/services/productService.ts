
import type { Product } from "../types/product";

const API_URL = "http://localhost:5001";

export async function getProducts(): Promise<Product[]> {
  const response = await fetch(`${API_URL}/products`);

  if (!response.ok) {
    throw new Error("Could not load products.");
  }

  const data: { products: Product[] } = await response.json();

  return data.products;
}
