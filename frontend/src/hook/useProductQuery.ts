import { useQuery } from "@tanstack/react-query";
import { getProducts } from "../services/productService";

export function useProductsQuery() {
  return useQuery({
    queryKey: ["products"],
    queryFn: getProducts,
    // Available units change whenever anyone else holds or releases stock,
    // so the store screen refreshes while it is open.
    refetchInterval: 5000,
    staleTime: 2000,
  });
}
