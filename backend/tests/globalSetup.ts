import "dotenv/config";

/**
 * Fails fast with a useful message if the stack is not up, rather than
 * letting every test fail on a connection refused.
 */
export default async function setup(): Promise<void> {
    const baseUrl = process.env.API_BASE_URL ?? "http://localhost:5001";

    if (!process.env.DATABASE_URL) {
        throw new Error(
            "DATABASE_URL is not set. Copy backend/.env.example to .env.",
        );
    }

    if (!process.env.WEBHOOK_SECRET) {
        throw new Error(
            "WEBHOOK_SECRET is not set. Copy backend/.env.example to .env.",
        );
    }

    let response: Response;

    try {
        response = await fetch(`${baseUrl}/health`);
    } catch {
        throw new Error(
            `The backend is not reachable at ${baseUrl}.\n` +
                "Start the stack first: docker compose up -d",
        );
    }

    if (!response.ok) {
        throw new Error(
            `${baseUrl}/health returned ${response.status}. ` +
                "Is the database up?",
        );
    }
}
