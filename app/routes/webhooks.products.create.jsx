import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    console.log("dp11........................", admin, session)

    const { topic, shop, payload } = await authenticate.webhook(request);

    if (!payload?.admin_graphql_api_id) {
      console.error("❌ Missing product ID in webhook payload");
      return new Response("Invalid payload: Missing product ID", { status: 400 });
    }

    const productId = payload.admin_graphql_api_id;
    console.log(`🔔............. Webhook Topic: ${topic} | Shop: ${shop}`);
    console.log(`session Topic: ${session}`);
    console.log("📦 Product ID:", productId);

    // Step 1: Fetch 'System Source' metafield
    const fetchMetafieldsQuery = `
      query FetchSystemSource($id: ID!) {
        product(id: $id) {
          metafield(namespace: "custom", key: "system_source") {
            value
          }
        }
      }
    `;

    const metafieldResult = await admin.graphql(fetchMetafieldsQuery, {
      variables: { id: productId },
    });

    const metafieldData = await metafieldResult.json();

    const systemSourceValue = metafieldData?.data?.product?.metafield?.value;

    if (systemSourceValue === "node-admin") {
      console.log("⛔ Skipping metafield clearing due to System Source = node-admin");
      return new Response("Skipped: Product managed by node-admin", { status: 200 });
    }

    const metafieldsToClear = [
      { namespace: 'custom', key: 'shape' },
      { namespace: 'custom', key: 'metal' },
      { namespace: 'custom', key: 'style' },
      { namespace: 'custom', key: 'group_name' },
    ];

    const metafieldInputs = metafieldsToClear.map(({ namespace, key }) => ({
      ownerId: productId,
      namespace,
      key,
    }));

    const mutation = `
      mutation MetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          deletedMetafields {
            key
            namespace
            ownerId
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await admin.graphql(mutation, {
      variables: {
        metafields: metafieldInputs,
      },
    });

    const data = await response.json();

    const errors = data?.data?.metafieldsDelete?.userErrors || [];

    if (errors.length > 0) {
      console.error("❌ Metafield deletion errors:", errors);
      return new Response("Metafields delete encountered errors", { status: 500 });
    }

    console.log("✅ Deleted metafields:", data?.data?.metafieldsDelete?.deletedMetafields);
    return new Response("Metafields cleared successfully", { status: 200 });

  } catch (error) {
    console.error("❌ Error processing webhook:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
