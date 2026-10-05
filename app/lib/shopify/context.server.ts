import { authenticate } from "../../shopify.server";
import { AdminGateway } from "./admin-gateway";

/** Authenticates an embedded admin request and returns a resilient gateway. */
export async function adminContext(request: Request) {
  const { admin, session } = await authenticate.admin(request);
  return { gateway: new AdminGateway(admin.graphql), session };
}
