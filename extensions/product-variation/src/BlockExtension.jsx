import { useEffect, useState } from 'react';
import {
  reactExtension,
  useApi,
  BlockStack,
  AdminBlock,
  Button,
  InlineStack,
  Select,
  Text,
  Banner,
  ProgressIndicator,
  Link,
} from '@shopify/ui-extensions-react/admin';

// The target used here must match the target used in the extension's toml file (./shopify.extension.toml)
const TARGET = 'admin.product-details.block.render';

export default reactExtension(TARGET, () => <App />);

function App() {
  const { data } = useApi(TARGET);
  const productId = data?.selected?.[0]?.id;
  const productLink = productId.split('/')
  const [loading, setLoading] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [collectionHandle, setCollectionHandle] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [choicesMap, setChoicesMap] = useState({});
  const [formValues, setFormValues] = useState({});
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const shopifyFetch = async (query, variables = {}) => {
    const response = await fetch('shopify:admin/api/graphql.json', {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    });
    return response.json();
  };

  const getRequiredFields = (collectionHandle) => {
    const defaultFields = ["Group Name", "Style", "Metal"];
    if (collectionHandle === "engagement-rings") {
      return [...defaultFields, "Shape"];
    }
    return defaultFields;
  };


  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // 1. Get metafield definitions
        const defsQuery = `
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
            `;
        const defsRes = await shopifyFetch(defsQuery);
        const definitions = defsRes?.data?.metafieldDefinitions?.edges?.map(
          (edge) => edge.node
        );

        // 2. Get product metafields & collections
        const proQuery = `
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
            `;

        const variables = {
          id: productId,
        };

        const prodRes = await shopifyFetch(proQuery, variables);
        const metafields = prodRes.data?.product?.metafields?.nodes || [];
        const collection = prodRes.data?.product?.collections?.nodes?.[0];
        setCollectionHandle(collection?.handle || "");
        setCollectionId(collection?.id || "");

        // // 4. Prepare form initial values
        const neededFields = getRequiredFields(collection?.handle || "");

        const initial = neededFields.reduce((acc, label) => {
          acc[label] = "";
          return acc;
        }, {});

        metafields.forEach((mf) => {
          const label = Object.keys(initial).find(
            (k) => mf.key === k.toLowerCase().replace(/ /g, "_")
          );
          if (label) initial[label] = mf.value;
        });

        setFormValues(initial);

        // 5. Build choicesMap
        const selectedDefs = definitions.filter((def) =>
          neededFields.includes(def.name)
        );

        const choices = {};
        selectedDefs.forEach((def) => {
          const choiceVal = def.validations.find((v) => v.name === "choices");
          choices[def.name] = choiceVal ? JSON.parse(choiceVal.value) : [];
        });

        setChoicesMap(choices);
      } catch (err) {
        console.error("Error fetching product data", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

  }, [productId]);


  const handleChange = (field) => (value) => {
    setSuccessMessage('')
    setErrorMessage('')
    setFormValues((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSave = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    setLoadingSubmit(true) // Start loader

    try {
      const requiredFields = getRequiredFields(collectionHandle);

      // ❌ Check for missing required fields
      const missingFields = requiredFields.filter((field) => !formValues[field]);

      if (missingFields.length > 0) {
        setErrorMessage(`Please fill in all fields: ${missingFields.join(', ')}`);
        return;
      }

      // Check for duplicate product
      const queryFilters = requiredFields
        .map((key) => `metafields.custom.${key.toLowerCase().replace(/\s/g, "_")}:'${formValues[key]}'`)
        .join(" AND ");

      // 2. Get product metafields & collections
      const dupQuery = `
        query CheckDuplicateProduct($query: String!, $collectionId: ID!) {
          products(first: 100, query: $query) {
            edges {
              node {
                id
                inCollection(id: $collectionId)
              }
            }
          }
        }`;

      const variables = {
        query: queryFilters,
        collectionId,
      };

      const dupRes = await shopifyFetch(dupQuery, variables);

      const isDuplicate = dupRes.data.products.edges.some(
        (edge) => edge.node.inCollection
      );

      if (isDuplicate) {
        setErrorMessage("A product with the same variation already exists.");
        return;
      }

      // 📝 Prepare metafields to save
      const metafields = requiredFields.map((label) => ({
        ownerId: productId,
        namespace: "custom",
        key: label.toLowerCase().replace(/\s/g, "_"),
        type: "single_line_text_field",
        value: formValues[label],
      }));


      const saveMetafieldsMutation = `
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
        }`;

      const saveMetafieldsRes = await shopifyFetch(saveMetafieldsMutation, {
        metafields,
      });

      const errors = saveMetafieldsRes?.data?.metafieldsSet?.userErrors || [];

      if (errors.length > 0) {
        setErrorMessage(errors.map((e) => e.message).join(", "));
        return;
      }

      setSuccessMessage("Product variation saved successfully.");
    } catch (err) {
      console.error("Save error:", err);
      const fallbackMsg = err?.message || "Something went wrong. Please try again.";
      setErrorMessage(fallbackMsg);
    } finally {
      setLoadingSubmit(false); // Stop loader
    }
  };

  useEffect(() => {
    if (successMessage) {
      const timeout = setTimeout(() => {
        setSuccessMessage("");
      }, 5000);

      return () => clearTimeout(timeout);
    }
  }, [successMessage]);


  return (
    <AdminBlock title="Add Product Metafield">
      <BlockStack rowGap="large">
        {loading ? <BlockStack gap="tight" wrap={false} inlineAlignment="center" blockAlignment="center"><ProgressIndicator size="small-100" /></BlockStack> : collectionHandle ? <>
          {errorMessage && (
            <BlockStack gap="400" blockGap="base">
              <Banner tone="critical" title="Error">
                {errorMessage}
              </Banner>
            </BlockStack>
          )}

          {successMessage && (
            <BlockStack gap="400" blockGap="base">
              <Banner tone="success" title="Success">
                {successMessage}
              </Banner>
            </BlockStack>
          )}
          <BlockStack gap="base">
            {Object.entries(choicesMap).map(([label, options]) => (
              <InlineStack key={label} gap="base" wrap={false} blockAlignment="center">
                <BlockStack
                  spacing="none"
                  shrink
                  inlineAlignment="start"
                  blockSize="30%"
                  inlineSize="30%"
                >
                  <Text size="base" emphasis="bold">
                    {label}
                  </Text>
                </BlockStack>
                <BlockStack
                  spacing="none"
                  grow
                  blockSize="70%"
                  inlineSize="70%"
                >
                  <Select
                    label=""
                    value={formValues[label] || ''}
                    options={[
                      { label: `Select ${label}`, value: '' },
                      ...options.map((o) => ({ label: o, value: o })),
                    ]}
                    onChange={handleChange(label)}
                  />
                </BlockStack>
              </InlineStack>
            ))}
          </BlockStack>
          <BlockStack inlineAlignment='center' blockAlignment='center'>
            <InlineStack gap="base" wrap={false} inlineAlignment='center' blockAlignment="center">
              {loadingSubmit ? <ProgressIndicator size="small-200" /> :
                <Button kind="primary" onPress={handleSave}>
                  Save
                </Button>}
              {/* <Link to={`/app/product-variant/${productLink[productLink.length - 1]}`}> */}
                <Button variant="primary">
                  Add or Edit Product Description
                </Button>
              {/* </Link> */}
            </InlineStack>
          </BlockStack>
        </> : <BlockStack inlineAlignment='center' blockAlignment='center'>
          {/* <Link to={`/app/product-variant/${productLink[productLink.length - 1]}`}> */}
            <Button variant="primary">
              Add or Edit Product Description
            </Button>
          {/* </Link> */}
        </BlockStack>}
      </BlockStack>
    </AdminBlock>
  );
}