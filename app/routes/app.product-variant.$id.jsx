import {
    Page,
    Layout,
    Card,
    Select,
    Button,
    Banner,
    Frame,
    BlockStack,
    InlineStack
} from "@shopify/polaris";
import {
    useLoaderData,
    useActionData,
    Form,
    useNavigation,
    data,
} from "@remix-run/react";
import { authenticate } from "../shopify.server"; // from Shopify Remix app template
import { useEffect, useState } from "react";

const requiredFieldMap = {
    "engagement-rings": ["Group Name", "Style", "Metal", "Shape"],
    "wedding-rings": ["Group Name", "Style", "Metal"]
};



export const loader = async ({ params, request }) => {
    const { id } = params;
    const { admin, session } = await loadCriticalData({ request });
    const storeName = session.shop.replace('.myshopify.com', '')
    const productId = `gid://shopify/Product/${id}`;

    // 1. Get metafield definitions
    const defsRes = await admin.graphql(
        `#graphql
        query GetMetafieldDefinitions {
        metafieldDefinitions(first: 100, ownerType: PRODUCT) {
            edges {
            node {
                id
                name
                validations {
                name
                value
                }
            }
            }
        }
        }
    `
    );

    const defsJson = await defsRes.json();
    const definitions = defsJson?.data?.metafieldDefinitions?.edges?.map(
        (edge) => edge.node
    );



    // 2. Get product's existing metafields and collection
    const prodRes = await admin.graphql(
        `#graphql
        query GetProductData($id: ID!) {
        product(id: $id) {
            collections(first: 1) {
            nodes {
                handle
                id
            }
            }
            metafields(namespace: "custom", first: 10) {
            nodes {
                key
                value
            }
            }
        }
        }
        `,
        {
            variables: {
                id: productId,
            },
        }
    );

    const proJson = await prodRes.json();
    const metafields = proJson.data?.product?.metafields?.nodes || [];
    const collectionHandle = proJson?.data?.product?.collections?.nodes?.[0]?.handle || "";
    const collection_id = proJson?.data?.product?.collections?.nodes?.[0]?.id || "";

    // Get required fields based on the collection handle
    const neededFields = requiredFieldMap[collectionHandle] || [];

    // Build initialValues object dynamically
    const initialValues = neededFields.reduce((acc, label) => {
        acc[label] = "";
        return acc;
    }, {});

    metafields.forEach((mf) => {
        const label = Object.keys(initialValues).find(
            (k) => mf.key === k.toLowerCase().replace(/ /g, "_")
        );
        if (label) initialValues[label] = mf.value;
    });


    const selectedDefs = definitions.filter((def) =>
        neededFields.includes(def.name)
    );

    const choicesMap = {};
    selectedDefs.forEach((def) => {
        const choiceVal = def.validations.find((v) => v.name === "choices");
        choicesMap[def.name] = choiceVal ? JSON.parse(choiceVal.value) : [];
    });

    return {
        productId,
        choicesMap,
        initialValues,
        collectionHandle,
        collection_id,
        storeName,
        id
    };
};

async function loadCriticalData({ request }) {
    const { admin, session } = await authenticate.admin(request);
    return { admin, session };
}

