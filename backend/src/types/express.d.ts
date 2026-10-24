declare global {
    namespace Express {
        interface Request {
            /**
             * The exact bytes of the request body, captured while JSON is
             * parsed. The payment webhook signature is an HMAC of these
             * bytes, so re-serialising the parsed object would not do.
             */
            rawBody?: Buffer;
        }
    }
}

export {};
