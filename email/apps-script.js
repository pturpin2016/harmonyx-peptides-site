/**
 * HarmonyX daylight order emails
 *
 * Paste this at the TOP of the Apps Script bound to
 * HarmonyXPeptides MasterCatalog, then change the two htmlBody
 * values that send customer + owner mail to:
 *
 *   htmlBody: daylightCustomerHtml_(order)
 *   htmlBody: daylightInternalHtml_(order)
 *
 * Templates live on the website, so future design tweaks do not
 * require editing this file again.
 */

var DAYLIGHT_CUSTOMER_TPL = "https://harmonyxpeptides.com/email/order-customer.html";
var DAYLIGHT_INTERNAL_TPL = "https://harmonyxpeptides.com/email/order-internal.html";

function daylightCustomerHtml_(order) {
  return fillDaylightEmail_(
    UrlFetchApp.fetch(DAYLIGHT_CUSTOMER_TPL).getContentText(),
    order
  );
}

function daylightInternalHtml_(order) {
  return fillDaylightEmail_(
    UrlFetchApp.fetch(DAYLIGHT_INTERNAL_TPL).getContentText(),
    order
  );
}

function fillDaylightEmail_(html, order) {
  var c = (order && order.customer) || order || {};
  var totals = (order && order.totals) || {};
  var promo = (order && order.promo) || {};
  var fulfillment = (order && order.fulfillment) || {};
  var items = (order && order.items) || [];
  var addr = c.shippingAddress || null;

  var name = c.name || order.customerName || "";
  var email = c.email || order.customerEmail || "";
  var phone = c.phone || order.customerPhone || "";
  var notes = c.notes || order.notes || "";
  var orderId = order.orderId || order.order_id || order.id || "";

  var subtotal = Number(totals.subtotal || 0);
  var discount = Number(totals.discount || promo.discount || 0);
  var shipping = Number(
    totals.shippingFee != null ? totals.shippingFee : fulfillment.shippingFee || 0
  );
  var total = Number(totals.estimatedTotal || subtotal - discount + shipping);

  var fulfillLabel = fulfillment.label || fulfillment.method || "";
  if (fulfillment.method === "pickup" && !fulfillment.label) fulfillLabel = "Local pickup";
  if (fulfillment.method === "ship" && !fulfillment.label) fulfillLabel = "USPS Priority shipping";
  fulfillLabel = fulfillLabel + " - " + money_(shipping);

  var rows = "";
  for (var i = 0; i < items.length; i++) {
    var item = items[i] || {};
    var qty = Number(item.vialQuantity || item.qty || 1);
    var unit = item.unitPrice != null ? Number(item.unitPrice) : null;
    var line = unit == null ? "—" : money_(unit * qty);
    rows +=
      '<tr>' +
      '<td style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
      escape_(item.productName || item.name || "") +
      "</td>" +
      '<td align="center" style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
      qty +
      "</td>" +
      '<td align="right" style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
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

  var shippingLine =
    '<div><span style="color:#B08A3E;">Shipping / pickup:</span> ' +
    money_(shipping) +
    "</div>";

  var addressBlock = "";
  if (addr && (addr.address1 || addr.city)) {
    addressBlock =
      '<h2 style="margin:28px 0 10px 0;font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:400;color:#1A1814;">Ship to</h2>' +
      '<p style="margin:0;color:#6B6458;">' +
      [addr.address1, addr.address2, [addr.city, addr.state, addr.postalCode].filter(Boolean).join(", "), addr.country]
        .filter(Boolean)
        .map(escape_)
        .join("<br />") +
      "</p>";
  }

  var notesBlock = "";
  if (String(notes).trim()) {
    notesBlock =
      '<h2 style="margin:28px 0 10px 0;font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:400;color:#1A1814;">Notes</h2>' +
      '<p style="margin:0;color:#6B6458;">' +
      escape_(notes).replace(/\n/g, "<br />") +
      "</p>";
  }

  return html
    .replace(/\{\{NAME\}\}/g, escape_(name))
    .replace(/\{\{EMAIL\}\}/g, escape_(email))
    .replace(/\{\{PHONE\}\}/g, escape_(phone))
    .replace(/\{\{ORDER_ID\}\}/g, escape_(orderId))
    .replace(/\{\{ITEM_ROWS\}\}/g, rows)
    .replace(/\{\{FULFILLMENT\}\}/g, escape_(fulfillLabel))
    .replace(/\{\{SUBTOTAL\}\}/g, money_(subtotal))
    .replace(/\{\{DISCOUNT_LINE\}\}/g, discountLine)
    .replace(/\{\{SHIPPING_LINE\}\}/g, shippingLine)
    .replace(/\{\{TOTAL\}\}/g, money_(total))
    .replace(/\{\{ADDRESS_BLOCK\}\}/g, addressBlock)
    .replace(/\{\{NOTES_BLOCK\}\}/g, notesBlock);
}

function money_(n) {
  var v = Number(n || 0);
  return "$" + v.toFixed(2);
}

function escape_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """);
}
