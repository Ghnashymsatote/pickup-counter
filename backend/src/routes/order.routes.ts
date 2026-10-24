import { Router } from "express";
import { asyncHandler, badRequest } from "../http/errors.js";
import {
    claimPickup,
    createOrder,
    createOrderSchema,
    getOrder,
    orderIdSchema,
} from "../services/orders.service.js";

const router = Router();

/** Routes stay thin: parse, delegate, serialise. The rules live in services. */

function parseOrderId(value: unknown): string {
    const parsed = orderIdSchema.safeParse(value);

    if (!parsed.success) {
        throw badRequest("INVALID_ORDER_ID", "A valid order ID is required.");
    }

    return parsed.data;
}

router.post(
    "/",
    asyncHandler(async (req, res) => {
        const parsed = createOrderSchema.safeParse(req.body);

        if (!parsed.success) {
            throw badRequest(
                "INVALID_REQUEST",
                "Provide valid product IDs and positive integer quantities.",
                {
                    issues: parsed.error.issues.map((issue) => ({
                        path: issue.path.join("."),
                        message: issue.message,
                    })),
                },
            );
        }

        res.status(201).json({ order: await createOrder(parsed.data) });
    }),
);

router.get(
    "/:id",
    asyncHandler(async (req, res) => {
        const orderId = parseOrderId(req.params.id);

        // Status is live state, and the countdown depends on it; never let a
        // proxy or the browser serve a cached copy.
        res.set("Cache-Control", "no-store");
        res.json({ order: await getOrder(orderId) });
    }),
);

router.post(
    "/:id/pickup-claim",
    asyncHandler(async (req, res) => {
        const orderId = parseOrderId(req.params.id);
        const result = await claimPickup(orderId);

        res.json({
            success: true,
            ...result,
            message: "Pickup claim successful. Collect your order.",
        });
    }),
);

export default router;
