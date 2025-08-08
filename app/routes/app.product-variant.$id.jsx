import {
    Page,
    Layout,
    Card,
    Button,
    Banner,
    Frame,
    BlockStack,
    InlineStack,
    Text,
    TextField,
    Box,
    Spinner,
} from "@shopify/polaris";
import {
    useLoaderData,
    useFetcher,
    data
} from "@remix-run/react";
import { authenticate } from "../shopify.server"; // from Shopify Remix app template
import { useEffect, useState } from "react";

export const loader = async ({ params, request }) => {
    const { id } = params;
    const { admin, session } = await loadCriticalData({ request });
    const storeName = session.shop.replace('.myshopify.com', '')
    const productId = `gid://shopify/Product/${id}`;

    // 3. Get product_description metafield from 'productdata' namespace
    const descRes = await admin.graphql(
        `#graphql
        query Product($id: ID!) {
            product(id: $id) {
            id
            title
            metafield(namespace: "productdata", key: "product_description") {
                value
                }
            }
        }`,
        {
            variables: { id: productId },
        }
    );

    const descJson = await descRes.json();
    const productData = descJson?.data?.product;

    return {
        productId,
        storeName,
        id,
        productData
    };
};

async function loadCriticalData({ request }) {
    const { admin, session } = await authenticate.admin(request);
    return { admin, session };
}

export const action = async ({ request }) => {
    try {
        const { admin } = await loadCriticalData({ request });
        const form = await request.formData();
        const productId = form.get("productId");
        const productDescriptionRaw = form.get("metafieldData");

        // Validation check
        if (!productId || !productDescriptionRaw) {
            return data(
                {
                    status: "error",
                    error: "Missing productId or metafieldData in form data.",
                    source: "validation",
                },
                { status: 400 }
            );
        }

        const descRes = await admin.graphql(
            `#graphql
            mutation SetProductDescription($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
                metafields {
                id
                key
                value
                }
                userErrors {
                field
                message
                }
            }
            }`,
            {
                variables: {
                    metafields: [
                        {
                            ownerId: productId,
                            namespace: "productdata",
                            key: "product_description",
                            type: "json",
                            value: productDescriptionRaw,
                        },
                    ],
                },
            }
        );

        const descResJSON = await descRes.json();

        // Catch GraphQL errors (not just userErrors)
        if (descResJSON.errors) {
            return data(
                {
                    status: "error",
                    error: descResJSON.errors.map((e) => e.message).join(", "),
                    source: "graphql",
                },
                { status: 500 }
            );
        }

        const descErrors = descResJSON.data?.metafieldsSet?.userErrors || [];

        if (descErrors.length > 0) {
            return data(
                {
                    status: "error",
                    error: descErrors.map((e) => e.message).join(", "),
                    source: "userErrors",
                },
                { status: 400 }
            );
        }

        // ✅ Success
        return data({
            status: "success",
            success: "Product description saved successfully.",
        });

    } catch (err) {
        // Catch unexpected or runtime errors
        console.error("Unexpected error in action:", err);
        return data(
            {
                status: "error",
                error: err.message || "Unexpected error occurred.",
                source: "exception",
            },
            { status: 500 }
        );
    }
};