export const action = async ({ request, params }) => {
    try {
        const { admin } = await loadCriticalData({ request });
        const form = await request.formData();
        const productId = form.get("productId");
        const collectionHandle = form.get("collectionHandle");
        const collectionId = form.get("collectionId");

        const requiredFields = requiredFieldMap[collectionHandle] || [];

        // ✅ Dynamically build formValues
        const formValues = {};
        for (const field of requiredFields) {
            formValues[field] = form.get(field);
        }

        // ❌ Check for missing required fields
        const missing = requiredFields.filter((f) => !formValues[f]);
        if (missing.length > 0) {
            return data(
                {
                    status: "error",
                    error: `Missing fields: ${missing.join(", ")}`,
                },
                { status: 400 }
            );
        }

        // Check for duplicate product
        const queryFilters = requiredFields
            .map((key) => `metafields.custom.${key.toLowerCase().replace(/\s/g, "_")}:'${formValues[key]}'`)
            .join(" AND ");

        const dupRes = await admin.graphql(
            `#graphql
        query CheckDuplicateProduct($query: String!, $collectionId: ID!) {
            products(first: 100, query: $query) {
            edges {
                node {
                id
                inCollection(id: $collectionId)
                }
            }
            }
        }
        `,
            {
                variables: {
                    query: queryFilters,
                    collectionId,
                },
            }
        );

        const dupResJSON = await dupRes.json();

        const isDuplicate = dupResJSON.data.products.edges.some(
            (edge) => edge.node.inCollection
        );

        if (isDuplicate) {
            return data(
                {
                    status: "error",
                    error: "A product with the same variation already exists.",
                },
                { status: 400 }
            );
        }

        // 📝 Prepare metafields to save
        const metafields = requiredFields.map((label) => ({
            ownerId: productId,
            namespace: "custom",
            key: label.toLowerCase().replace(/\s/g, "_"),
            type: "single_line_text_field",
            value: formValues[label],
        }));

        const saveMetafields = await admin.graphql(
            `#graphql
        mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
                metafields {
                    id
                    namespace
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
                variables: { metafields },
            }
        );

        const saveMetafieldsJSON = await saveMetafields.json()

        const errors = saveMetafieldsJSON.data.metafieldsSet.userErrors;
        if (errors.length > 0) {
            return data(
                {
                    status: "error",
                    error: errors.map((e) => e.message).join(", "),
                },
                { status: 400 }
            );
        }

        // ✅ Success
        return data({
            status: "success",
            success: "Product Variation saved successfully.",
        });
    } catch (err) {
        console.error("Action failed:", err);
        return data(
            {
                status: "error",
                error: err.message || "Something went wrong on the server.",
            },
            { status: 500 }
        );
    }
};

export default function ProductForm() {
    const { choicesMap, collectionHandle, collection_id, initialValues, productId, storeName, id } = useLoaderData();
    const [formValues, setFormValues] = useState(initialValues);
    const actionData = useActionData();
    const nav = useNavigation();
    const isSubmitting = nav.state !== "idle";
    const [toast, setToast] = useState(false);
    const [error, setError] = useState(null);
    const allowedFields = requiredFieldMap[collectionHandle]; // if undefined, collection is not allowed
    const isAllowedCollection = Boolean(allowedFields);
    // const success = new URLSearchParams(location.search).has("success");

    useEffect(() => {
        if (!actionData) return;

        if (actionData.status === "error") {
            setError(actionData.error);
        }
        else if (actionData?.status === "success") {
            setToast(true);
            const timeout = setTimeout(() => setToast(false), 4000);
            return () => clearTimeout(timeout);
        }
    }, [actionData]);

    const handleChange = (field) => (value) => {
        setError('')
        setFormValues((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handleRedirectToAdminProduct = () => {
        window.top.location.href = `https://admin.shopify.com/store/${storeName}/products/${id}`;
    };

    return (
        <Frame>
            <Page title="Product Variation">
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
                                    {actionData?.success}
                                </Banner>
                            )}

                            {!isAllowedCollection ? (
                                <Banner status="info" title="Unsupported Collection">
                                    This product is not part of a supported collection. Please make sure the product
                                    belongs to "engagement-rings" or "wedding-rings".
                                </Banner>
                            ) : (
                                <Card sectioned>
                                    <Form method="post">
                                        <BlockStack gap="400">
                                            <input type="hidden" name="productId" value={productId} />
                                            <input
                                                type="hidden"
                                                name="collectionHandle"
                                                value={collectionHandle}
                                            />
                                            <input
                                                type="hidden"
                                                name="collectionId"
                                                value={collection_id}
                                            />

                                            {Object.entries(choicesMap).map(([label, options]) =>
                                                <Select
                                                    key={label}
                                                    label={label}
                                                    name={label}
                                                    value={formValues[label]}
                                                    options={[
                                                        { label: `Select ${label}`, value: "" },
                                                        ...options.map((o) => ({ label: o, value: o }))
                                                    ]}
                                                    onChange={handleChange(label)}
                                                />

                                            )}

                                            <InlineStack>
                                                <Button
                                                    primary
                                                    submit
                                                    size="large"
                                                    loading={isSubmitting}
                                                    disabled={isSubmitting}
                                                    style={{ marginTop: "3rem" }}
                                                >
                                                    Save
                                                </Button>
                                            </InlineStack>
                                        </BlockStack>
                                    </Form>
                                </Card>)}
                        </BlockStack>
                    </Layout.Section>
                </Layout>
            </Page>
        </Frame>
    );
}
