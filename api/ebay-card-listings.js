import { createEbaySellerListingsHandler } from "./ebay-dcsports87-listings.js";

export default createEbaySellerListingsHandler({
  allowSellerOverride: true,
  allowGlobalSearch: true,
  maximumLimit: 200,
  requestRateLimit: 120
});
