/**
 * HarmonyX daylight order emails — paste this WHOLE file at the TOP
 * of the Apps Script on HarmonyXPeptides MasterCatalog.
 *
 * Then find htmlBody (two places) and change them to:
 *   htmlBody: daylightCustomerHtml_(order)
 *   htmlBody: daylightInternalHtml_(order, invoiceUrl, dashboardUrl)
 *
 * If the script uses a different variable than "order", keep that name.
 * Save, then send one test order.
 *
 * No UrlFetchApp. No extra Google permissions.
 */

function daylightCustomerHtml_(order) {
  return fillDaylightEmail_(customerTpl_(), order, "", "");
}

function daylightInternalHtml_(order, invoiceUrl, dashboardUrl) {
  return fillDaylightEmail_(internalTpl_(), order, invoiceUrl, dashboardUrl);
}

function fillDaylightEmail_(html, order, invoiceUrl, dashboardUrl) {
  order = order || {};
  var c = order.customer || order || {};
  var totals = order.totals || {};
  var promo = order.promo || {};
  var fulfillment = order.fulfillment || {};
  var items = order.items || [];
  var addr = c.shippingAddress || order.shippingAddress || null;

  var name = c.name || order.customerName || "";
  var email = c.email || order.customerEmail || "";
  var phone = c.phone || order.customerPhone || "";
  var notes = c.notes || order.notes || order.customerNotes || "";
  var orderId = order.orderId || order.order_id || order.id || "";
  var availability = order.availability || order.stockLabel || "";
  var when = order.dateLabel || order.date || "";

  invoiceUrl = invoiceUrl || order.invoiceUrl || order.invoiceLink || "";
  dashboardUrl = dashboardUrl || order.dashboardUrl || order.trackerUrl || "";

  var subtotal = Number(totals.subtotal != null ? totals.subtotal : order.subtotal || 0);
  var discount = Number(totals.discount != null ? totals.discount : promo.discount || 0);
  var shipping = Number(
    totals.shippingFee != null ? totals.shippingFee : fulfillment.shippingFee != null ? fulfillment.shippingFee : 0
  );
  var total = Number(totals.estimatedTotal != null ? totals.estimatedTotal : subtotal - discount + shipping);
  var vialCount = 0;

  var fulfillLabel = fulfillment.label || fulfillment.method || order.fulfillmentLabel || "";
  if (!fulfillLabel && fulfillment.method === "pickup") fulfillLabel = "Local pickup";
  if (!fulfillLabel && fulfillment.method === "ship") fulfillLabel = "USPS Priority shipping";
  if (!fulfillLabel) fulfillLabel = "Local pickup";

  var itemRows = "";
  var ownerRows = "";
  for (var i = 0; i < items.length; i++) {
    var item = items[i] || {};
    var qty = Number(item.vialQuantity || item.qty || item.vials || 1);
    vialCount += qty;
    var unit = item.unitPrice != null ? Number(item.unitPrice) : item.price != null ? Number(item.price) : null;
    var line = unit == null ? "—" : money_(unit * qty);
    var unitLabel = unit == null ? "—" : money_(unit);
    var pname = escape_(item.productName || item.name || "");
    var category = escape_(item.category || "");
    itemRows +=
      '<tr><td style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
      pname +
      '</td><td align="center" style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
      qty +
      '</td><td align="right" style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
      line +
      "</td></tr>";
    ownerRows +=
      '<tr><td style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);font-family:Arial,Helvetica,sans-serif;color:#1A1814;"><div style="font-size:14px;">' +
      pname +
      '</div>' +
      (category ? '<div style="font-size:12px;color:#6B6458;margin-top:3px;">' + category + "</div>" : "") +
      '</td><td align="center" style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
      qty +
      '</td><td align="center" style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
      unitLabel +
      '</td><td align="right" style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
      line +
      "</td></tr>";
  }

  var discountLine = "";
  if (discount > 0) {
    var code = promo.code ? " (" + promo.code + ")" : "";
    discountLine =
      '<div><span style="color:#B08A3E;">Promo' +
      escape_(code) +
      ":</span> −" +
      money_(discount) +
      "</div>";
  }

  var invoiceBlock = "";
  if (invoiceUrl) {
    invoiceBlock =
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0 0;background:#F7F3EC;border-radius:12px;"><tr><td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;">' +
      '<div style="font-size:16px;color:#1A1814;margin-bottom:10px;"><strong>Prefilled editable invoice</strong></div>' +
      '<a href="' +
      escape_(invoiceUrl) +
      '" style="display:inline-block;background:#B08A3E;color:#FFFCF7;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;">Open editable invoice</a>' +
      '<div style="margin-top:10px;font-size:12px;color:#6B6458;">Review and edit this private invoice before sending it to the customer.</div>' +
      "</td></tr></table>";
  }

  var dashboardBlock = "";
  if (dashboardUrl) {
    dashboardBlock =
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 0 0;background:#F7F3EC;border-radius:12px;"><tr><td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;">' +
      '<div style="font-size:16px;color:#1A1814;margin-bottom:10px;"><strong>Business tracker updated</strong></div>' +
      '<a href="' +
      escape_(dashboardUrl) +
      '" style="display:inline-block;background:#B08A3E;color:#FFFCF7;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;">Open business dashboard</a>' +
      "</td></tr></table>";
  }

  var addressBlock = "";
  if (addr && (addr.address1 || addr.city)) {
    addressBlock =
      heading_("Ship to") +
      '<p style="margin:0;color:#6B6458;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;">' +
      [addr.address1, addr.address2, [addr.city, addr.state, addr.postalCode].filter(Boolean).join(", "), addr.country]
        .filter(Boolean)
        .map(escape_)
        .join("<br />") +
      "</p>";
  }

  var notesBlock = "";
  if (String(notes).trim()) {
    notesBlock =
      heading_("Notes") +
      '<p style="margin:0;color:#6B6458;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;">' +
      escape_(notes).replace(/\n/g, "<br />") +
      "</p>";
  }

  return html
    .replace(/\{\{NAME\}\}/g, escape_(name))
    .replace(/\{\{EMAIL\}\}/g, escape_(email))
    .replace(/\{\{PHONE\}\}/g, escape_(phone))
    .replace(/\{\{ORDER_ID\}\}/g, escape_(orderId))
    .replace(/\{\{AVAILABILITY\}\}/g, escape_(availability || "—"))
    .replace(/\{\{DATE\}\}/g, escape_(when || ""))
    .replace(/\{\{ITEM_ROWS\}\}/g, itemRows)
    .replace(/\{\{OWNER_ROWS\}\}/g, ownerRows)
    .replace(/\{\{FULFILLMENT\}\}/g, escape_(fulfillLabel))
    .replace(/\{\{SUBTOTAL\}\}/g, money_(subtotal))
    .replace(/\{\{DISCOUNT_LINE\}\}/g, discountLine)
    .replace(/\{\{SHIPPING\}\}/g, money_(shipping))
    .replace(/\{\{TOTAL\}\}/g, money_(total))
    .replace(/\{\{VIALS\}\}/g, String(vialCount || totals.vialCount || items.length || 0))
    .replace(/\{\{INVOICE_BLOCK\}\}/g, invoiceBlock)
    .replace(/\{\{DASHBOARD_BLOCK\}\}/g, dashboardBlock)
    .replace(/\{\{ADDRESS_BLOCK\}\}/g, addressBlock)
    .replace(/\{\{NOTES_BLOCK\}\}/g, notesBlock);
}

