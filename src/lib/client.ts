import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

/**
 * Typed AppSync client. Only `src/services/sync/*` may import this module:
 * screens and stores read and write LocalDb, never the network.
 */
export const client = generateClient<Schema>();

export type { Schema };
