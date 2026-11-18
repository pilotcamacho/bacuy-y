import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource.ts";
import { data } from "./data/resource.ts";

const backend = defineBackend({ auth, data });

// The hosted branch holds the users' real data (docs/06-hosting.md, "Backups"):
// - point-in-time recovery: any second of the last 35 days can be restored (into a new table);
// - deletion protection: the tables cannot be deleted (also not by removing the branch)
//   until it is turned off.
// Sandboxes are throwaway test backends and stay as they are.
const deploymentType: unknown = backend.data.stack.node.tryGetContext("amplify-backend-type");
if (deploymentType === "branch") {
  for (const table of Object.values(backend.data.resources.cfnResources.amplifyDynamoDbTables)) {
    table.pointInTimeRecoveryEnabled = true;
    table.deletionProtectionEnabled = true;
  }
}