function heading_(text) {
  return (
    '<h2 style="margin:28px 0 10px 0;font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:400;color:#1A1814;">' +
    text +
    "</h2>"
  );
}

function money_(n) {
  return "$" + Number(n || 0).toFixed(2);
}

function escape_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """);
}

function wrap_(inner) {
  return (
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F7F3EC;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3EC;padding:32px 12px;"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFCF7;border:1px solid rgba(26,24,20,0.10);border-radius:18px;">' +
    inner +
    "</table></td></tr></table></body></html>"
  );
}

function brandHead_(title) {
  return (
    '<tr><td style="padding:36px 40px 24px 40px;border-bottom:1px solid rgba(26,24,20,0.08);">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:28px;line-height:1;color:#1A1814;">Harmony<span style="color:#B08A3E;">X</span></div>' +
    '<div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.32em;color:#B08A3E;">PEPTIDES</div>' +
    '<h1 style="margin:22px 0 0 0;font-family:Georgia,\'Times New Roman\',serif;font-size:34px;line-height:1.15;font-weight:400;color:#1A1814;">' +
    title +
    "</h1></td></tr>"
  );
}

function customerTpl_() {
  return wrap_(
    brandHead_("Request received") +
      '<tr><td style="padding:32px 40px 8px 40px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1A1814;">' +
      "<p style=\"margin:0 0 14px 0;\">Hello {{NAME}},</p>" +
      '<p style="margin:0 0 22px 0;color:#6B6458;">We received your HarmonyX order request.</p>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3EC;border-left:3px solid #B08A3E;"><tr><td style="padding:14px 18px;font-size:14px;color:#1A1814;"><strong>Order number:</strong> {{ORDER_ID}}</td></tr></table>' +
      heading_("Requested products") +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>' +
      '<td style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);font-size:11px;letter-spacing:0.16em;color:#B08A3E;">PRODUCT</td>' +
      '<td align="center" style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);font-size:11px;letter-spacing:0.16em;color:#B08A3E;">QTY</td>' +
      '<td align="right" style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);font-size:11px;letter-spacing:0.16em;color:#B08A3E;">LINE TOTAL</td>' +
      "</tr>{{ITEM_ROWS}}</table>" +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0 0;background:#F7F3EC;border-radius:12px;"><tr><td style="padding:18px 20px;font-size:14px;line-height:1.7;">' +
      '<div><span style="color:#B08A3E;">Fulfillment:</span> {{FULFILLMENT}} — {{SHIPPING}}</div>' +
      '<div><span style="color:#B08A3E;">Merchandise subtotal:</span> {{SUBTOTAL}}</div>{{DISCOUNT_LINE}}' +
      '<div style="margin-top:8px;font-size:16px;"><strong>Estimated total: {{TOTAL}}</strong></div>' +
      "</td></tr></table>{{ADDRESS_BLOCK}}{{NOTES_BLOCK}}" +
      '<p style="margin:28px 0 12px 0;color:#6B6458;">No payment was collected online. This is an order request, not a completed purchase. We will contact you regarding availability, timing, and next steps.</p>' +
      '<p style="margin:0 0 12px 0;color:#6B6458;">We will follow up by email or phone, usually within 24 hours.</p>' +
      '<p style="margin:0 0 8px 0;color:#6B6458;">Questions? Reply to this email or contact <a href="mailto:research@harmony-x.com" style="color:#B08A3E;text-decoration:none;">research@harmony-x.com</a>.</p>' +
      '</td></tr><tr><td style="padding:8px 40px 36px 40px;font-size:12px;line-height:1.6;color:#9A9286;">Products supplied by Purity Collective.<br />Research-use products only. Not for human consumption.</td></tr>'
  );
}

function internalTpl_() {
  return wrap_(
    brandHead_("New order request") +
      '<tr><td style="padding:22px 40px 8px 40px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1A1814;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3EC;border-left:3px solid #B08A3E;"><tr><td style="padding:14px 18px;font-size:14px;"><strong>{{ORDER_ID}}</strong></td></tr></table>' +
      heading_("Customer") +
      "<p style=\"margin:0 0 4px 0;\"><strong>Name:</strong> {{NAME}}</p>" +
      "<p style=\"margin:0 0 4px 0;\"><strong>Email:</strong> {{EMAIL}}</p>" +
      "<p style=\"margin:0 0 4px 0;\"><strong>Phone:</strong> {{PHONE}}</p>" +
      "<p style=\"margin:0 0 4px 0;\"><strong>Availability:</strong> {{AVAILABILITY}}</p>" +
      "<p style=\"margin:0 0 8px 0;\"><strong>Date:</strong> {{DATE}}</p>" +
      "{{INVOICE_BLOCK}}{{DASHBOARD_BLOCK}}" +
      heading_("Requested products") +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>' +
      '<td style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);font-size:11px;letter-spacing:0.16em;color:#B08A3E;">PRODUCT</td>' +
      '<td align="center" style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);font-size:11px;letter-spacing:0.16em;color:#B08A3E;">VIALS</td>' +
      '<td align="center" style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);font-size:11px;letter-spacing:0.16em;color:#B08A3E;">PER VIAL</td>' +
      '<td align="right" style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);font-size:11px;letter-spacing:0.16em;color:#B08A3E;">LINE TOTAL</td>' +
      "</tr>{{OWNER_ROWS}}</table>" +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0 0;background:#F7F3EC;border-radius:12px;"><tr><td style="padding:18px 20px;font-size:14px;line-height:1.7;">' +
      "<div><strong>Total vials:</strong> {{VIALS}}</div>" +
      "<div><strong>Subtotal:</strong> {{SUBTOTAL}}</div>" +
      "<div><strong>Fulfillment:</strong> {{FULFILLMENT}}</div>" +
      "<div><strong>Shipping:</strong> {{SHIPPING}}</div>{{DISCOUNT_LINE}}" +
      '<div style="margin-top:8px;font-size:16px;"><strong>Estimated total: {{TOTAL}}</strong></div>' +
      "</td></tr></table>{{ADDRESS_BLOCK}}{{NOTES_BLOCK}}" +
      '<p style="margin:28px 0 0 0;color:#6B6458;">A draft invoice was created in Drive. No payment was collected on the website.</p>' +
      '</td></tr><tr><td style="padding:24px 40px 36px 40px;font-size:12px;line-height:1.6;color:#9A9286;">HarmonyX Peptides · research@harmony-x.com · harmonyxpeptides.com</td></tr>'
  );
}
