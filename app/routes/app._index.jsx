import { Page, Layout, Text, Card, BlockStack } from "@shopify/polaris";
export default function Index() {
  
  return (
    <Page title="Welcome to Product Variation App">
            <Layout>
                <Layout.Section>
                    <Card sectioned>
                        <BlockStack gap="400">
                            <Text variant="headingLg" as="h1">
                                👋 Welcome to Your Shopify Product Variation App
                            </Text>
                            <Text variant="bodyMd" as="p">
                                This app helps you manage product variations by assigning specific metafields such as Group Name, Style, Metal, and Shape to products based on their collections (Engagement Rings or Wedding Rings).
                            </Text>
                            <Text variant="bodyMd" as="p">
                                Use this tool to avoid duplicate variations and ensure consistent metafield setup across your products.
                            </Text>
                            <Text variant="bodyMd" as="p">
                                Get started by navigating to a product from the app or clicking a product in your Shopify Admin.
                            </Text>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
  );
}
