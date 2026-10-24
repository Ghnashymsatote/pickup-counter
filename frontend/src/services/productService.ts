import { apiFetch } from "../lib/api";
import type { Product } from "../types/product";

export async function getProducts(): Promise<Product[]> {
  const data = await apiFetch<{ products: Product[] }>("/products");

  return data.products;
}
