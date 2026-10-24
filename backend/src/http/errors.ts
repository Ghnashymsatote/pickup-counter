import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { env } from "../config/env.js";

/**
 * An error that is safe to show the caller. Everything else becomes a generic
 * 500 so internal details (SQL, stack traces) never reach a response body.
 */
export class AppError extends Error {
    constructor(
        readonly statusCode: number,
        readonly code: string,
        message: string,
        readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "AppError";
    }
}

export const badRequest = (
    code: string,
    message: string,
    details?: Record<string, unknown>,
) => new AppError(400, code, message, details);

export const notFound = (code: string, message: string) =>
    new AppError(404, code, message);

export const conflict = (
    code: string,
    message: string,
    details?: Record<string, unknown>,
) => new AppError(409, code, message, details);

export const unauthorized = (code: string, message: string) =>
    new AppError(401, code, message);

/**
 * Express 5 forwards rejected promises to the error middleware, but wrapping
 * handlers keeps that explicit and survives a downgrade to Express 4.
 */
export const asyncHandler =
    (handler: RequestHandler): RequestHandler =>
    (req, res, next) => {
        void Promise.resolve(handler(req, res, next)).catch(next);
    };

export function notFoundHandler(req: Request, res: Response): void {
    res.status(404).json({
        error: "ROUTE_NOT_FOUND",
        message: `Cannot ${req.method} ${req.path}`,
    });
}

type SyntaxErrorWithBody = SyntaxError & { status?: number; body?: unknown };

function isBodyParseError(error: unknown): error is SyntaxErrorWithBody {
    return (
        error instanceof SyntaxError &&
        "body" in error &&
        (error as SyntaxErrorWithBody).status === 400
    );
}

/**
 * The single place where an error becomes an HTTP response. Without this,
 * malformed JSON returns Express's default HTML stack-trace page.
 */
export function errorHandler(
    error: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
): void {
    if (res.headersSent) {
        next(error);
        return;
    }

    if (error instanceof AppError) {
        res.status(error.statusCode).json({
            error: error.code,
            message: error.message,
            ...(error.details ?? {}),
        });
        return;
    }

    if (isBodyParseError(error)) {
        res.status(400).json({
            error: "MALFORMED_JSON",
            message: "Request body is not valid JSON.",
        });
        return;
    }

    if (error instanceof ZodError) {
        res.status(400).json({
            error: "INVALID_REQUEST",
            message: "Request failed validation.",
            issues: error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
            })),
        });
        return;
    }

    console.error("Unhandled request error:", error);

    res.status(500).json({
        error: "INTERNAL_SERVER_ERROR",
        message: "Something went wrong. Please try again.",
        ...(env.NODE_ENV === "development" && error instanceof Error
            ? { debug: error.message }
            : {}),
    });
}