export default function ProductForm() {
    const { productId, storeName, id, productData } = useLoaderData();
    const fetcher = useFetcher();
    const isSubmitting = fetcher.state !== "idle";
    const [toast, setToast] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [outerGroups, setOuterGroups] = useState([]);
    const [newOuterKey, setNewOuterKey] = useState("");
    const [outerKeyError, setOuterKeyError] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!fetcher?.data?.data) return;

        const { status, error, success } = fetcher.data.data;

        if (status === "error") {
            setError(error);
        } else if (status === "success") {
            setToast(true);
            setSuccess(success);
            const timeout = setTimeout(() => setToast(false), 4000);
            return () => clearTimeout(timeout);
        }
    }, [fetcher.data]);

    useEffect(() => {

        if (!productData) return;

        try {
            if (!productData.metafield?.value) {
                setOuterGroups([]); // No groups to show for new product
            } else {
                const parsed = JSON.parse(productData.metafield.value);
                const groups = Object.entries(parsed).map(([outerKey, innerObj]) => ({
                    outerKey,
                    innerFields: Object.entries(innerObj).map(([key, value]) => ({ key, value })),
                }));
                setOuterGroups(groups);
            }
        } catch (err) {
            setError(err)
            console.error("Invalid metafield JSON", err);
        } finally {
            setLoading(false)
        }
    }, [productData]);


    const handleRedirectToAdminProduct = () => {
        window.top.location.href = `https://admin.shopify.com/store/${storeName}/products/${id}`;
    };


    const handleOuterKeyChange = (index, value) => {
        const updated = [...outerGroups];
        updated[index].outerKey = value;
        setOuterGroups(updated);
    };

    const handleInnerChange = (groupIndex, fieldIndex, field, value) => {
        const updated = [...outerGroups];
        updated[groupIndex].innerFields[fieldIndex][field] = value;
        setOuterGroups(updated);
    };


    const addOuterGroup = () => {
        const trimmed = newOuterKey.trim();

        if (!trimmed) {
            setOuterKeyError("Group name cannot be empty.");
            return;
        }

        const exists = outerGroups.some((group) => group.outerKey === trimmed);
        if (exists) {
            setOuterKeyError("Group name must be unique.");
            return;
        }

        setOuterGroups([
            ...outerGroups,
            { outerKey: trimmed, innerFields: [{ key: "", value: "" }] },
        ]);
        setNewOuterKey("");
        setOuterKeyError(null);
    };

    const addInnerField = (groupIndex) => {
        const updated = [...outerGroups];
        updated[groupIndex].innerFields.push({ key: "", value: "" });
        setOuterGroups(updated);
    };


    const removeOuterGroup = (groupIndex) => {
        const updated = [...outerGroups];
        updated.splice(groupIndex, 1);
        setOuterGroups(updated);
    };

    const removeInnerField = (groupIndex, fieldIndex) => {
        const updated = [...outerGroups];
        if (updated[groupIndex].innerFields.length > 1) {
            updated[groupIndex].innerFields.splice(fieldIndex, 1);
            setOuterGroups(updated);
        }
    };

    const onSubmit = () => {
        const result = {};
        outerGroups.forEach(({ outerKey, innerFields }) => {
            if (!outerKey.trim()) return;
            result[outerKey] = {};
            innerFields.forEach(({ key, value }) => {
                if (key.trim()) {
                    result[outerKey][key] = value;
                }
            });
        });
        setError(null)
        setToast(false);
        setSuccess(null);

        const formData = new FormData();

        // 🟢 Send description/metafield JSON
        formData.append("metafieldData", JSON.stringify(result));

        // 🟢 Send product identifiers
        formData.append("productId", productId);

        fetcher.submit(formData, { method: "POST" }); // ✅ Native Remix submission
    };

    return (
        <Frame>
            <Page title="Product Description">
                <Layout>
                    <Layout.Section>
                        <BlockStack gap="400">
                            <InlineStack>
                                <Button
                                    size="large"
                                    onClick={handleRedirectToAdminProduct}
                                    variant="tertiary"
                                >
                                    ← Back to Product
                                </Button>
                            </InlineStack>
                            {/* ❌ Show error if exists */}
                            {error && (
                                <Banner status="critical" title="Error">
                                    {error}
                                </Banner>
                            )}

                            {/* ✅ Show success toast/banner */}
                            {toast && (
                                <Banner status="success" title="Success">
                                    {success}
                                </Banner>
                            )}

                            { loading ? (
                                <Box padding="400" align="center">
                                    <Spinner size="large" />
                                </Box>
                            ) : (<>
                                {outerGroups.map((group, groupIndex) => (
                                    <Card key={groupIndex} sectioned>
                                        <BlockStack gap="300">
                                            <InlineStack align="space-between">
                                                <TextField
                                                    value={group.outerKey}
                                                    onChange={(val) =>
                                                        handleOuterKeyChange(groupIndex, val)
                                                    }
                                                />
                                                <Button
                                                    tone="critical"
                                                    variant="primary"
                                                    onClick={() => removeOuterGroup(groupIndex)}
                                                >
                                                    Remove Group
                                                </Button>
                                            </InlineStack>

                                            {group.innerFields.map((field, fieldIndex) => (
                                                <InlineStack key={fieldIndex} gap="200" align="end">
                                                    <TextField
                                                        value={field.key}
                                                        onChange={(val) =>
                                                            handleInnerChange(
                                                                groupIndex,
                                                                fieldIndex,
                                                                "key",
                                                                val
                                                            )
                                                        }
                                                    />
                                                    <TextField
                                                        value={field.value}
                                                        onChange={(val) =>
                                                            handleInnerChange(
                                                                groupIndex,
                                                                fieldIndex,
                                                                "value",
                                                                val
                                                            )
                                                        }
                                                    />
                                                    <Button
                                                        tone="critical"
                                                        variant="secondary"
                                                        size="slim"
                                                        onClick={() =>
                                                            removeInnerField(groupIndex, fieldIndex)
                                                        }
                                                    >
                                                        Remove
                                                    </Button>
                                                </InlineStack>
                                            ))}

                                            <Button
                                                variant="tertiary"
                                                onClick={() => addInnerField(groupIndex)}
                                            >
                                                + Add Data
                                            </Button>
                                        </BlockStack>
                                    </Card>
                                ))}
                                <BlockStack gap="100">
                                    <InlineStack gap="200" align="start">
                                        <TextField
                                            value={newOuterKey}
                                            onChange={(value) => {
                                                setNewOuterKey(value);
                                                if (outerKeyError) setOuterKeyError(null);
                                            }}
                                            placeholder="Enter New Group"
                                            autoComplete="off"
                                        />
                                        <Button onClick={addOuterGroup} variant="primary">
                                            + Add Group
                                        </Button>
                                    </InlineStack>

                                    {outerKeyError && (
                                        <Text tone="critical" variant="bodyMd">
                                            {outerKeyError}
                                        </Text>
                                    )}
                                </BlockStack>
                                <BlockStack gap="200">
                                    <Button onClick={onSubmit} variant="primary" loading={isSubmitting} disabled={isSubmitting}>
                                        save
                                    </Button>
                                </BlockStack>
                            </>)}
                        </BlockStack>
                    </Layout.Section>
                </Layout>
            </Page>
        </Frame>
    );
}
