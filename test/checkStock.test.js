import test from "node:test";
import assert from "node:assert/strict";
import { analyzeStockHtml, STATUS } from "../src/checkStock.js";

test("parses Nintendo Magento product JSON as out of stock", () => {
  const html = magentoHtml({
    is_available: false,
    is_salable: "",
    name: "Nintendo Switch 2"
  });

  const result = analyzeStockHtml(html);

  assert.equal(result.status, STATUS.OUT_OF_STOCK);
  assert.equal(result.source, "magento-product-json");
  assert.match(result.evidence, /is_available=false/);
});

test("parses Nintendo Magento product JSON as in stock", () => {
  const html = magentoHtml({
    is_available: true,
    is_salable: "1",
    name: "Nintendo Switch 2",
    price_info: { final_price: 648000 }
  });

  const result = analyzeStockHtml(html);

  assert.equal(result.status, STATUS.IN_STOCK);
  assert.equal(result.price, "KRW 648,000");
});

test("falls back to page text sold-out markers", () => {
  const html = `
    <div class="product-info-stock-sku">
      <div class="stock unavailable"><span>품절</span></div>
    </div>
  `;

  const result = analyzeStockHtml(html);

  assert.equal(result.status, STATUS.OUT_OF_STOCK);
  assert.equal(result.source, "page-text");
});

test("falls back to page text in-stock markers", () => {
  const html = `
    <div class="product-info-stock-sku">
      <div class="stock available"><span>In Stock</span></div>
    </div>
    <button>장바구니에 추가</button>
  `;

  const result = analyzeStockHtml(html);

  assert.equal(result.status, STATUS.IN_STOCK);
});

function magentoHtml(product) {
  return `
    <script type="text/x-magento-init">
      ${JSON.stringify({
        "*": {
          "Magento_Catalog/js/product/view/provider": {
            data: {
              items: {
                13563: product
              }
            }
          }
        }
      })}
    </script>
  `;
}
