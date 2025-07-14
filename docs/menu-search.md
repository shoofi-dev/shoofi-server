# Menu Search API

## Overview

This API allows searching for products by name or description across all stores (databases) and returns a list of stores (restaurants) that offer matching products.

---

## Endpoint

**POST** `/api/menu/search`

### Request Body

```json
{
  "query": "pizza"
}
```

### Response

```json
{
  "stores": [
    {
      "store": { /* store object */ },
      "products": [
        { /* matching product object */ }
      ]
    }
  ]
}
```

---

## How It Works

- The backend queries the `shoofi` database's `stores` collection to get all stores and their `appName`.
- For each store, it searches the `products` collection in that store's database using a text index for efficient search.
- Only stores with matching products are returned.
- The search is performed in parallel for performance.

---

## Best Practices

### Indexing
- Ensure a text index exists on each store's `products` collection for fast search:
  ```js
  db.products.createIndex({ nameAR: "text", nameHE: "text", descriptionAR: "text", descriptionHE: "text" })
  ```

### Debounce
- Debounce search input on the frontend to avoid excessive API calls (e.g., 300ms delay).

### Performance
- Uses Promise.all for parallel DB queries.
- Limits the number of products returned per store (default: 10).
- Optionally, cache popular search results.
- Consider paginating stores/products in the response for large datasets.

### Scalability
- For very large numbers of stores, consider a central search index (e.g., ElasticSearch) in the future.

---

## Example

**Request:**
```bash
curl -X POST http://localhost:3000/api/menu/search -H 'Content-Type: application/json' -d '{ "query": "pizza" }'
```

**Response:**
```json
{
  "stores": [
    {
      "store": { "_id": "...", "name": "Pizza Place", ... },
      "products": [
        { "_id": "...", "nameAR": "بيتزا", ... }
      ]
    }
  ]
}
``` 