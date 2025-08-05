import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  try {
    const { topic, shop, payload, admin } = await authenticate.webhook(request);

    if (!payload?.admin_graphql_api_id) {
      console.error("❌ Missing product ID in webhook payload");
      return new Response("Invalid payload: Missing product ID", { status: 400 });
    }

    const productId = payload.admin_graphql_api_id;
    console.log(`🔔 Webhook Topic: ${topic} | Shop: ${shop}`);
    console.log("📦 Product ID:", productId);

    console.log("admin", admin)

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
