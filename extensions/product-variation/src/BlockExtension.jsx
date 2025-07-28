import {
  reactExtension,
  useApi,
  Button,
  Box,
  AdminBlock,
  Link,
  Banner
} from '@shopify/ui-extensions-react/admin';
import { useEffect, useState } from 'react';

// The target used here must match the target used in the extension's toml file (./shopify.extension.toml)
const TARGET = 'admin.product-details.block.render';

export default reactExtension(TARGET, () => <App />);

function App() {
  const { data } = useApi(TARGET);
  const productId = data?.selected?.[0]?.id;
  const productLink = productId.split('/')
  const [collection, setCollection] = useState(null);

  const allowedCollections = ['engagement-rings', 'wedding-rings'];

  const shopifyFetch = async (query, variables = {}) => {
    const response = await fetch('shopify:admin/api/graphql.json', {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    });
    return response.json();
  };


  // ✅ Get product's collection Value once on ProductID load
  const fetchProductCollection = async (productId) => {
    if (!productId) return null;
    const productQuery = `
    query {
      product(id: "${productId}") {
        collections(first: 1) {
          nodes {
            handle
            id
          }
        }
      }
    }
  `;

    try {
      const result = await shopifyFetch(productQuery);
      const collectionHandle = result?.data?.product?.collections?.nodes?.[0]?.handle || "";

      return { collectionHandle };
    } catch (error) {
      console.error("Error fetching product metafields:", error);
      throw new Error("Unable to fetch product metafields");
    }
  };

  useEffect(() => {
    if (!productId) return;
    const loadMetafields = async () => {
      try {
        const { collectionHandle, collection_id } = await fetchProductCollection(productId);
        setCollection(collectionHandle);
      } catch (err) {
        console.error(err);
      }
    };

    loadMetafields();
  }, [productId]);

  return (
    <AdminBlock title="Product Variant">
      <Box padding="base">
        {allowedCollections.includes(collection) ? <Link to={`/app/product-variant/${productLink[productLink.length - 1]}`}>
          <Button variant="primary">
            Clik to Add or Edit Product Variant
          </Button>
        </Link>
          :
          <Banner status="info" title="Unsupported Collection">
            This product is not part of a supported collection. Please make sure the product
            belongs to "engagement-ring" or "wedding-ring".
          </Banner>
        }
      </Box>
    </AdminBlock>
  );
}