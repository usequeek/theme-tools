---
'@usequeek/theme-check': minor
'@usequeek/theme-cli': minor
---

New rule `theme/template-copy`: a template's section copy must be true of any store in its business, because Queek publishes it onto new stores unchanged. It rejects copy that names the demo store, a place, a naira amount or a promise only the vendor can make (same-day, 30-day returns, free delivery, guarantees) a founding date ("since 2014"), or an email or phone number in the text. Testimonials and reviews are exempt. A section's copy no longer includes the demo store's email, phone, address, opening hours, coupon code or hotspot coordinates.

The business vocabulary gains `jewelry` (Fashion › Bags & Accessories › Jewelry, a new third level, `subcategories`) and `beverages` (Supermarket › Beverages).

New rule `theme/vendor-facts`: a vendor's tagline, address, phone, email or description must never fall back to the theme's own words (`vendor.address ?? 'Lagos, Nigeria'`); a store without one would show them as its own.
