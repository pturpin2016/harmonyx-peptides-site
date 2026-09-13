// Harmony-X Backend v5.6 - Daylight emails + invoice
/**
 * Google Apps Script backend for the Harmony-X Cloudflare Pages site.
 * Customer-facing catalog data is read from the "Master Catalog" sheet.
 */

const CONFIG = Object.freeze({
  BUSINESS_NAME: 'Harmony-X',
  OWNER_EMAIL: 'research@harmony-x.com',
  ORDER_NOTIFICATION_EMAILS:
    'research@harmony-x.com,thabbyturpin2@gmail.com',
  SPREADSHEET_ID: '',
  CATALOG_SHEET_NAME: 'Master Catalog',
  ORDER_LOG_SPREADSHEET_ID: '',
  ORDER_LOG_SHEET_NAME: 'Orders',
  TIME_ZONE: Session.getScriptTimeZone() || 'America/Los_Angeles',
  CATALOG_CACHE_SECONDS: 300,
  MAX_VIAL_QUANTITY: 100,
  SEND_CUSTOMER_CONFIRMATION: true,
  CREATE_DRAFT_INVOICES: true,
  ENABLE_BUSINESS_TRACKER: true,
  INVOICE_FOLDER_NAME: 'HarmonyX Draft Invoices',
  INVOICE_TEMPLATE_NAME: '_TEMPLATE - HarmonyX Draft Invoice DAYLIGHT',
  INVOICE_BASE_ITEM_ROWS: 20,
  PAYMENT_PHONE: '360-910-6274',
  DEFAULT_PAYMENT_METHOD: 'Zelle'
});

const INVOICE_AUTOMATION = Object.freeze({
  FOLDER_PROPERTY: 'HARMONYX_INVOICE_FOLDER_ID',
  TEMPLATE_PROPERTY: 'HARMONYX_INVOICE_TEMPLATE_ID',
  DAYLIGHT_TEMPLATE_ID: '1dMCrkk4Fu7v8NzAnLkfUWkD3FCPwPsCgteKOkjtmnDA',
  SHEET_NAME: 'Invoice',
  ITEM_START_ROW: 16,
  PAYMENT_START_ROW: 38
});

const BUSINESS_TRACKER = Object.freeze({
  DASHBOARD_SHEET: 'Business Dashboard',
  ORDERS_SHEET: 'Orders',
  ITEMS_SHEET: 'Order Items',
  INVENTORY_SHEET: 'Inventory',
  EXPENSES_SHEET: 'Expenses',
  CUSTOMERS_SHEET: 'Customers',
  SETTINGS_SHEET: 'Business Settings',
  HEADER_ROW: 4,
  DATA_START_ROW: 5,
  DEFAULT_SINGLE_COST_WEIGHT: 0.2,
  DEFAULT_FIVE_PACK_COST_WEIGHT: 0.4,
  DEFAULT_TEN_PACK_COST_WEIGHT: 0.4,
  DEFAULT_LOW_STOCK_LEVEL: 5
});

const CATALOG_CACHE_KEY =
  'harmonyx_catalog_retail_v39_research_guides';

// Authoritative promo code table. Mirrors HX_PROMO_CODES in index.html —
// keep the two in sync when adding or changing codes. The client sends
// which code it thinks applies, but the discount percentage always comes
// from this table, never from the client payload, so a tampered request
// can't grant an unauthorized discount.
const PROMO_CODES = Object.freeze({
  WELCOME10: Object.freeze({ percent: 10, label: '10% off' }),
  HARMONY15: Object.freeze({ percent: 15, label: '15% off' }),
  VIP20: Object.freeze({ percent: 20, label: '20% off' }),
  ELITE25: Object.freeze({ percent: 25, label: 'Elite — 25% off' }),
  PLATINUM30: Object.freeze({ percent: 30, label: 'Platinum — 30% off' }),
  LABORDAY30: Object.freeze({ percent: 30, label: 'Labor Day — 30% off' })
});


/**
 * Re-derives the promo discount server-side from PROMO_CODES. Only the
 * promo *code* from the client is trusted enough to look up — the percent,
 * label, and discount amount the client sent are ignored entirely.
 */
function resolvePromoCode_(promoInput, subtotal) {
  const rawCode = String(
    (promoInput && promoInput.code) || ''
  ).trim().toUpperCase().replace(/\s+/g, '');

  if (!rawCode) {
    return { code: '', label: '', percent: 0, discount: 0 };
  }

  const found = PROMO_CODES[rawCode];

  if (!found) {
    return { code: '', label: '', percent: 0, discount: 0 };
  }

  const discount = roundMoney_(
    subtotal * (found.percent / 100)
  );

  return {
    code: rawCode,
    label: found.label,
    percent: found.percent,
    discount
  };
}


function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'catalog') {
    try {
      return jsonResponse_({
        success: true,
        ...getCatalog()
      });
    } catch (error) {
      return jsonResponse_({
        success: false,
        error: getErrorMessage_(error, 'Unable to load the catalog.')
      });
    }
  }

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.BUSINESS_NAME + ' - Research Catalog')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


function doPost(e) {
  try {
    const payload = JSON.parse(
      e && e.postData && e.postData.contents
        ? e.postData.contents
        : '{}'
    );

    if (payload && payload.type === 'contact') {
      return jsonResponse_(handleContact_(payload));
    }

    return jsonResponse_(submitOrder(payload));
  } catch (error) {
    const message = getErrorMessage_(
      error,
      'The request could not be submitted.'
    );

    return jsonResponse_({
      success: false,
      message,
      error: message
    });
  }
}


function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * Returns only customer-facing catalog fields.
 * Private wholesale and bulk-cost columns are never returned.
 */
function getCatalog() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CATALOG_CACHE_KEY);

  if (cached) {
    return JSON.parse(cached);
  }

  const sheet = getCatalogSheet_();
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    throw new Error(
      'The Master Catalog sheet does not contain any products.'
    );
  }

  const headers = values[0].map(normalizeHeader_);
  const columns = getRequiredColumnMap_(headers);

  const products = values.slice(1)
    .filter(row => String(row[columns.product] || '').trim())
    .map((row, index) => ({
      id: createProductId_(
        String(row[columns.product]),
        index + 2
      ),
      name: cleanText_(row[columns.product], 150),
      category:
        cleanText_(row[columns.category], 100) || 'Other',
      description:
        cleanText_(row[columns.description], 500),
      productDetails: columns.productDetails >= 0
        ? cleanText_(row[columns.productDetails], 5000)
        : '',
      highlights: columns.highlights >= 0
        ? cleanText_(row[columns.highlights], 2000)
        : '',
      researchGuideUrl: columns.researchGuideUrl >= 0
        ? cleanUrl_(row[columns.researchGuideUrl])
        : '',
      featured: toBoolean_(row[columns.featured]),
      popularRank: columns.popularRank >= 0
        ? toRank_(row[columns.popularRank])
        : null,
      retailPrice: toMoney_(row[columns.retail]),
      localStock: /^yes$/i.test(
        String(row[columns.localStock] || '').trim()
      )
    }))
    .filter(product => product.name);

  const categories = [
    ...new Set(products.map(product => product.category))
  ].sort((a, b) => a.localeCompare(b));

  const response = {
    businessName: CONFIG.BUSINESS_NAME,
    supplierName: 'Purity Collective',
    products,
    categories,
    catalogUpdated: Utilities.formatDate(
      new Date(),
      CONFIG.TIME_ZONE,
      "MMM d, yyyy 'at' h:mm a"
    )
  };

  cache.put(
    CATALOG_CACHE_KEY,
    JSON.stringify(response),
    CONFIG.CATALOG_CACHE_SECONDS
  );

  return response;
}


/**
 * Receives product names and vial quantities only.
 * Every product and price is verified against the current catalog.
 */
function submitOrder(payload) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(15000);

    const fulfillment = validateFulfillment_(
      payload && payload.fulfillment,
      payload && payload.customer
    );
    const customer = validateCustomer_(
      payload && payload.customer,
      fulfillment
    );
    const requestedItems = validateRequestedItems_(
      payload && payload.items
    );

    const catalog = getCatalog();
    const internalCostMap = getInternalCostMap_();
    const productMap = new Map(
      catalog.products.map(product => [
        product.name.toLowerCase(),
        product
      ])
    );

    const verifiedItems = requestedItems.map(item => {
      const product = productMap.get(
        item.productName.toLowerCase()
      );

      if (!product) {
        throw new Error(
          'A selected product is no longer available: ' +
          item.productName
        );
      }

      const hasListedPrice = product.retailPrice !== null;
      const estimatedUnitCost = internalCostMap.has(
        product.name.toLowerCase()
      )
        ? internalCostMap.get(product.name.toLowerCase())
        : null;
      const lineTotal = hasListedPrice
        ? roundMoney_(
            product.retailPrice * item.vialQuantity
          )
        : null;
      const estimatedLineCost = estimatedUnitCost === null
        ? null
        : roundMoney_(
            estimatedUnitCost * item.vialQuantity
          );

      return {
        productName: product.name,
        category: product.category,
        vialQuantity: item.vialQuantity,
        pricePerVial: hasListedPrice
          ? roundMoney_(product.retailPrice)
          : null,
        lineTotal,
        pricePending: !hasListedPrice,
        localStock: product.localStock,
        estimatedUnitCost,
        estimatedLineCost,
        estimatedGrossProfit:
          lineTotal === null || estimatedLineCost === null
            ? null
            : roundMoney_(lineTotal - estimatedLineCost)
      };
    });

    const subtotal = roundMoney_(
      verifiedItems.reduce(
        (sum, item) =>
          sum + (item.lineTotal === null ? 0 : item.lineTotal),
        0
      )
    );

    const hasPricePendingItems =
      verifiedItems.some(item => item.pricePending);

    const totalVials = verifiedItems.reduce(
      (sum, item) => sum + item.vialQuantity,
      0
    );

    const localItems =
      verifiedItems.filter(item => item.localStock);
    const specialOrderItems =
      verifiedItems.filter(item => !item.localStock);

    const availabilitySummary =
      localItems.length && specialOrderItems.length
        ? 'Mixed order: local inventory and special-order products'
        : localItems.length
          ? 'Local inventory'
          : 'Special-order products';

    const promo = resolvePromoCode_(payload && payload.promo, subtotal);

    const estimatedTotal = roundMoney_(
      subtotal - promo.discount + fulfillment.shippingFee
    );

    const order = {
      orderId: generateOrderId_(),
      timestamp: new Date(),
      customer,
      fulfillment,
      availabilitySummary,
      localItemCount: localItems.length,
      specialOrderItemCount: specialOrderItems.length,
      items: verifiedItems,
      subtotal,
      promoCode: promo.code,
      promoLabel: promo.label,
      promoPercent: promo.percent,
      discount: promo.discount,
      estimatedTotal,
      totalVials,
      hasPricePendingItems
    };

    if (CONFIG.CREATE_DRAFT_INVOICES) {
      try {
        const draftInvoice = createDraftInvoice_(order);
        order.draftInvoiceId = draftInvoice.id;
        order.draftInvoiceName = draftInvoice.name;
        order.draftInvoiceUrl = draftInvoice.url;
      } catch (invoiceError) {
        order.draftInvoiceError = getErrorMessage_(
          invoiceError,
          'The draft invoice could not be created.'
        );

        console.error(
          'Draft invoice creation failed: ' +
          order.draftInvoiceError
        );
      }
    }

    if (CONFIG.ENABLE_BUSINESS_TRACKER) {
      try {
        logOrderToBusinessTracker_(order);
      } catch (trackerError) {
        order.businessTrackerError = getErrorMessage_(
          trackerError,
          'The business tracker could not be updated.'
        );

        console.error(
          'Business tracker update failed: ' +
          order.businessTrackerError
        );
      }
    }

    sendOwnerOrderEmail_(order);

    if (CONFIG.ORDER_LOG_SPREADSHEET_ID) {
      try {
        logOrderToSeparateSpreadsheet_(order);
      } catch (loggingError) {
        console.error(
          'Optional order logging failed: ' +
          loggingError.message
        );
      }
    }

    let confirmationEmailSent = false;

    if (CONFIG.SEND_CUSTOMER_CONFIRMATION) {
      try {
        sendCustomerConfirmation_(order);
        confirmationEmailSent = true;
      } catch (confirmationError) {
        console.error(
          'Customer confirmation failed: ' +
          confirmationError.message
        );
      }
    }

    return {
      success: true,
      orderId: order.orderId,
      customerName: order.customer.name,
      customerEmail: order.customer.email,
      subtotal: order.subtotal,
      promoCode: order.promoCode,
      promoLabel: order.promoLabel,
      discount: order.discount,
      estimatedTotal: order.estimatedTotal,
      draftInvoiceCreated: Boolean(order.draftInvoiceUrl),
      confirmationEmailSent,
      message:
        'Your order request has been received. ' +
        'No payment was collected online.'
    };
  } catch (error) {
    console.error(error);
    throw new Error(
      getErrorMessage_(
        error,
        'The order request could not be submitted.'
      )
    );
  } finally {
    try {
      lock.releaseLock();
    } catch (ignore) {}
  }
}


function clearCatalogCache() {
  const cache = CacheService.getScriptCache();

  [
    'harmonyx_catalog_retail_v2',
    'harmonyx_catalog_retail_v35_product_details',
    'harmonyx_catalog_retail_v38_highlights',
    CATALOG_CACHE_KEY
  ].forEach(key => cache.remove(key));

  return 'Harmony-X catalog cache cleared.';
}


/**
 * Run this function once from the Apps Script editor before deploying v5.4.
 * It creates the private Drive folder and reusable invoice template, then
 * stores both IDs in Script Properties. Running it again is safe.
 */
function setupInvoiceAutomation() {
  const folder = getOrCreateInvoiceFolder_();
  const templateFile = getOrCreateInvoiceTemplate_(folder);

  return (
    'Invoice automation is ready. Folder: ' +
    folder.getUrl() +
    ' | Template: ' +
    templateFile.getUrl()
  );
}


function getOrCreateInvoiceFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const savedFolderId = properties.getProperty(
    INVOICE_AUTOMATION.FOLDER_PROPERTY
  );

  if (savedFolderId) {
    try {
      return DriveApp.getFolderById(savedFolderId);
    } catch (ignore) {
      properties.deleteProperty(
        INVOICE_AUTOMATION.FOLDER_PROPERTY
      );
    }
  }

  const matches = DriveApp.getFoldersByName(
    CONFIG.INVOICE_FOLDER_NAME
  );
  const folder = matches.hasNext()
    ? matches.next()
    : DriveApp.createFolder(CONFIG.INVOICE_FOLDER_NAME);

  properties.setProperty(
    INVOICE_AUTOMATION.FOLDER_PROPERTY,
    folder.getId()
  );

  return folder;
}


function getOrCreateInvoiceTemplate_(folder) {
  const properties = PropertiesService.getScriptProperties();
  const daylightFile = tryOpenInvoiceTemplate_(
    INVOICE_AUTOMATION.DAYLIGHT_TEMPLATE_ID
  );

  if (daylightFile) {
    properties.setProperty(
      INVOICE_AUTOMATION.TEMPLATE_PROPERTY,
      daylightFile.getId()
    );
    try {
      daylightFile.moveTo(folder);
    } catch (ignore) {}
    return daylightFile;
  }

  const savedTemplateId = properties.getProperty(
    INVOICE_AUTOMATION.TEMPLATE_PROPERTY
  );

  if (savedTemplateId) {
    const savedFile = tryOpenInvoiceTemplate_(savedTemplateId);
    if (savedFile) return savedFile;
    properties.deleteProperty(
      INVOICE_AUTOMATION.TEMPLATE_PROPERTY
    );
  }

  const namedMatches = DriveApp.getFilesByName(
    CONFIG.INVOICE_TEMPLATE_NAME
  );
  if (namedMatches.hasNext()) {
    const namedFile = namedMatches.next();
    properties.setProperty(
      INVOICE_AUTOMATION.TEMPLATE_PROPERTY,
      namedFile.getId()
    );
    try {
      namedFile.moveTo(folder);
    } catch (ignore) {}
    return namedFile;
  }

  const spreadsheet = SpreadsheetApp.create(
    CONFIG.INVOICE_TEMPLATE_NAME
  );

  spreadsheet.setSpreadsheetTimeZone(CONFIG.TIME_ZONE);
  buildInvoiceTemplate_(spreadsheet);
  SpreadsheetApp.flush();

  const templateFile = DriveApp.getFileById(
    spreadsheet.getId()
  );
  templateFile.moveTo(folder);

  properties.setProperty(
    INVOICE_AUTOMATION.TEMPLATE_PROPERTY,
    templateFile.getId()
  );

  return templateFile;
}


function tryOpenInvoiceTemplate_(fileId) {
  if (!fileId) return null;

  try {
    return DriveApp.getFileById(fileId);
  } catch (ignore) {
    return null;
  }
}


function getInvoiceTemplateFile_() {
  const properties = PropertiesService.getScriptProperties();
  const daylightFile = tryOpenInvoiceTemplate_(
    INVOICE_AUTOMATION.DAYLIGHT_TEMPLATE_ID
  );

  if (daylightFile) {
    properties.setProperty(
      INVOICE_AUTOMATION.TEMPLATE_PROPERTY,
      daylightFile.getId()
    );
    return daylightFile;
  }

  const templateId = properties.getProperty(
    INVOICE_AUTOMATION.TEMPLATE_PROPERTY
  );
  const savedFile = tryOpenInvoiceTemplate_(templateId);

  if (savedFile) return savedFile;

  throw new Error(
    'Invoice automation is not set up. Run ' +
    'setupInvoiceAutomation once from the Apps Script editor.'
  );
}


function getInvoiceSheet_(spreadsheet) {
  return spreadsheet.getSheetByName(
    INVOICE_AUTOMATION.SHEET_NAME
  ) || spreadsheet.getSheets()[0];
}


function createDraftInvoice_(order) {
  const folder = getOrCreateInvoiceFolder_();
  const templateFile = getInvoiceTemplateFile_();
  const fileName = buildInvoiceFileName_(order);
  const invoiceFile = templateFile.makeCopy(fileName, folder);
  const spreadsheet = SpreadsheetApp.openById(
    invoiceFile.getId()
  );

  populateDraftInvoice_(spreadsheet, order);
  SpreadsheetApp.flush();

  const sheet = getInvoiceSheet_(spreadsheet);

  return {
    id: spreadsheet.getId(),
    name: fileName,
    url:
      spreadsheet.getUrl() +
      (sheet ? '#gid=' + sheet.getSheetId() : '')
  };
}


/**
 * Exports the already-prefilled private Google Sheet as an editable .xlsx
 * attachment for the owner email. The Google Sheet remains the live draft.
 */
function exportDraftInvoiceAsXlsx_(order) {
  if (!order || !order.draftInvoiceId) {
    throw new Error('The draft invoice ID is missing.');
  }

  const exportUrl =
    'https://docs.google.com/spreadsheets/d/' +
    encodeURIComponent(order.draftInvoiceId) +
    '/export?format=xlsx';

  const response = UrlFetchApp.fetch(exportUrl, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
    },
    followRedirects: true,
    muteHttpExceptions: true
  });

  const responseCode = response.getResponseCode();

  if (responseCode !== 200) {
    throw new Error(
      'Google Sheets returned export status ' + responseCode + '.'
    );
  }

  const blob = response.getBlob();

  if (!blob || blob.getBytes().length === 0) {
    throw new Error('The Excel export was empty.');
  }

  const invoiceName =
    order.draftInvoiceName || buildInvoiceFileName_(order);

  return blob
    .setContentType(
      'application/vnd.openxmlformats-officedocument.' +
      'spreadsheetml.sheet'
    )
    .setName(invoiceName + '.xlsx');
}


function buildInvoiceFileName_(order) {
  const customerName = cleanText_(
    order && order.customer && order.customer.name,
    80
  ).replace(/[\\/:*?"<>|#%{}~&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    'Harmony-X Invoice ' +
    order.orderId +
    (customerName ? ' - ' + customerName : '')
  );
}


function buildInvoiceTemplate_(spreadsheet) {
  const existingSheets = spreadsheet.getSheets();
  const sheet = existingSheets[0];

  sheet.setName(INVOICE_AUTOMATION.SHEET_NAME);

  for (let i = 1; i < existingSheets.length; i += 1) {
    spreadsheet.deleteSheet(existingSheets[i]);
  }

  sheet.clear();
  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(15);

  const gold = '#B08A3E';
  const deepGold = '#8A6A2E';
  const black = '#1A1814';
  const charcoal = '#E8E0D2';
  const cream = '#F7F3EC';
  const inputGold = '#FFF8EA';
  const softBorder = '#D9C9A8';
  const warningRed = '#A52A24';

  sheet.setColumnWidth(1, 62);
  sheet.setColumnWidth(2, 105);
  sheet.setColumnWidth(3, 105);
  sheet.setColumnWidth(4, 105);
  sheet.setColumnWidth(5, 105);
  sheet.setColumnWidth(6, 105);
  sheet.setColumnWidth(7, 105);
  sheet.setColumnWidth(8, 112);

  sheet.setRowHeights(1, 47, 28);
  sheet.setRowHeights(
    INVOICE_AUTOMATION.ITEM_START_ROW,
    CONFIG.INVOICE_BASE_ITEM_ROWS,
    30
  );
  sheet.setRowHeight(1, 40);
  sheet.setRowHeight(2, 40);
  sheet.setRowHeight(3, 32);
  sheet.setRowHeight(10, 34);
  sheet.setRowHeight(11, 34);
  sheet.setRowHeight(12, 34);
  sheet.setRowHeight(13, 34);
  sheet.setRowHeight(15, 34);
  sheet.setRowHeight(40, 34);
  sheet.setRowHeight(41, 34);
  sheet.setRowHeight(42, 34);
  sheet.setRowHeight(43, 36);
  sheet.setRowHeight(44, 36);
  sheet.setRowHeight(46, 32);
  sheet.setRowHeight(47, 32);

  sheet.getRange('A1:H47')
    .setFontFamily('Arial')
    .setFontColor('#171717')
    .setBackground(cream)
    .setVerticalAlignment('middle');

  sheet.getRange('A1:H2').merge()
    .setValue('HARMONYX')
    .setBackground('#FFFCF7')
    .setFontColor(black)
    .setFontFamily('Georgia')
    .setFontSize(26)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  sheet.getRange('A3:H3').merge()
    .setValue('DRAFT INVOICE • REVIEW BEFORE SENDING')
    .setBackground('#EDE6D6')
    .setFontColor(black)
    .setFontSize(12)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBorder(
      false,
      false,
      true,
      false,
      false,
      false,
      gold,
      SpreadsheetApp.BorderStyle.SOLID_MEDIUM
    );

  sheet.getRange('A5:D5').merge()
    .setValue('HarmonyX')
    .setFontFamily('Georgia')
    .setFontSize(16)
    .setFontWeight('bold')
    .setFontColor(deepGold);
  sheet.getRange('A6:D6').merge()
    .setValue('360-910-6274 • research@harmony-x.com');
  sheet.getRange('A7:D7').merge()
    .setValue('harmonyxpeptides.com');

  ['Invoice #', 'Invoice Date', 'Website Order #']
    .forEach((label, index) => {
      sheet.getRange(5 + index, 6, 1, 2).merge()
        .setValue(label)
        .setBackground(charcoal)
        .setFontColor(black)
        .setFontWeight('bold');
    });
  sheet.getRange('H5:H7')
    .setBackground(inputGold)
    .setFontWeight('bold')
    .setHorizontalAlignment('right')
    .setBorder(
      true,
      true,
      true,
      true,
      false,
      true,
      softBorder,
      SpreadsheetApp.BorderStyle.SOLID
    );

  sheet.getRange('A9:D9').merge()
    .setValue('BILL TO')
    .setBackground(charcoal)
    .setFontColor(gold)
    .setFontWeight('bold');
  sheet.getRange('A10:D13').merge()
    .setBackground(inputGold)
    .setWrap(true)
    .setVerticalAlignment('top')
    .setBorder(
      true,
      true,
      true,
      true,
      false,
      false,
      softBorder,
      SpreadsheetApp.BorderStyle.SOLID
    );

  sheet.getRange('F9:H9').merge()
    .setValue('FULFILLMENT & PAYMENT')
    .setBackground(charcoal)
    .setFontColor(gold)
    .setFontWeight('bold');
  [
    'Fulfillment',
    'Shipping Charge',
    'Payment Status',
    'Payment Method'
  ].forEach((label, index) => {
    sheet.getRange(10 + index, 6, 1, 2).merge()
      .setValue(label)
      .setFontWeight('bold');
  });
  sheet.getRange('H10:H13')
    .setBackground(inputGold)
    .setHorizontalAlignment('right')
    .setBorder(
      true,
      true,
      true,
      true,
      false,
      true,
      softBorder,
      SpreadsheetApp.BorderStyle.SOLID
    );

  const fulfillmentRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      ['USPS Priority Shipping', 'Local pickup'],
      true
    )
    .setAllowInvalid(false)
    .build();
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      ['Unpaid', 'Paid', 'Cancelled'],
      true
    )
    .setAllowInvalid(false)
    .build();
  const paymentRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      ['Zelle', 'Apple Cash'],
      true
    )
    .setAllowInvalid(false)
    .build();

  sheet.getRange('H10').setDataValidation(fulfillmentRule);
  sheet.getRange('H12').setDataValidation(statusRule);
  sheet.getRange('H13').setDataValidation(paymentRule);
  sheet.getRange('H11').setFormula(
    '=IF(H10="Local pickup",0,15)'
  );

  sheet.getRange('A15').setValue('Qty');
  sheet.getRange('B15:F15').merge()
    .setValue('Product / Description');
  sheet.getRange('G15').setValue('Unit Price');
  sheet.getRange('H15').setValue('Amount');
  sheet.getRange('A15:H15')
    .setBackground(gold)
    .setFontColor(black)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBorder(
      true,
      true,
      true,
      true,
      true,
      true,
      deepGold,
      SpreadsheetApp.BorderStyle.SOLID
    );

  const firstItemRow = INVOICE_AUTOMATION.ITEM_START_ROW;
  const lastItemRow =
    firstItemRow + CONFIG.INVOICE_BASE_ITEM_ROWS - 1;

  for (let row = firstItemRow; row <= lastItemRow; row += 1) {
    sheet.getRange(row, 2, 1, 5).merge();
  }

  sheet.getRange(firstItemRow, 1, CONFIG.INVOICE_BASE_ITEM_ROWS, 7)
    .setBackground(inputGold);
  sheet.getRange(firstItemRow, 8, CONFIG.INVOICE_BASE_ITEM_ROWS, 1)
    .setBackground('#FFFDF7');
  sheet.getRange(
    firstItemRow,
    1,
    CONFIG.INVOICE_BASE_ITEM_ROWS,
    8
  ).setBorder(
    true,
    true,
    true,
    true,
    true,
    true,
    softBorder,
    SpreadsheetApp.BorderStyle.SOLID
  );
  sheet.getRange(
    firstItemRow,
    1,
    CONFIG.INVOICE_BASE_ITEM_ROWS,
    1
  ).setHorizontalAlignment('center');
  sheet.getRange(
    firstItemRow,
    7,
    CONFIG.INVOICE_BASE_ITEM_ROWS,
    2
  ).setHorizontalAlignment('right')
    .setNumberFormat('$#,##0.00');

  const lineFormulas = [];
  for (let row = firstItemRow; row <= lastItemRow; row += 1) {
    lineFormulas.push([
      '=IF(OR(RC[-7]="",RC[-1]=""),"",RC[-7]*RC[-1])'
    ]);
  }
  sheet.getRange(
    firstItemRow,
    8,
    CONFIG.INVOICE_BASE_ITEM_ROWS,
    1
  ).setFormulasR1C1(lineFormulas);

  const paymentRow = INVOICE_AUTOMATION.PAYMENT_START_ROW;

  sheet.getRange(paymentRow, 1, 1, 5).merge()
    .setValue('PAYMENT — ZELLE OR APPLE CASH')
    .setBackground(charcoal)
    .setFontColor(gold)
    .setFontWeight('bold');

  sheet.getRange(paymentRow + 1, 1, 1, 2).merge()
    .setValue('Payment Method')
    .setFontWeight('bold');
  sheet.getRange(paymentRow + 1, 3, 1, 3).merge()
    .setFormula('=H13')
    .setBackground(inputGold)
    .setFontWeight('bold');
  sheet.getRange(paymentRow + 2, 1, 1, 5).merge()
    .setValue(
      'Send the exact TOTAL DUE to ' + CONFIG.PAYMENT_PHONE + '.'
    )
    .setFontWeight('bold');
  sheet.getRange(paymentRow + 3, 1, 1, 5).merge()
    .setValue('Zelle memo/notes: LEAVE BLANK.')
    .setFontWeight('bold')
    .setFontColor(warningRed);
  sheet.getRange(paymentRow + 4, 1, 1, 5).merge()
    .setValue(
      'Apple Cash is also accepted at the same phone number. ' +
      'Verify the recipient before sending.'
    )
    .setWrap(true);
  sheet.getRange(paymentRow + 5, 1, 2, 5).merge()
    .setValue(
      'Payment must be confirmed before shipping or pickup. ' +
      'No payment was collected on the website.'
    )
    .setWrap(true);
  sheet.getRange(paymentRow, 1, 7, 5)
    .setBorder(
      true,
      true,
      true,
      true,
      false,
      true,
      softBorder,
      SpreadsheetApp.BorderStyle.SOLID
    );

  sheet.getRange(paymentRow, 6, 1, 2).merge()
    .setValue('Subtotal')
    .setFontWeight('bold');
  sheet.getRange(paymentRow + 1, 6, 1, 2).merge()
    .setValue('Shipping')
    .setFontWeight('bold');
  sheet.getRange(paymentRow + 2, 6, 1, 2).merge()
    .setValue('TOTAL DUE')
    .setBackground(black)
    .setFontColor(gold)
    .setFontSize(15)
    .setFontWeight('bold');
  sheet.getRange(paymentRow, 8)
    .setFormula('=SUM(H' + firstItemRow + ':H' + lastItemRow + ')');
  sheet.getRange(paymentRow + 1, 8).setFormula('=H11');
  sheet.getRange(paymentRow + 2, 8)
    .setFormula('=H' + paymentRow + '+H' + (paymentRow + 1))
    .setBackground(black)
    .setFontColor(gold)
    .setFontSize(15)
    .setFontWeight('bold');
  sheet.getRange(paymentRow, 6, 3, 3)
    .setBorder(
      true,
      true,
      true,
      true,
      false,
      true,
      softBorder,
      SpreadsheetApp.BorderStyle.SOLID
    );
  sheet.getRange(paymentRow, 8, 3, 1)
    .setHorizontalAlignment('right')
    .setNumberFormat('$#,##0.00');

  sheet.getRange(paymentRow + 4, 6, 1, 3).merge()
    .setValue('ORDER NOTES')
    .setBackground(charcoal)
    .setFontColor(gold)
    .setFontWeight('bold');
  sheet.getRange(paymentRow + 5, 6, 2, 3).merge()
    .setBackground(inputGold)
    .setWrap(true)
    .setVerticalAlignment('top')
    .setBorder(
      true,
      true,
      true,
      true,
      false,
      false,
      softBorder,
      SpreadsheetApp.BorderStyle.SOLID
    );

  sheet.getRange(paymentRow + 8, 1, 1, 8).merge()
    .setValue(
      'Thank you. This invoice reflects an approved order request and ' +
      'is not marked paid until HarmonyX confirms receipt.'
    )
    .setFontStyle('italic')
    .setFontColor('#655F53')
    .setHorizontalAlignment('center');
  sheet.getRange(paymentRow + 9, 1, 1, 8).merge()
    .setValue(
      'HarmonyX • 360-910-6274 • research@harmony-x.com • harmonyxpeptides.com'
    )
    .setBackground('#FFFCF7')
    .setFontColor(black)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  sheet.getRange('H5').setValue('HX-DRAFT');
  sheet.getRange('H6').setValue(new Date())
    .setNumberFormat('mmm d, yyyy');
  sheet.getRange('H7').setValue('');
  sheet.getRange('H10').setValue('USPS Priority Shipping');
  sheet.getRange('H12').setValue('Unpaid');
  sheet.getRange('H13').setValue(CONFIG.DEFAULT_PAYMENT_METHOD);
  sheet.getRange('A10').setValue('Customer information');

  sheet.getRange('H5:H13').setFontSize(10);
  sheet.getRange('A1:H47').setWrapStrategy(
    SpreadsheetApp.WrapStrategy.WRAP
  );
}


function populateDraftInvoice_(spreadsheet, order) {
  const sheet = getInvoiceSheet_(spreadsheet);

  if (!sheet) {
    throw new Error(
      'The invoice template is missing the Invoice sheet.'
    );
  }

  const firstItemRow = INVOICE_AUTOMATION.ITEM_START_ROW;
  const baseItemRows = CONFIG.INVOICE_BASE_ITEM_ROWS;

  // A promo discount is represented as one extra line in the item table
  // (quantity 1, a negative "unit price" equal to the discount) rather than
  // as a new row in the fixed Subtotal/Shipping/Total block below — the
  // existing Subtotal formula just sums the item column, so this makes the
  // discount flow through to Subtotal and TOTAL DUE automatically without
  // restructuring the template.
  const hasDiscountRow = order.discount > 0;
  const effectiveLineCount =
    order.items.length + (hasDiscountRow ? 1 : 0);
  const extraRows = Math.max(
    0,
    effectiveLineCount - baseItemRows
  );

  if (extraRows > 0) {
    const insertBeforeRow = firstItemRow + baseItemRows;
    sheet.insertRowsBefore(insertBeforeRow, extraRows);
    sheet.getRange(insertBeforeRow - 1, 1, 1, 8)
      .copyFormatToRange(
        sheet,
        1,
        8,
        insertBeforeRow,
        insertBeforeRow + extraRows - 1
      );

    for (
      let row = insertBeforeRow;
      row < insertBeforeRow + extraRows;
      row += 1
    ) {
      sheet.getRange(row, 2, 1, 5).merge();
      sheet.setRowHeight(row, 30);
    }
  }

  const itemRowCount = baseItemRows + extraRows;
  const lastItemRow = firstItemRow + itemRowCount - 1;
  const paymentRow =
    INVOICE_AUTOMATION.PAYMENT_START_ROW + extraRows;

  sheet.getRange('H5').setValue(order.orderId);
  sheet.getRange('H6').setValue(order.timestamp)
    .setNumberFormat('mmm d, yyyy');
  sheet.getRange('H7').setValue(order.orderId);

  const customerLines = [
    order.customer.name,
    order.customer.email,
    order.customer.phone,
    formatAddressText_(order.customer.shippingAddress)
  ].filter(Boolean);

  sheet.getRange('A10').setValue(customerLines.join('\n'));
  sheet.getRange('H10').setValue(
    order.fulfillment.method === 'pickup'
      ? 'Local pickup'
      : 'USPS Priority Shipping'
  );
  sheet.getRange('H11').setFormula(
    '=IF(H10="Local pickup",0,15)'
  );
  sheet.getRange('H12').setValue('Unpaid');
  sheet.getRange('H13').setValue(CONFIG.DEFAULT_PAYMENT_METHOD);

  const quantityValues = [];
  const productValues = [];
  const unitPriceValues = [];
  const lineFormulas = [];

  for (let index = 0; index < itemRowCount; index += 1) {
    const item = order.items[index] || null;
    const isDiscountRow =
      !item && hasDiscountRow && index === order.items.length;

    quantityValues.push([
      item ? item.vialQuantity : (isDiscountRow ? 1 : '')
    ]);
    productValues.push([
      item
        ? item.productName +
          (item.pricePending ? ' — PRICE PENDING' : '')
        : (isDiscountRow
            ? 'Promo code ' + order.promoCode +
              ' (' + order.promoLabel + ')'
            : '')
    ]);
    unitPriceValues.push([
      item && !item.pricePending
        ? item.pricePerVial
        : (isDiscountRow ? -order.discount : '')
    ]);
    lineFormulas.push([
      '=IF(OR(RC[-7]="",RC[-1]=""),"",RC[-7]*RC[-1])'
    ]);
  }

  sheet.getRange(
    firstItemRow,
    1,
    itemRowCount,
    1
  ).setValues(quantityValues);
  sheet.getRange(
    firstItemRow,
    2,
    itemRowCount,
    1
  ).setValues(productValues);
  sheet.getRange(
    firstItemRow,
    7,
    itemRowCount,
    1
  ).setValues(unitPriceValues)
    .setNumberFormat('$#,##0.00');
  sheet.getRange(
    firstItemRow,
    8,
    itemRowCount,
    1
  ).setFormulasR1C1(lineFormulas)
    .setNumberFormat('$#,##0.00');

  sheet.getRange(paymentRow, 8)
    .setFormula(
      '=SUM(H' + firstItemRow + ':H' + lastItemRow + ')'
    );
  sheet.getRange(paymentRow + 1, 8).setFormula('=H11');
  sheet.getRange(paymentRow + 2, 8)
    .setFormula(
      '=H' + paymentRow + '+H' + (paymentRow + 1)
    );
  sheet.getRange(paymentRow + 1, 3).setFormula('=H13');
  sheet.getRange(paymentRow + 5, 6)
    .setValue(order.customer.notes || 'None provided');

  sheet.setActiveRange(sheet.getRange('A1'));
  spreadsheet.setActiveSheet(sheet);
}


/**
 * Run once from the Apps Script editor after installing v5.5.
 * It adds only new internal tracker tabs. Existing catalog, pricing-engine,
 * website, invoice, and email sheets are never cleared or replaced.
 */
function setupBusinessTracker() {
  const spreadsheet = getCatalogSpreadsheet_();

  createBusinessSettingsSheet_(spreadsheet);
  createBusinessOrdersSheet_(spreadsheet);
  createBusinessItemsSheet_(spreadsheet);
  createBusinessExpensesSheet_(spreadsheet);
  createBusinessCustomersSheet_(spreadsheet);
  createBusinessInventorySheet_(spreadsheet);
  syncBusinessInventoryFromCatalog_(spreadsheet);
  createBusinessDashboardSheet_(spreadsheet);

  const dashboard = spreadsheet.getSheetByName(
    BUSINESS_TRACKER.DASHBOARD_SHEET
  );

  SpreadsheetApp.flush();

  return (
    'Business tracker is ready: ' +
    spreadsheet.getUrl() +
    (dashboard ? '#gid=' + dashboard.getSheetId() : '')
  );
}


function createBusinessSettingsSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(
    BUSINESS_TRACKER.SETTINGS_SHEET
  );

  if (sheet) return sheet;

  sheet = spreadsheet.insertSheet(
    BUSINESS_TRACKER.SETTINGS_SHEET
  );

  prepareBusinessTrackerSheet_(
    sheet,
    3,
    'Harmony-X Business Tracker Settings',
    'Internal settings only. These values do not change website ' +
      'prices, shipping, or customer-facing catalog data.'
  );

  styleBusinessTrackerHeader_(sheet, 3, [
    'Setting',
    'Value',
    'How It Is Used'
  ]);

  sheet.getRange('A5:C10').setValues([
    [
      'Standard Shipping Charge',
      15,
      'Reference for internal order review'
    ],
    [
      'Payment Phone',
      CONFIG.PAYMENT_PHONE,
      'Zelle and Apple Cash payment contact'
    ],
    [
      'Default Low-Stock Level',
      BUSINESS_TRACKER.DEFAULT_LOW_STOCK_LEVEL,
      'Starting reorder warning for every product'
    ],
    [
      'Single Cost Weight',
      BUSINESS_TRACKER.DEFAULT_SINGLE_COST_WEIGHT,
      'Weighted estimated cost per vial'
    ],
    [
      '5-Pack Unit Cost Weight',
      BUSINESS_TRACKER.DEFAULT_FIVE_PACK_COST_WEIGHT,
      'Weighted estimated cost per vial'
    ],
    [
      '10-Pack Unit Cost Weight',
      BUSINESS_TRACKER.DEFAULT_TEN_PACK_COST_WEIGHT,
      'Weighted estimated cost per vial'
    ]
  ]);

  sheet.getRange('A5:C10')
    .setFontFamily('Arial')
    .setFontSize(10)
    .setVerticalAlignment('middle');
  sheet.getRange('B5:B10').setBackground('#FFF4CC');
  sheet.getRange('B5').setNumberFormat('$#,##0.00');
  sheet.getRange('B6').setNumberFormat('@');
  sheet.getRange('B8:B10').setNumberFormat('0.0%');

  setBusinessTrackerColumnWidths_(sheet, [210, 125, 360]);

  return sheet;
}


function createBusinessOrdersSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(
    BUSINESS_TRACKER.ORDERS_SHEET
  );

  if (sheet) return sheet;

  sheet = spreadsheet.insertSheet(
    BUSINESS_TRACKER.ORDERS_SHEET
  );

  const headers = [
    'Order ID',
    'Order Date',
    'Customer Name',
    'Email',
    'Phone',
    'Fulfillment',
    'Shipping Address',
    'Total Vials',
    'Merchandise Subtotal',
    'Shipping',
    'Estimated Total',
    'Payment Method',
    'Payment Status',
    'Amount Paid',
    'Balance Due',
    'Order Status',
    'Editable Invoice Link',
    'Customer Notes',
    'Internal Notes',
    'Est. Product Cost',
    'Est. Gross Profit',
    'Gross Margin',
    'Completed Date'
  ];

  prepareBusinessTrackerSheet_(
    sheet,
    headers.length,
    'Harmony-X Orders',
    'New website requests are added automatically. Update the ' +
      'gold cells as payment and fulfillment progress.'
  );
  styleBusinessTrackerHeader_(sheet, headers.length, headers);

  const dataRows = sheet.getMaxRows() - 4;

  sheet.getRange(5, 2, dataRows, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange(5, 9, dataRows, 7)
    .setNumberFormat('$#,##0.00;[Red]($#,##0.00);-');
  sheet.getRange(5, 20, dataRows, 2)
    .setNumberFormat('$#,##0.00;[Red]($#,##0.00);-');
  sheet.getRange(5, 22, dataRows, 1)
    .setNumberFormat('0.0%');
  sheet.getRange(5, 23, dataRows, 1)
    .setNumberFormat('yyyy-mm-dd');

  const paymentMethodRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      ['Not Selected', 'Zelle', 'Apple Cash'],
      true
    )
    .setAllowInvalid(false)
    .build();
  const paymentStatusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      ['Unpaid', 'Pending', 'Paid', 'Refunded'],
      true
    )
    .setAllowInvalid(false)
    .build();
  const orderStatusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      [
        'New',
        'Awaiting Payment',
        'Paid',
        'Preparing',
        'Shipped',
        'Picked Up',
        'Completed',
        'Canceled'
      ],
      true
    )
    .setAllowInvalid(false)
    .build();

  sheet.getRange(5, 12, dataRows, 1)
    .setDataValidation(paymentMethodRule);
  sheet.getRange(5, 13, dataRows, 1)
    .setDataValidation(paymentStatusRule);
  sheet.getRange(5, 16, dataRows, 1)
    .setDataValidation(orderStatusRule);

  [
    sheet.getRange(5, 12, dataRows, 3),
    sheet.getRange(5, 16, dataRows, 1),
    sheet.getRange(5, 19, dataRows, 1),
    sheet.getRange(5, 23, dataRows, 1)
  ].forEach(range => range.setBackground('#FFF4CC'));

  addBusinessTrackerConditionalRules_(sheet, {
    paidRange: sheet.getRange(5, 13, dataRows, 1),
    statusRange: sheet.getRange(5, 16, dataRows, 1)
  });

  applyBusinessTrackerFilter_(sheet, headers.length);
  setBusinessTrackerColumnWidths_(sheet, [
    150, 130, 165, 190, 120, 130, 250, 90, 125, 90, 115,
    115, 110, 105, 105, 125, 230, 250, 230, 120, 120, 95, 115
  ]);

  return sheet;
}


function createBusinessItemsSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(
    BUSINESS_TRACKER.ITEMS_SHEET
  );

  if (sheet) return sheet;

  sheet = spreadsheet.insertSheet(
    BUSINESS_TRACKER.ITEMS_SHEET
  );

  const headers = [
    'Order ID',
    'Order Date',
    'Customer Email',
    'Product',
    'Category',
    'Qty',
    'Unit Price',
    'Line Revenue',
    'Est. Unit Cost',
    'Est. Line Cost',
    'Est. Gross Profit',
    'Gross Margin',
    'Local Stock?',
    'Item Status'
  ];

  prepareBusinessTrackerSheet_(
    sheet,
    headers.length,
    'Harmony-X Order Items',
    'One row per requested product. Internal cost and profit ' +
      'estimates are never shown to customers.'
  );
  styleBusinessTrackerHeader_(sheet, headers.length, headers);

  const dataRows = sheet.getMaxRows() - 4;

  sheet.getRange(5, 2, dataRows, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange(5, 7, dataRows, 5)
    .setNumberFormat('$#,##0.00;[Red]($#,##0.00);-');
  sheet.getRange(5, 12, dataRows, 1)
    .setNumberFormat('0.0%');

  applyBusinessTrackerFilter_(sheet, headers.length);
  setBusinessTrackerColumnWidths_(sheet, [
    150, 130, 190, 190, 145, 70, 105, 110, 110, 110, 120,
    95, 95, 120
  ]);

  return sheet;
}


function createBusinessInventorySheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(
    BUSINESS_TRACKER.INVENTORY_SHEET
  );

  if (sheet) return sheet;

  sheet = spreadsheet.insertSheet(
    BUSINESS_TRACKER.INVENTORY_SHEET
  );

  const headers = [
    'Product',
    'Category',
    'Weighted Unit Cost',
    'Starting Qty',
    'Restocked / Adjustments',
    'Units Fulfilled',
    'Available Qty',
    'Reorder Level',
    'Reorder?',
    'Inventory Value',
    'Notes'
  ];

  prepareBusinessTrackerSheet_(
    sheet,
    headers.length,
    'Harmony-X Inventory',
    'Enter starting quantities and restocks in gold cells. Units ' +
      'are deducted only after an order is Shipped, Picked Up, or Completed.'
  );
  styleBusinessTrackerHeader_(sheet, headers.length, headers);

  const dataRows = sheet.getMaxRows() - 4;
  sheet.getRange(5, 3, dataRows, 1)
    .setNumberFormat('$#,##0.00');
  sheet.getRange(5, 10, dataRows, 1)
    .setNumberFormat('$#,##0.00');
  sheet.getRange(5, 4, dataRows, 2)
    .setBackground('#FFF4CC');
  sheet.getRange(5, 11, dataRows, 1)
    .setBackground('#FFF4CC');

  const existingRules = sheet.getConditionalFormatRules();
  const inventoryStatusRange = sheet.getRange(
    5,
    9,
    dataRows,
    1
  );
  existingRules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('REORDER')
      .setBackground('#F4CCCC')
      .setFontColor('#8A1C1C')
      .setBold(true)
      .setRanges([inventoryStatusRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('OK')
      .setBackground('#D9EAD3')
      .setFontColor('#1F5E2C')
      .setBold(true)
      .setRanges([inventoryStatusRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('NOT SET')
      .setBackground('#E7E6E6')
      .setFontColor('#555555')
      .setRanges([inventoryStatusRange])
      .build()
  );
  sheet.setConditionalFormatRules(existingRules);

  applyBusinessTrackerFilter_(sheet, headers.length);
  setBusinessTrackerColumnWidths_(sheet, [
    200, 155, 120, 95, 135, 100, 100, 100, 95, 115, 220
  ]);

  return sheet;
}


function createBusinessExpensesSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(
    BUSINESS_TRACKER.EXPENSES_SHEET
  );

  if (sheet) return sheet;

  sheet = spreadsheet.insertSheet(
    BUSINESS_TRACKER.EXPENSES_SHEET
  );

  const headers = [
    'Date',
    'Vendor',
    'Category',
    'Description',
    'Amount',
    'Payment Method',
    'Related Order ID',
    'Receipt / Link',
    'Tax Deductible?',
    'Notes'
  ];

  prepareBusinessTrackerSheet_(
    sheet,
    headers.length,
    'Harmony-X Expenses',
    'Enter business expenses here. Dashboard totals update automatically.'
  );
  styleBusinessTrackerHeader_(sheet, headers.length, headers);

  const dataRows = sheet.getMaxRows() - 4;

  sheet.getRange(5, 1, dataRows, headers.length)
    .setBackground('#FFF4CC');
  sheet.getRange(5, 1, dataRows, 1)
    .setNumberFormat('yyyy-mm-dd');
  sheet.getRange(5, 5, dataRows, 1)
    .setNumberFormat('$#,##0.00;[Red]($#,##0.00);-');

  sheet.getRange(5, 3, dataRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(
        [
          'Inventory',
          'Shipping & Postage',
          'Packaging',
          'Supplies',
          'Marketing',
          'Software',
          'Professional Services',
          'Fees',
          'Taxes',
          'Other'
        ],
        true
      )
      .setAllowInvalid(false)
      .build()
  );
  sheet.getRange(5, 6, dataRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(
        ['Zelle', 'Apple Cash', 'Cash', 'Card', 'Bank', 'Other'],
        true
      )
      .setAllowInvalid(false)
      .build()
  );
  sheet.getRange(5, 9, dataRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['Yes', 'No', 'Review'], true)
      .setAllowInvalid(false)
      .build()
  );

  applyBusinessTrackerFilter_(sheet, headers.length);
  setBusinessTrackerColumnWidths_(sheet, [
    105, 155, 155, 240, 105, 120, 150, 220, 110, 240
  ]);

  return sheet;
}


function createBusinessCustomersSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(
    BUSINESS_TRACKER.CUSTOMERS_SHEET
  );

  if (sheet) return sheet;

  sheet = spreadsheet.insertSheet(
    BUSINESS_TRACKER.CUSTOMERS_SHEET
  );

  const headers = [
    'Email',
    'Customer Name',
    'Phone',
    'Shipping Address',
    'First Order',
    'Most Recent Order',
    'Total Orders',
    'Requested Total',
    'Amount Paid',
    'Balance Due',
    'Last Order ID',
    'Last Order Status',
    'Internal Notes'
  ];

  prepareBusinessTrackerSheet_(
    sheet,
    headers.length,
    'Harmony-X Customers',
    'Customers are added automatically by email address. Totals ' +
      'update from the Orders sheet.'
  );
  styleBusinessTrackerHeader_(sheet, headers.length, headers);

  const dataRows = sheet.getMaxRows() - 4;
  sheet.getRange(5, 5, dataRows, 2)
    .setNumberFormat('yyyy-mm-dd');
  sheet.getRange(5, 8, dataRows, 3)
    .setNumberFormat('$#,##0.00;[Red]($#,##0.00);-');
  sheet.getRange(5, 13, dataRows, 1)
    .setBackground('#FFF4CC');

  applyBusinessTrackerFilter_(sheet, headers.length);
  setBusinessTrackerColumnWidths_(sheet, [
    190, 170, 120, 250, 110, 120, 90, 115, 105, 105, 150,
    120, 220
  ]);

  return sheet;
}


function createBusinessDashboardSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(
    BUSINESS_TRACKER.DASHBOARD_SHEET
  );

  if (sheet) return sheet;

  sheet = spreadsheet.insertSheet(
    BUSINESS_TRACKER.DASHBOARD_SHEET
  );

  prepareBusinessTrackerSheet_(
    sheet,
    10,
    'Harmony-X Business Dashboard',
    'Internal operating view. Collected sales, balances, profit, ' +
      'expenses, customers, and low-stock alerts update automatically.'
  );

  const cards = [
    [
      'A4:B4',
      'A5:B6',
      'TOTAL ORDERS',
      '=COUNTIF(\'Orders\'!$A$5:$A$2000,"<>")',
      '0'
    ],
    [
      'C4:D4',
      'C5:D6',
      'OPEN ORDERS',
      '=COUNTIFS(\'Orders\'!$A$5:$A$2000,"<>",' +
        '\'Orders\'!$P$5:$P$2000,"<>Completed",' +
        '\'Orders\'!$P$5:$P$2000,"<>Canceled")',
      '0'
    ],
    [
      'E4:F4',
      'E5:F6',
      'PAID / COLLECTED',
      '=SUM(\'Orders\'!$N$5:$N$2000)',
      '$#,##0.00'
    ],
    [
      'G4:H4',
      'G5:H6',
      'UNPAID BALANCE',
      '=SUM(\'Orders\'!$O$5:$O$2000)',
      '$#,##0.00'
    ],
    [
      'I4:J4',
      'I5:J6',
      'CUSTOMERS',
      '=COUNTIF(\'Customers\'!$A$5:$A$1000,"<>")',
      '0'
    ],
    [
      'A8:B8',
      'A9:B10',
      'FULFILLED GROSS PROFIT',
      '=SUMIFS(\'Orders\'!$U$5:$U$2000,\'Orders\'!$P$5:$P$2000,"Shipped")+' +
        'SUMIFS(\'Orders\'!$U$5:$U$2000,\'Orders\'!$P$5:$P$2000,"Picked Up")+' +
        'SUMIFS(\'Orders\'!$U$5:$U$2000,\'Orders\'!$P$5:$P$2000,"Completed")',
      '$#,##0.00'
    ],
    [
      'C8:D8',
      'C9:D10',
      'EXPENSES',
      '=SUM(\'Expenses\'!$E$5:$E$1000)',
      '$#,##0.00'
    ],
    [
      'E8:F8',
      'E9:F10',
      'NET PROFIT ESTIMATE',
      '=A9-C9',
      '$#,##0.00'
    ],
    [
      'G8:H8',
      'G9:H10',
      'LOW-STOCK ITEMS',
      '=COUNTIF(\'Inventory\'!$I$5:$I$1000,"REORDER")',
      '0'
    ],
    [
      'I8:J8',
      'I9:J10',
      'INVENTORY VALUE',
      '=SUM(\'Inventory\'!$J$5:$J$1000)',
      '$#,##0.00'
    ]
  ];

  cards.forEach(card => {
    const labelRange = sheet.getRange(card[0]);
    const valueRange = sheet.getRange(card[1]);

    labelRange.merge()
      .setValue(card[2])
      .setBackground('#6A0D1B')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    valueRange.merge()
      .setFormula(card[3])
      .setNumberFormat(card[4])
      .setBackground('#050505')
      .setFontColor('#F2E2A6')
      .setFontWeight('bold')
      .setFontSize(17)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  });

  styleBusinessTrackerHeader_(sheet, 3, [
    'Month',
    'Collected',
    'Expenses'
  ], 13);

  const monthLabels = [];
  const collectedFormulas = [];
  const expenseFormulas = [];

  for (let row = 14; row <= 25; row += 1) {
    monthLabels.push([
      '=TEXT(DATE(YEAR(TODAY()),ROW()-13,1),"mmm")'
    ]);
    collectedFormulas.push([
      '=SUMIFS(\'Orders\'!$N$5:$N$2000,' +
      '\'Orders\'!$B$5:$B$2000,">="&' +
      'DATE(YEAR(TODAY()),ROW()-13,1),' +
      '\'Orders\'!$B$5:$B$2000,"<"&' +
      'DATE(YEAR(TODAY()),ROW()-12,1))'
    ]);
    expenseFormulas.push([
      '=SUMIFS(\'Expenses\'!$E$5:$E$1000,' +
      '\'Expenses\'!$A$5:$A$1000,">="&' +
      'DATE(YEAR(TODAY()),ROW()-13,1),' +
      '\'Expenses\'!$A$5:$A$1000,"<"&' +
      'DATE(YEAR(TODAY()),ROW()-12,1))'
    ]);
  }

  sheet.getRange('A14:A25').setFormulas(monthLabels);
  sheet.getRange('B14:B25')
    .setFormulas(collectedFormulas)
    .setNumberFormat('$#,##0.00');
  sheet.getRange('C14:C25')
    .setFormulas(expenseFormulas)
    .setNumberFormat('$#,##0.00');

  styleBusinessTrackerHeader_(sheet, 2, [
    'Order Status',
    'Count'
  ], 29);

  const statuses = [
    'New',
    'Awaiting Payment',
    'Paid',
    'Preparing',
    'Shipped',
    'Picked Up',
    'Completed',
    'Canceled'
  ];

  sheet.getRange('A30:A37').setValues(
    statuses.map(status => [status])
  );
  sheet.getRange('B30:B37').setFormulas(
    statuses.map((status, index) => [
      '=COUNTIF(\'Orders\'!$P$5:$P$2000,A' +
      (30 + index) + ')'
    ])
  );

  sheet.getRange('D29:J29').merge()
    .setValue('SIMPLE WORKFLOW')
    .setBackground('#6A0D1B')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.getRange('D30:J37').merge()
    .setValue(
      '1. New website requests appear in Orders and Order Items.\n' +
      '2. Review the prefilled invoice.\n' +
      '3. Update Payment Method, Payment Status, and Amount Paid.\n' +
      '4. Update Order Status as you prepare and fulfill it.\n' +
      '5. Enter restocks and expenses. The dashboard updates automatically.'
    )
    .setBackground('#F7F3E8')
    .setWrap(true)
    .setVerticalAlignment('top');

  const chart = sheet.newChart()
    .asLineChart()
    .addRange(sheet.getRange('A13:C25'))
    .setPosition(13, 5, 0, 0)
    .setOption('title', 'Monthly Cash In vs Expenses')
    .setOption('legend', { position: 'bottom' })
    .setOption('colors', ['#D8B85D', '#6A0D1B'])
    .setOption('vAxis', { format: '$#,##0' })
    .build();
  sheet.insertChart(chart);

  setBusinessTrackerColumnWidths_(sheet, [
    110, 105, 110, 105, 110, 105, 110, 105, 110, 105
  ]);

  return sheet;
}


function prepareBusinessTrackerSheet_(
  sheet,
  lastColumn,
  title,
  subtitle
) {
  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(4);
  sheet.setTabColor('#D8B85D');

  sheet.getRange(1, 1, 1, lastColumn).merge()
    .setValue(title)
    .setBackground('#050505')
    .setFontColor('#F2E2A6')
    .setFontFamily('Arial')
    .setFontSize(16)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  sheet.getRange(2, 1, 1, lastColumn).merge()
    .setValue(subtitle)
    .setBackground('#1A1A1A')
    .setFontColor('#F2E2A6')
    .setFontFamily('Arial')
    .setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  sheet.setRowHeight(1, 34);
  sheet.setRowHeight(2, 34);
}


function styleBusinessTrackerHeader_(
  sheet,
  lastColumn,
  headers,
  rowNumber
) {
  const row = rowNumber || BUSINESS_TRACKER.HEADER_ROW;
  const range = sheet.getRange(row, 1, 1, lastColumn);

  range.setValues([headers])
    .setBackground('#6A0D1B')
    .setFontColor('#FFFFFF')
    .setFontFamily('Arial')
    .setFontSize(10)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true)
    .setBorder(
      true,
      true,
      true,
      true,
      true,
      true,
      '#D6C18A',
      SpreadsheetApp.BorderStyle.SOLID
    );

  sheet.setRowHeight(row, 36);
}


function setBusinessTrackerColumnWidths_(sheet, widths) {
  widths.forEach((width, index) => {
    sheet.setColumnWidth(index + 1, width);
  });
}


function applyBusinessTrackerFilter_(sheet, lastColumn) {
  if (sheet.getFilter()) return;

  sheet.getRange(
    BUSINESS_TRACKER.HEADER_ROW,
    1,
    sheet.getMaxRows() - BUSINESS_TRACKER.HEADER_ROW + 1,
    lastColumn
  ).createFilter();
}


function addBusinessTrackerConditionalRules_(sheet, ranges) {
  const rules = sheet.getConditionalFormatRules();

  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Paid')
      .setBackground('#D9EAD3')
      .setFontColor('#1F5E2C')
      .setBold(true)
      .setRanges([ranges.paidRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Unpaid')
      .setBackground('#F4CCCC')
      .setFontColor('#8A1C1C')
      .setBold(true)
      .setRanges([ranges.paidRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Completed')
      .setBackground('#D9EAD3')
      .setFontColor('#1F5E2C')
      .setBold(true)
      .setRanges([ranges.statusRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Canceled')
      .setBackground('#E7E6E6')
      .setFontColor('#555555')
      .setRanges([ranges.statusRange])
      .build()
  );

  sheet.setConditionalFormatRules(rules);
}


function syncBusinessInventoryFromCatalog_(spreadsheet) {
  const inventorySheet = requireBusinessTrackerSheet_(
    spreadsheet,
    BUSINESS_TRACKER.INVENTORY_SHEET
  );
  const catalogSheet = getCatalogSheet_();
  const values = catalogSheet.getDataRange().getValues();
  const headers = values[0].map(normalizeHeader_);
  const productIndex = headers.indexOf('product');
  const categoryIndex = headers.indexOf('category');

  if (productIndex < 0 || categoryIndex < 0) {
    throw new Error(
      'Master Catalog Product or Category column is missing.'
    );
  }

  const lastInventoryRow = Math.max(
    inventorySheet.getLastRow(),
    BUSINESS_TRACKER.DATA_START_ROW - 1
  );
  const existingProducts = new Set();

  if (lastInventoryRow >= BUSINESS_TRACKER.DATA_START_ROW) {
    inventorySheet.getRange(
      BUSINESS_TRACKER.DATA_START_ROW,
      1,
      lastInventoryRow - BUSINESS_TRACKER.DATA_START_ROW + 1,
      1
    ).getValues().forEach(row => {
      const name = cleanText_(row[0], 150).toLowerCase();
      if (name) existingProducts.add(name);
    });
  }

  const newProducts = values.slice(1)
    .map(row => ({
      name: cleanText_(row[productIndex], 150),
      category: cleanText_(row[categoryIndex], 100)
    }))
    .filter(product =>
      product.name &&
      !existingProducts.has(product.name.toLowerCase())
    );

  if (!newProducts.length) return;

  const startRow = Math.max(
    inventorySheet.getLastRow() + 1,
    BUSINESS_TRACKER.DATA_START_ROW
  );
  ensureBusinessTrackerRows_(
    inventorySheet,
    startRow + newProducts.length - 1
  );

  inventorySheet.getRange(
    startRow,
    1,
    newProducts.length,
    2
  ).setValues(
    newProducts.map(product => [
      product.name,
      product.category
    ])
  );

  const costFormulas = [];
  const fulfilledFormulas = [];
  const availableFormulas = [];
  const reorderLevelFormulas = [];
  const reorderFormulas = [];
  const valueFormulas = [];

  newProducts.forEach((product, index) => {
    const row = startRow + index;

    costFormulas.push([
      '=IFERROR(VLOOKUP(A' + row +
      ',\'Master Catalog\'!$A$2:$K$999,7,FALSE)*' +
      '\'Business Settings\'!$B$8+' +
      'IF(VLOOKUP(A' + row +
      ',\'Master Catalog\'!$A$2:$K$999,9,FALSE)="",' +
      'VLOOKUP(A' + row +
      ',\'Master Catalog\'!$A$2:$K$999,7,FALSE),' +
      'VLOOKUP(A' + row +
      ',\'Master Catalog\'!$A$2:$K$999,9,FALSE))*' +
      '\'Business Settings\'!$B$9+' +
      'IF(VLOOKUP(A' + row +
      ',\'Master Catalog\'!$A$2:$K$999,11,FALSE)="",' +
      'VLOOKUP(A' + row +
      ',\'Master Catalog\'!$A$2:$K$999,7,FALSE),' +
      'VLOOKUP(A' + row +
      ',\'Master Catalog\'!$A$2:$K$999,11,FALSE))*' +
      '\'Business Settings\'!$B$10,"")'
    ]);
    fulfilledFormulas.push([
      '=SUMIFS(\'Order Items\'!$F$5:$F$5000,' +
      '\'Order Items\'!$D$5:$D$5000,A' + row + ',' +
      '\'Order Items\'!$N$5:$N$5000,"Shipped")+' +
      'SUMIFS(\'Order Items\'!$F$5:$F$5000,' +
      '\'Order Items\'!$D$5:$D$5000,A' + row + ',' +
      '\'Order Items\'!$N$5:$N$5000,"Picked Up")+' +
      'SUMIFS(\'Order Items\'!$F$5:$F$5000,' +
      '\'Order Items\'!$D$5:$D$5000,A' + row + ',' +
      '\'Order Items\'!$N$5:$N$5000,"Completed")'
    ]);
    availableFormulas.push([
      '=D' + row + '+E' + row + '-F' + row
    ]);
    reorderLevelFormulas.push([
      '=\'Business Settings\'!$B$7'
    ]);
    reorderFormulas.push([
      '=IF(AND(D' + row + '="",E' + row + '=""),' +
      '"NOT SET",IF(G' + row + '<=H' + row + ',' +
      '"REORDER","OK"))'
    ]);
    valueFormulas.push([
      '=MAX(0,G' + row + ')*C' + row
    ]);
  });

  inventorySheet.getRange(startRow, 3, newProducts.length, 1)
    .setFormulas(costFormulas)
    .setNumberFormat('$#,##0.00');
  inventorySheet.getRange(startRow, 6, newProducts.length, 1)
    .setFormulas(fulfilledFormulas);
  inventorySheet.getRange(startRow, 7, newProducts.length, 1)
    .setFormulas(availableFormulas);
  inventorySheet.getRange(startRow, 8, newProducts.length, 1)
    .setFormulas(reorderLevelFormulas);
  inventorySheet.getRange(startRow, 9, newProducts.length, 1)
    .setFormulas(reorderFormulas);
  inventorySheet.getRange(startRow, 10, newProducts.length, 1)
    .setFormulas(valueFormulas)
    .setNumberFormat('$#,##0.00');

  inventorySheet.getRange(startRow, 4, newProducts.length, 2)
    .setBackground('#FFF4CC');
  inventorySheet.getRange(startRow, 11, newProducts.length, 1)
    .setBackground('#FFF4CC');
}


function getInternalCostMap_() {
  const settings = getBusinessTrackerCostSettings_();
  const sheet = getCatalogSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(normalizeHeader_);

  const productIndex = headers.indexOf('product');
  const singleIndex = headers.findIndex(header =>
    ['single cost', 'single supplier cost'].includes(header)
  );
  const fiveUnitIndex = headers.findIndex(header =>
    ['5 pack unit', '5-pack unit'].includes(header)
  );
  const tenUnitIndex = headers.findIndex(header =>
    ['10 pack unit', '10-pack unit'].includes(header)
  );

  const costMap = new Map();

  if (productIndex < 0 || singleIndex < 0) {
    return costMap;
  }

  values.slice(1).forEach(row => {
    const productName = cleanText_(row[productIndex], 150);
    const singleCost = toMoney_(row[singleIndex]);

    if (!productName || singleCost === null) return;

    const fiveUnitCost = fiveUnitIndex >= 0
      ? toMoney_(row[fiveUnitIndex])
      : null;
    const tenUnitCost = tenUnitIndex >= 0
      ? toMoney_(row[tenUnitIndex])
      : null;

    const weightedCost = roundMoney_(
      singleCost * settings.singleWeight +
      (fiveUnitCost === null ? singleCost : fiveUnitCost) *
        settings.fiveWeight +
      (tenUnitCost === null ? singleCost : tenUnitCost) *
        settings.tenWeight
    );

    costMap.set(productName.toLowerCase(), weightedCost);
  });

  return costMap;
}


function getBusinessTrackerCostSettings_() {
  const defaults = {
    singleWeight:
      BUSINESS_TRACKER.DEFAULT_SINGLE_COST_WEIGHT,
    fiveWeight:
      BUSINESS_TRACKER.DEFAULT_FIVE_PACK_COST_WEIGHT,
    tenWeight:
      BUSINESS_TRACKER.DEFAULT_TEN_PACK_COST_WEIGHT
  };

  const spreadsheet = getCatalogSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(
    BUSINESS_TRACKER.SETTINGS_SHEET
  );

  if (!sheet || sheet.getLastRow() < 10) {
    return defaults;
  }

  const values = sheet.getRange('A5:B10').getValues();
  const settings = new Map(
    values.map(row => [
      normalizeHeader_(row[0]),
      row[1]
    ])
  );

  const singleWeight = Number(
    settings.get('single cost weight')
  );
  const fiveWeight = Number(
    settings.get('5 pack unit cost weight')
  );
  const tenWeight = Number(
    settings.get('10 pack unit cost weight')
  );
  const totalWeight = singleWeight + fiveWeight + tenWeight;

  if (
    !Number.isFinite(totalWeight) ||
    totalWeight <= 0
  ) {
    return defaults;
  }

  return {
    singleWeight: singleWeight / totalWeight,
    fiveWeight: fiveWeight / totalWeight,
    tenWeight: tenWeight / totalWeight
  };
}


function logOrderToBusinessTracker_(order) {
  const spreadsheet = getCatalogSpreadsheet_();
  const ordersSheet = requireBusinessTrackerSheet_(
    spreadsheet,
    BUSINESS_TRACKER.ORDERS_SHEET
  );
  const itemsSheet = requireBusinessTrackerSheet_(
    spreadsheet,
    BUSINESS_TRACKER.ITEMS_SHEET
  );
  const customersSheet = requireBusinessTrackerSheet_(
    spreadsheet,
    BUSINESS_TRACKER.CUSTOMERS_SHEET
  );

  const firstItemRow = Math.max(
    itemsSheet.getLastRow() + 1,
    BUSINESS_TRACKER.DATA_START_ROW
  );
  const lastItemRow = firstItemRow + order.items.length - 1;

  ensureBusinessTrackerRows_(itemsSheet, lastItemRow);

  const itemValues = order.items.map(item => [
    order.orderId,
    order.timestamp,
    order.customer.email,
    item.productName,
    item.category,
    item.vialQuantity,
    item.pricePending ? '' : item.pricePerVial,
    '',
    item.estimatedUnitCost === null
      ? ''
      : item.estimatedUnitCost,
    '',
    '',
    '',
    item.localStock ? 'Yes' : 'No',
    ''
  ]);

  itemsSheet.getRange(
    firstItemRow,
    1,
    itemValues.length,
    14
  ).setValues(itemValues);

  const revenueFormulas = [];
  const costFormulas = [];
  const profitFormulas = [];
  const marginFormulas = [];
  const statusFormulas = [];

  order.items.forEach((item, index) => {
    const row = firstItemRow + index;

    revenueFormulas.push([
      '=IF(A' + row + '="","",IF(OR(F' + row +
      '="",G' + row + '=""),"",F' + row + '*G' + row + '))'
    ]);
    costFormulas.push([
      '=IF(A' + row + '="","",IF(OR(F' + row +
      '="",I' + row + '=""),"",F' + row + '*I' + row + '))'
    ]);
    profitFormulas.push([
      '=IF(A' + row + '="","",IF(OR(H' + row +
      '="",J' + row + '=""),"",H' + row + '-J' + row + '))'
    ]);
    marginFormulas.push([
      '=IFERROR(K' + row + '/H' + row + ',0)'
    ]);
    statusFormulas.push([
      '=IF(A' + row + '="","",IFERROR(VLOOKUP(A' + row +
      ',\'Orders\'!$A$5:$P$2000,16,FALSE),"New"))'
    ]);
  });

  itemsSheet.getRange(firstItemRow, 8, itemValues.length, 1)
    .setFormulas(revenueFormulas);
  itemsSheet.getRange(firstItemRow, 10, itemValues.length, 1)
    .setFormulas(costFormulas);
  itemsSheet.getRange(firstItemRow, 11, itemValues.length, 1)
    .setFormulas(profitFormulas);
  itemsSheet.getRange(firstItemRow, 12, itemValues.length, 1)
    .setFormulas(marginFormulas);
  itemsSheet.getRange(firstItemRow, 14, itemValues.length, 1)
    .setFormulas(statusFormulas);

  itemsSheet.getRange(firstItemRow, 2, itemValues.length, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm');
  itemsSheet.getRange(firstItemRow, 7, itemValues.length, 5)
    .setNumberFormat('$#,##0.00;[Red]($#,##0.00);-');
  itemsSheet.getRange(firstItemRow, 12, itemValues.length, 1)
    .setNumberFormat('0.0%');

  const orderRow = Math.max(
    ordersSheet.getLastRow() + 1,
    BUSINESS_TRACKER.DATA_START_ROW
  );

  ensureBusinessTrackerRows_(ordersSheet, orderRow);

  ordersSheet.getRange(orderRow, 1, 1, 23).setValues([[
    order.orderId,
    order.timestamp,
    order.customer.name,
    order.customer.email,
    order.customer.phone,
    order.fulfillment.method === 'pickup'
      ? 'Local pickup'
      : 'USPS Priority Shipping',
    formatAddressText_(order.customer.shippingAddress),
    order.totalVials,
    order.subtotal,
    order.fulfillment.shippingFee,
    order.estimatedTotal,
    'Not Selected',
    'Unpaid',
    0,
    '',
    'New',
    order.draftInvoiceUrl || '',
    order.customer.notes || '',
    order.discount > 0
      ? 'Promo ' + order.promoCode + ' (' + order.promoLabel + '): -' +
        formatCurrency_(order.discount)
      : '',
    '',
    '',
    '',
    ''
  ]]);

  ordersSheet.getRange(orderRow, 15).setFormula(
    '=IF(A' + orderRow + '="","",MAX(0,K' +
    orderRow + '-N' + orderRow + '))'
  );
  ordersSheet.getRange(orderRow, 20).setFormula(
    '=IF(A' + orderRow + '="","",SUMIF(' +
    '\'Order Items\'!$A$5:$A$5000,A' + orderRow + ',' +
    '\'Order Items\'!$J$5:$J$5000))'
  );
  ordersSheet.getRange(orderRow, 21).setFormula(
    '=IF(A' + orderRow + '="","",I' + orderRow +
    '-T' + orderRow + ')'
  );
  ordersSheet.getRange(orderRow, 22).setFormula(
    '=IFERROR(U' + orderRow + '/I' + orderRow + ',0)'
  );

  ordersSheet.getRange(orderRow, 2)
    .setNumberFormat('yyyy-mm-dd hh:mm');
  ordersSheet.getRange(orderRow, 9, 1, 7)
    .setNumberFormat('$#,##0.00;[Red]($#,##0.00);-');
  ordersSheet.getRange(orderRow, 20, 1, 2)
    .setNumberFormat('$#,##0.00;[Red]($#,##0.00);-');
  ordersSheet.getRange(orderRow, 22)
    .setNumberFormat('0.0%');
  ordersSheet.getRange(orderRow, 12, 1, 3)
    .setBackground('#FFF4CC');
  ordersSheet.getRange(orderRow, 16)
    .setBackground('#FFF4CC');
  ordersSheet.getRange(orderRow, 19)
    .setBackground('#FFF4CC');
  ordersSheet.getRange(orderRow, 23)
    .setBackground('#FFF4CC');

  upsertBusinessTrackerCustomer_(
    customersSheet,
    order
  );

  const dashboard = spreadsheet.getSheetByName(
    BUSINESS_TRACKER.DASHBOARD_SHEET
  );

  order.businessTrackerLogged = true;
  order.businessTrackerUrl = spreadsheet.getUrl() +
    (dashboard ? '#gid=' + dashboard.getSheetId() : '');

  SpreadsheetApp.flush();
}


function upsertBusinessTrackerCustomer_(sheet, order) {
  const email = order.customer.email.toLowerCase();
  const lastRow = Math.max(
    sheet.getLastRow(),
    BUSINESS_TRACKER.DATA_START_ROW
  );
  const match = sheet.getRange(
    BUSINESS_TRACKER.DATA_START_ROW,
    1,
    lastRow - BUSINESS_TRACKER.DATA_START_ROW + 1,
    1
  ).createTextFinder(email)
    .matchEntireCell(true)
    .matchCase(false)
    .findNext();

  const row = match
    ? match.getRow()
    : Math.max(
        sheet.getLastRow() + 1,
        BUSINESS_TRACKER.DATA_START_ROW
      );

  ensureBusinessTrackerRows_(sheet, row);

  sheet.getRange(row, 1, 1, 4).setValues([[
    email,
    order.customer.name,
    order.customer.phone,
    formatAddressText_(order.customer.shippingAddress)
  ]]);
  sheet.getRange(row, 11).setValue(order.orderId);
  sheet.getRange(row, 12).setFormula(
    '=IF(K' + row + '="","",IFERROR(VLOOKUP(K' + row +
    ',\'Orders\'!$A$5:$P$2000,16,FALSE),""))'
  );

  sheet.getRange(row, 5).setFormula(
    '=IF(A' + row + '="","",MINIFS(' +
    '\'Orders\'!$B$5:$B$2000,\'Orders\'!$D$5:$D$2000,A' +
    row + '))'
  );
  sheet.getRange(row, 6).setFormula(
    '=IF(A' + row + '="","",MAXIFS(' +
    '\'Orders\'!$B$5:$B$2000,\'Orders\'!$D$5:$D$2000,A' +
    row + '))'
  );
  sheet.getRange(row, 7).setFormula(
    '=IF(A' + row + '="","",COUNTIF(' +
    '\'Orders\'!$D$5:$D$2000,A' + row + '))'
  );
  sheet.getRange(row, 8).setFormula(
    '=IF(A' + row + '="","",SUMIF(' +
    '\'Orders\'!$D$5:$D$2000,A' + row + ',' +
    '\'Orders\'!$K$5:$K$2000))'
  );
  sheet.getRange(row, 9).setFormula(
    '=IF(A' + row + '="","",SUMIF(' +
    '\'Orders\'!$D$5:$D$2000,A' + row + ',' +
    '\'Orders\'!$N$5:$N$2000))'
  );
  sheet.getRange(row, 10).setFormula(
    '=IF(A' + row + '="","",SUMIF(' +
    '\'Orders\'!$D$5:$D$2000,A' + row + ',' +
    '\'Orders\'!$O$5:$O$2000))'
  );

  sheet.getRange(row, 5, 1, 2)
    .setNumberFormat('yyyy-mm-dd');
  sheet.getRange(row, 8, 1, 3)
    .setNumberFormat('$#,##0.00;[Red]($#,##0.00);-');
  sheet.getRange(row, 13).setBackground('#FFF4CC');
}


function requireBusinessTrackerSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    throw new Error(
      'Business tracker tab "' + name + '" is missing. ' +
      'Run setupBusinessTracker once from the Apps Script editor.'
    );
  }

  return sheet;
}


function ensureBusinessTrackerRows_(sheet, requiredLastRow) {
  const currentRows = sheet.getMaxRows();

  if (requiredLastRow <= currentRows) return;

  sheet.insertRowsAfter(
    currentRows,
    Math.max(100, requiredLastRow - currentRows)
  );
}


function getCatalogSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error(
      'The script is not connected to a spreadsheet. ' +
      'Open the catalog Google Sheet and use ' +
      'Extensions > Apps Script, or set CONFIG.SPREADSHEET_ID.'
    );
  }

  return spreadsheet;
}


function getCatalogSheet_() {
  const spreadsheet = getCatalogSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(
    CONFIG.CATALOG_SHEET_NAME
  );

  if (!sheet) {
    throw new Error(
      'Sheet "' + CONFIG.CATALOG_SHEET_NAME + '" was not found.'
    );
  }

  return sheet;
}


function getRequiredColumnMap_(normalizedHeaders) {
  const aliases = {
    product: ['product'],
    category: ['category'],
    description: ['description'],
    featured: ['featured'],
    retail: ['retail'],
    localStock: ['norcal stock', 'norcal stock?']
  };

  const optionalAliases = {
    productDetails: [
      'product details',
      'product detail',
      'full product details'
    ],
    highlights: [
      'highlights',
      'hiehlights',
      'highlight'
    ],
    researchGuideUrl: [
      'research guide one page url',
      'research guide one pager url',
      'research guide url',
      'one page url',
      'one pager url'
    ],
    popularRank: [
      'popular rank',
      'most popular rank',
      'most popular'
    ]
  };

  const map = {};

  Object.keys(aliases).forEach(key => {
    const index = normalizedHeaders.findIndex(header =>
      aliases[key].includes(header)
    );

    if (index === -1) {
      throw new Error(
        'Required catalog column is missing: ' +
        aliases[key][0]
      );
    }

    map[key] = index;
  });

  Object.keys(optionalAliases).forEach(key => {
    map[key] = normalizedHeaders.findIndex(header =>
      optionalAliases[key].includes(header)
    );
  });

  return map;
}


function validateCustomer_(customer, fulfillment) {
  if (!customer || typeof customer !== 'object') {
    throw new Error('Customer information is required.');
  }

  const name = cleanText_(customer.name, 120);
  const email =
    cleanText_(customer.email, 180).toLowerCase();
  const phone = cleanText_(customer.phone, 50);
  const notes = cleanText_(customer.notes, 1500);

  if (name.length < 2) {
    throw new Error('Please enter your full name.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email address.');
  }

  if (phone.replace(/\D/g, '').length < 7) {
    throw new Error('Please enter a valid phone number.');
  }

  const shippingAddress = customer.shippingAddress
    ? {
        address1: cleanText_(
          customer.shippingAddress.address1,
          180
        ),
        address2: cleanText_(
          customer.shippingAddress.address2,
          120
        ),
        city: cleanText_(
          customer.shippingAddress.city,
          100
        ),
        state: cleanText_(
          customer.shippingAddress.state,
          80
        ),
        postalCode: cleanText_(
          customer.shippingAddress.postalCode,
          30
        ),
        country: cleanText_(
          customer.shippingAddress.country,
          80
        )
      }
    : null;

  if (
    fulfillment.method === 'shipping' &&
    (
      !shippingAddress ||
      !shippingAddress.address1 ||
      !shippingAddress.city ||
      !shippingAddress.state ||
      !shippingAddress.postalCode ||
      !shippingAddress.country
    )
  ) {
    throw new Error(
      'Please provide a complete shipping address.'
    );
  }

  return {
    name,
    email,
    phone,
    notes,
    shippingAddress,
    fulfillmentMethod: fulfillment.method
  };
}


function validateFulfillment_(fulfillment, customer) {
  const requestedMethod = cleanText_(
    (fulfillment && fulfillment.method) ||
      (customer && customer.fulfillmentMethod) ||
      'shipping',
    30
  ).toLowerCase();

  if (requestedMethod === 'pickup') {
    return {
      method: 'pickup',
      label: 'Local pickup',
      shippingFee: 0
    };
  }

  return {
    method: 'shipping',
    label: 'USPS Priority shipping',
    shippingFee: 15
  };
}


function validateRequestedItems_(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      'Please add at least one product to the order.'
    );
  }

  if (items.length > 100) {
    throw new Error(
      'The order contains too many separate items.'
    );
  }

  return items.map(item => {
    const productName = cleanText_(
      item && item.productName,
      150
    );
    const vialQuantity = Number(
      item && item.vialQuantity
    );

    if (!productName) {
      throw new Error(
        'An order item is missing its product name.'
      );
    }

    if (
      !Number.isInteger(vialQuantity) ||
      vialQuantity < 1 ||
      vialQuantity > CONFIG.MAX_VIAL_QUANTITY
    ) {
      throw new Error(
        'Vial quantities must be whole numbers between 1 and ' +
        CONFIG.MAX_VIAL_QUANTITY + '.'
      );
    }

    return { productName, vialQuantity };
  });
}


function sendOwnerOrderEmail_(order) {
  const email = {
    to: CONFIG.ORDER_NOTIFICATION_EMAILS,
    subject:
      'New HarmonyX Order Request - ' +
      order.orderId,
    name: CONFIG.BUSINESS_NAME,
    replyTo: order.customer.email
  };

  if (order.draftInvoiceId) {
    try {
      email.attachments = [
        exportDraftInvoiceAsXlsx_(order)
      ];
      order.draftInvoiceAttachmentIncluded = true;
    } catch (attachmentError) {
      order.draftInvoiceAttachmentError = getErrorMessage_(
        attachmentError,
        'The editable Excel invoice could not be attached.'
      );

      console.error(
        'Draft invoice Excel export failed: ' +
        order.draftInvoiceAttachmentError
      );
    }
  }

  email.body = buildOwnerTextEmail_(order);
  email.htmlBody = buildOwnerHtmlEmail_(order);

  MailApp.sendEmail(email);
}


function sendCustomerConfirmation_(order) {
  const subject =
    'HarmonyX Request Received - ' +
    order.orderId;

  const itemLines = [];
  order.items.forEach((item, index) => {
    itemLines.push(
      (index + 1) + '. ' + item.productName,
      '   Quantity: ' + item.vialQuantity + ' vial(s)',
      '   Price per vial: ' +
        (item.pricePending
          ? 'Contact for price'
          : formatCurrency_(item.pricePerVial)),
      '   Line total: ' +
        (item.pricePending
          ? 'Pending'
          : formatCurrency_(item.lineTotal))
    );
  });

  const fulfillmentText =
    order.fulfillment.method === 'pickup'
      ? 'Local pickup - $0.00'
      : 'USPS Priority shipping - ' +
        formatCurrency_(order.fulfillment.shippingFee);

  const textBody = [
    'Hello ' + order.customer.name + ',',
    '',
    'We received your HarmonyX order request.',
    'Order number: ' + order.orderId,
    '',
    'PRODUCTS',
    ...itemLines,
    '',
    'FULFILLMENT',
    'Method: ' + fulfillmentText,
    '',
    'Merchandise subtotal: ' +
      formatCurrency_(order.subtotal),
    ...(order.discount > 0
      ? ['Promo code ' + order.promoCode + ' (' + order.promoLabel + '): -' +
          formatCurrency_(order.discount)]
      : []),
    'Estimated request total: ' +
      formatCurrency_(order.estimatedTotal) +
      (order.hasPricePendingItems
        ? ' plus pending-price item(s)'
        : ''),
    '',
    'No payment was collected online. This is an order request, ' +
      'not a completed purchase.',
    'We will contact you regarding availability, timing, and next steps.',
    'We will follow up by email or phone, usually within 24 hours.',
    '',
    'Questions? Reply to this email or contact ' +
      CONFIG.OWNER_EMAIL + '.',
    '',
    'Products supplied by Purity Collective.',
    'Research-use products only. Not for human consumption.',
    '',
    CONFIG.BUSINESS_NAME
  ].join('\n');

  const rows = order.items.map(item =>
    '<tr>' +
      '<td style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);' +
      'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
        escapeHtml_(item.productName) +
      '</td>' +
      '<td align="center" style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);' +
      'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
        item.vialQuantity +
      '</td>' +
      '<td align="right" style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);' +
      'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
        (item.pricePending
          ? 'Pending'
          : formatCurrency_(item.lineTotal)) +
      '</td>' +
    '</tr>'
  ).join('');

  const addressHtml = order.customer.shippingAddress &&
    (order.customer.shippingAddress.address1 ||
      order.customer.shippingAddress.city)
    ? '<h2 style="margin:28px 0 10px 0;font-family:Georgia,\'Times New Roman\',serif;' +
      'font-size:22px;font-weight:400;color:#1A1814;">Ship to</h2>' +
      '<p style="margin:0;color:#6B6458;font-family:Arial,Helvetica,sans-serif;' +
      'font-size:14px;line-height:1.6;">' +
        escapeHtml_(formatAddressText_(order.customer.shippingAddress))
          .replace(/\n/g, '<br>') +
      '</p>'
    : '';

  const notesHtml = order.customer.notes
    ? '<h2 style="margin:28px 0 10px 0;font-family:Georgia,\'Times New Roman\',serif;' +
      'font-size:22px;font-weight:400;color:#1A1814;">Notes</h2>' +
      '<p style="margin:0;color:#6B6458;font-family:Arial,Helvetica,sans-serif;' +
      'font-size:14px;line-height:1.6;white-space:pre-wrap">' +
        escapeHtml_(order.customer.notes) +
      '</p>'
    : '';

  const htmlBody =
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F7F3EC;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="background:#F7F3EC;padding:32px 12px;"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" ' +
    'style="max-width:600px;width:100%;background:#FFFCF7;border:1px solid rgba(26,24,20,0.10);' +
    'border-radius:18px;">' +
      '<tr><td style="padding:36px 40px 24px 40px;border-bottom:1px solid rgba(26,24,20,0.08);">' +
        '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:28px;' +
        'line-height:1;color:#1A1814;">Harmony<span style="color:#B08A3E;">X</span></div>' +
        '<div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;' +
        'letter-spacing:0.32em;color:#B08A3E;">PEPTIDES</div>' +
        '<h1 style="margin:22px 0 0 0;font-family:Georgia,\'Times New Roman\',serif;' +
        'font-size:34px;line-height:1.15;font-weight:400;color:#1A1814;">Request received</h1>' +
      '</td></tr>' +
      '<tr><td style="padding:32px 40px 8px 40px;font-family:Arial,Helvetica,sans-serif;' +
      'font-size:15px;line-height:1.65;color:#1A1814;">' +
        '<p style="margin:0 0 14px 0;">Hello ' +
          escapeHtml_(order.customer.name) + ',</p>' +
        '<p style="margin:0 0 22px 0;color:#6B6458;">We received your HarmonyX order request.</p>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
        'style="background:#F7F3EC;border-left:3px solid #B08A3E;"><tr>' +
          '<td style="padding:14px 18px;font-size:14px;color:#1A1814;">' +
            '<strong>Order number:</strong> ' +
            escapeHtml_(order.orderId) +
          '</td>' +
        '</tr></table>' +
        '<h2 style="margin:32px 0 12px 0;font-family:Georgia,\'Times New Roman\',serif;' +
        'font-size:22px;font-weight:400;color:#1A1814;">Requested products</h2>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
        'style="border-collapse:collapse;">' +
          '<tr>' +
            '<td style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);' +
            'font-size:11px;letter-spacing:0.16em;color:#B08A3E;">PRODUCT</td>' +
            '<td align="center" style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);' +
            'font-size:11px;letter-spacing:0.16em;color:#B08A3E;">QTY</td>' +
            '<td align="right" style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);' +
            'font-size:11px;letter-spacing:0.16em;color:#B08A3E;">LINE TOTAL</td>' +
          '</tr>' +
          rows +
        '</table>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
        'style="margin:22px 0 0 0;background:#F7F3EC;border-radius:12px;"><tr>' +
          '<td style="padding:18px 20px;font-size:14px;line-height:1.7;color:#1A1814;">' +
            '<div><span style="color:#B08A3E;">Fulfillment:</span> ' +
              escapeHtml_(fulfillmentText) +
            '</div>' +
            '<div><span style="color:#B08A3E;">Merchandise subtotal:</span> ' +
              formatCurrency_(order.subtotal) +
            '</div>' +
            (order.discount > 0
              ? '<div><span style="color:#B08A3E;">Promo ' +
                  escapeHtml_(order.promoCode) + ' (' +
                  escapeHtml_(order.promoLabel) + '):</span> −' +
                  formatCurrency_(order.discount) +
                '</div>'
              : '') +
            '<div style="margin-top:8px;font-size:16px;"><strong>Estimated total: ' +
              formatCurrency_(order.estimatedTotal) +
              (order.hasPricePendingItems
                ? ' + pending-price item(s)'
                : '') +
            '</strong></div>' +
          '</td>' +
        '</tr></table>' +
        addressHtml +
        notesHtml +
        '<p style="margin:28px 0 12px 0;color:#6B6458;">No payment was collected online. ' +
        'This is an order request, not a completed purchase. We will contact ' +
        'you regarding availability, timing, and next steps.</p>' +
        '<p style="margin:0 0 12px 0;color:#6B6458;">We will follow up by email or phone, usually within 24 hours.</p>' +
        '<p style="margin:0 0 8px 0;color:#6B6458;">Questions? Reply to this email or contact ' +
        '<a href="mailto:' + CONFIG.OWNER_EMAIL + '" style="color:#B08A3E;text-decoration:none;">' +
        CONFIG.OWNER_EMAIL + '</a>.</p>' +
      '</td></tr>' +
      '<tr><td style="padding:8px 40px 36px 40px;font-family:Arial,Helvetica,sans-serif;' +
      'font-size:12px;line-height:1.6;color:#9A9286;">' +
        'Products supplied by Purity Collective.<br>' +
        'Research-use products only. Not for human consumption.' +
      '</td></tr>' +
    '</table></td></tr></table></body></html>';

  MailApp.sendEmail({
    to: order.customer.email,
    subject,
    body: textBody,
    htmlBody,
    name: CONFIG.BUSINESS_NAME,
    replyTo: CONFIG.OWNER_EMAIL
  });
}


function buildOwnerTextEmail_(order) {
  const lines = [
    'NEW HARMONY-X ORDER REQUEST',
    '',
    'Order ID: ' + order.orderId,
    'Date: ' + formatDateTime_(order.timestamp),
    '',
    'CUSTOMER',
    'Name: ' + order.customer.name,
    'Email: ' + order.customer.email,
    'Phone: ' + order.customer.phone,
    'Availability: ' + order.availabilitySummary,
    ''
  ];

  if (order.draftInvoiceUrl) {
    lines.push(
      'EDITABLE INVOICE',
      order.draftInvoiceUrl,
      order.draftInvoiceAttachmentIncluded
        ? 'A prefilled editable Excel copy is attached to this email.'
        : 'The Google Sheet is available at the private link above.',
      'Review and edit the invoice before sending it to the customer.',
      ''
    );

    if (order.draftInvoiceAttachmentError) {
      lines.push(
        'EXCEL ATTACHMENT NOTICE',
        order.draftInvoiceAttachmentError,
        'The editable Google Sheet link above is still available.',
        ''
      );
    }
  } else if (order.draftInvoiceError) {
    lines.push(
      'DRAFT INVOICE NOT CREATED',
      order.draftInvoiceError,
      'Run setupInvoiceAutomation once from the Apps Script editor.',
      ''
    );
  }

  if (order.businessTrackerLogged) {
    lines.push(
      'BUSINESS TRACKER',
      order.businessTrackerUrl,
      'This order was added automatically to Orders, Order Items, ' +
        'and Customers.',
      ''
    );
  } else if (order.businessTrackerError) {
    lines.push(
      'BUSINESS TRACKER NOTICE',
      order.businessTrackerError,
      'Run setupBusinessTracker once from the Apps Script editor.',
      ''
    );
  }

  lines.push('ORDER');

  order.items.forEach((item, index) => {
    lines.push(
      '',
      (index + 1) + '. ' + item.productName,
      'Category: ' + item.category,
      'Vials requested: ' + item.vialQuantity,
      'Retail price per vial: ' +
        (item.pricePending
          ? 'Contact for price'
          : formatCurrency_(item.pricePerVial)),
      'Line total: ' +
        (item.pricePending
          ? 'Pending'
          : formatCurrency_(item.lineTotal)),
      'Local stock shown in catalog: ' +
        (item.localStock ? 'Yes' : 'No')
    );
  });

  lines.push(
    '',
    '----------------------------------------',
    'TOTAL VIALS: ' + order.totalVials,
    'SUBTOTAL: ' + formatCurrency_(order.subtotal),
    ...(order.discount > 0
      ? ['PROMO CODE: ' + order.promoCode + ' (' + order.promoLabel + ') -' +
          formatCurrency_(order.discount)]
      : []),
    'FULFILLMENT: ' +
      (order.fulfillment.method === 'pickup'
        ? 'Local pickup'
        : 'USPS Priority shipping'),
    'SHIPPING: ' +
      formatCurrency_(order.fulfillment.shippingFee),
    'ESTIMATED REQUEST TOTAL: ' +
      formatCurrency_(order.estimatedTotal) +
      (order.hasPricePendingItems
        ? ' plus item(s) pending price confirmation'
        : ''),
    '',
    'SHIPPING ADDRESS',
    formatAddressText_(order.customer.shippingAddress),
    '',
    'CUSTOMER NOTES',
    order.customer.notes || 'None provided',
    '',
    'No payment was collected online.'
  );

  return lines.join('\n');
}


function buildOwnerHtmlEmail_(order) {
  const rows = order.items.map(item =>
    '<tr>' +
      '<td style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);' +
      'font-family:Arial,Helvetica,sans-serif;color:#1A1814;">' +
        '<div style="font-size:14px;">' +
          escapeHtml_(item.productName) +
        '</div>' +
        '<div style="font-size:12px;color:#6B6458;margin-top:3px;">' +
          escapeHtml_(item.category) +
        '</div>' +
      '</td>' +
      '<td align="center" style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);' +
      'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
        item.vialQuantity +
      '</td>' +
      '<td align="center" style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);' +
      'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
        (item.pricePending
          ? '—'
          : formatCurrency_(item.pricePerVial)) +
      '</td>' +
      '<td align="right" style="padding:12px 0;border-bottom:1px solid rgba(26,24,20,0.08);' +
      'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A1814;">' +
        (item.pricePending
          ? 'Pending'
          : formatCurrency_(item.lineTotal)) +
      '</td>' +
    '</tr>'
  ).join('');

  let draftInvoiceHtml = '';
  let businessTrackerHtml = '';

  if (order.draftInvoiceUrl) {
    const attachmentMessage =
      order.draftInvoiceAttachmentIncluded
        ? '<div style="margin-top:10px;color:#1A1814;font-size:13px;font-weight:bold">' +
            'A prefilled editable Excel invoice is attached to this email.' +
          '</div>'
        : order.draftInvoiceAttachmentError
          ? '<div style="margin-top:10px;color:#A52A24;font-size:12px">Excel attachment notice: ' +
              escapeHtml_(order.draftInvoiceAttachmentError) +
              '. The private Google Sheet is still available below.' +
            '</div>'
          : '';

    draftInvoiceHtml =
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
      'style="margin:18px 0 0 0;background:#F7F3EC;border-radius:12px;"><tr>' +
        '<td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;">' +
          '<div style="font-size:16px;color:#1A1814;margin-bottom:10px;">' +
            '<strong>Prefilled editable invoice</strong></div>' +
          attachmentMessage +
          '<a href="' + escapeHtml_(order.draftInvoiceUrl) + '" ' +
          'style="display:inline-block;margin-top:8px;background:#B08A3E;color:#FFFCF7;' +
          'text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;">' +
            'Open editable invoice' +
          '</a>' +
          '<div style="margin-top:10px;font-size:12px;color:#6B6458;">' +
            'Review and edit this private invoice before sending it to the customer.' +
          '</div>' +
          (order.discount > 0
            ? '<div style="margin-top:10px;font-size:12px;color:#6B6458;">Promo ' +
                escapeHtml_(order.promoCode) + ' (−' +
                formatCurrency_(order.discount) +
                ') is already a line on the invoice.</div>'
            : '') +
        '</td>' +
      '</tr></table>';
  } else if (order.draftInvoiceError) {
    draftInvoiceHtml =
      '<p style="margin:18px 0 0 0;color:#A52A24;font-family:Arial,Helvetica,sans-serif;' +
      'font-size:14px;"><strong>Draft invoice was not created.</strong> ' +
      escapeHtml_(order.draftInvoiceError) +
      ' Run setupInvoiceAutomation once from the Apps Script editor.</p>';
  }

  if (order.businessTrackerLogged) {
    businessTrackerHtml =
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
      'style="margin:12px 0 0 0;background:#F7F3EC;border-radius:12px;"><tr>' +
        '<td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;">' +
          '<div style="font-size:16px;color:#1A1814;margin-bottom:10px;">' +
            '<strong>Business tracker updated</strong></div>' +
          '<a href="' + escapeHtml_(order.businessTrackerUrl) + '" ' +
          'style="display:inline-block;background:#B08A3E;color:#FFFCF7;' +
          'text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;">' +
            'Open business dashboard' +
          '</a>' +
        '</td>' +
      '</tr></table>';
  } else if (order.businessTrackerError) {
    businessTrackerHtml =
      '<p style="margin:18px 0 0 0;color:#A52A24;font-family:Arial,Helvetica,sans-serif;' +
      'font-size:14px;"><strong>Business tracker was not updated.</strong> ' +
      escapeHtml_(order.businessTrackerError) +
      ' Run setupBusinessTracker once from the Apps Script editor.</p>';
  }

  const addressText = formatAddressText_(order.customer.shippingAddress);

  return (
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F7F3EC;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="background:#F7F3EC;padding:32px 12px;"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" ' +
    'style="max-width:600px;width:100%;background:#FFFCF7;border:1px solid rgba(26,24,20,0.10);' +
    'border-radius:18px;">' +
      '<tr><td style="padding:36px 40px 24px 40px;border-bottom:1px solid rgba(26,24,20,0.08);">' +
        '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:28px;' +
        'line-height:1;color:#1A1814;">Harmony<span style="color:#B08A3E;">X</span></div>' +
        '<div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;' +
        'letter-spacing:0.32em;color:#B08A3E;">PEPTIDES</div>' +
        '<h1 style="margin:22px 0 0 0;font-family:Georgia,\'Times New Roman\',serif;' +
        'font-size:34px;line-height:1.15;font-weight:400;color:#1A1814;">New order request</h1>' +
      '</td></tr>' +
      '<tr><td style="padding:22px 40px 8px 40px;font-family:Arial,Helvetica,sans-serif;' +
      'font-size:15px;line-height:1.65;color:#1A1814;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
        'style="background:#F7F3EC;border-left:3px solid #B08A3E;"><tr>' +
          '<td style="padding:14px 18px;font-size:14px;"><strong>' +
            escapeHtml_(order.orderId) +
          '</strong></td>' +
        '</tr></table>' +
        '<h2 style="margin:28px 0 10px 0;font-family:Georgia,\'Times New Roman\',serif;' +
        'font-size:22px;font-weight:400;color:#1A1814;">Customer</h2>' +
        '<p style="margin:0 0 4px 0;"><strong>Name:</strong> ' +
          escapeHtml_(order.customer.name) + '</p>' +
        '<p style="margin:0 0 4px 0;"><strong>Email:</strong> ' +
          escapeHtml_(order.customer.email) + '</p>' +
        '<p style="margin:0 0 4px 0;"><strong>Phone:</strong> ' +
          escapeHtml_(order.customer.phone) + '</p>' +
        '<p style="margin:0 0 4px 0;"><strong>Availability:</strong> ' +
          escapeHtml_(order.availabilitySummary) + '</p>' +
        '<p style="margin:0 0 8px 0;"><strong>Date:</strong> ' +
          escapeHtml_(formatDateTime_(order.timestamp)) + '</p>' +
        draftInvoiceHtml +
        businessTrackerHtml +
        '<h2 style="margin:28px 0 12px 0;font-family:Georgia,\'Times New Roman\',serif;' +
        'font-size:22px;font-weight:400;color:#1A1814;">Requested products</h2>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
        'style="border-collapse:collapse;">' +
          '<tr>' +
            '<td style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);' +
            'font-size:11px;letter-spacing:0.16em;color:#B08A3E;">PRODUCT</td>' +
            '<td align="center" style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);' +
            'font-size:11px;letter-spacing:0.16em;color:#B08A3E;">VIALS</td>' +
            '<td align="center" style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);' +
            'font-size:11px;letter-spacing:0.16em;color:#B08A3E;">PER VIAL</td>' +
            '<td align="right" style="padding:10px 0;border-bottom:1px solid rgba(26,24,20,0.10);' +
            'font-size:11px;letter-spacing:0.16em;color:#B08A3E;">LINE TOTAL</td>' +
          '</tr>' +
          rows +
        '</table>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
        'style="margin:22px 0 0 0;background:#F7F3EC;border-radius:12px;"><tr>' +
          '<td style="padding:18px 20px;font-size:14px;line-height:1.7;color:#1A1814;">' +
            '<div><strong>Total vials:</strong> ' + order.totalVials + '</div>' +
            '<div><strong>Subtotal:</strong> ' +
              formatCurrency_(order.subtotal) + '</div>' +
            (order.discount > 0
              ? '<div><strong>Promo ' + escapeHtml_(order.promoCode) +
                ' (' + escapeHtml_(order.promoLabel) + '):</strong> −' +
                formatCurrency_(order.discount) + '</div>'
              : '') +
            '<div><strong>Fulfillment:</strong> ' +
              escapeHtml_(
                order.fulfillment.method === 'pickup'
                  ? 'Local pickup'
                  : 'USPS Priority shipping'
              ) +
            '</div>' +
            '<div><strong>Shipping:</strong> ' +
              formatCurrency_(order.fulfillment.shippingFee) +
            '</div>' +
            '<div style="margin-top:8px;font-size:16px;"><strong>Estimated total: ' +
              formatCurrency_(order.estimatedTotal) +
              (order.hasPricePendingItems
                ? ' + pending-price item(s)'
                : '') +
            '</strong></div>' +
          '</td>' +
        '</tr></table>' +
        (addressText
          ? '<h2 style="margin:28px 0 10px 0;font-family:Georgia,\'Times New Roman\',serif;' +
            'font-size:22px;font-weight:400;color:#1A1814;">Ship to</h2>' +
            '<p style="margin:0;color:#6B6458;font-size:14px;line-height:1.6;">' +
              escapeHtml_(addressText).replace(/\n/g, '<br>') +
            '</p>'
          : '') +
        '<h2 style="margin:28px 0 10px 0;font-family:Georgia,\'Times New Roman\',serif;' +
        'font-size:22px;font-weight:400;color:#1A1814;">Notes</h2>' +
        '<p style="margin:0;color:#6B6458;font-size:14px;line-height:1.6;white-space:pre-wrap">' +
          escapeHtml_(order.customer.notes || 'None provided') +
        '</p>' +
        '<p style="margin:28px 0 0 0;color:#6B6458;">A draft invoice was created in Drive. ' +
        'No payment was collected on the website.</p>' +
      '</td></tr>' +
      '<tr><td style="padding:24px 40px 36px 40px;font-family:Arial,Helvetica,sans-serif;' +
      'font-size:12px;line-height:1.6;color:#9A9286;">' +
        'HarmonyX Peptides · research@harmony-x.com · harmonyxpeptides.com' +
      '</td></tr>' +
    '</table></td></tr></table></body></html>'
  );
}


function logOrderToSeparateSpreadsheet_(order) {
  const spreadsheet = SpreadsheetApp.openById(
    CONFIG.ORDER_LOG_SPREADSHEET_ID
  );

  let sheet = spreadsheet.getSheetByName(
    CONFIG.ORDER_LOG_SHEET_NAME
  );

  if (!sheet) {
    sheet = spreadsheet.insertSheet(
      CONFIG.ORDER_LOG_SHEET_NAME
    );

    sheet.appendRow([
      'Order ID',
      'Timestamp',
      'Customer Name',
      'Email',
      'Phone',
      'Availability',
      'Products',
      'Total Vials',
      'Subtotal',
      'Estimated Total',
      'Notes',
      'Status'
    ]);

    sheet.setFrozenRows(1);
  }

  const productSummary = order.items.map(item =>
    item.productName + ' - ' +
    item.vialQuantity + ' vial(s) - ' +
    (item.pricePending
      ? 'Price pending'
      : formatCurrency_(item.lineTotal))
  ).join('\n');

  sheet.appendRow([
    order.orderId,
    order.timestamp,
    order.customer.name,
    order.customer.email,
    order.customer.phone,
    order.availabilitySummary,
    productSummary,
    order.totalVials,
    order.subtotal,
    order.estimatedTotal,
    order.customer.notes,
    'New'
  ]);
}


function formatAddressText_(address) {
  if (!address) return '';

  return [
    address.address1,
    address.address2,
    [
      address.city,
      address.state,
      address.postalCode
    ].filter(Boolean).join(', ')
      .replace(
        ', ' + address.postalCode,
        ' ' + address.postalCode
      ),
    address.country
  ].filter(Boolean).join('\n');
}


function normalizeHeader_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[?]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function cleanText_(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
      ''
    )
    .trim()
    .slice(0, maxLength || 1000);
}


function cleanUrl_(value) {
  const url = cleanText_(value, 2000);

  return /^https?:\/\//i.test(url)
    ? url
    : '';
}


function toBoolean_(value) {
  return (
    value === true ||
    /^(true|yes|1)$/i.test(String(value || '').trim())
  );
}


function toRank_(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}


function toMoney_(value) {
  if (
    value === '' ||
    value === null ||
    typeof value === 'undefined'
  ) {
    return null;
  }

  const number = Number(
    typeof value === 'string'
      ? value.replace(/[$,\s]/g, '')
      : value
  );

  return Number.isFinite(number)
    ? roundMoney_(number)
    : null;
}


function roundMoney_(value) {
  return (
    Math.round(
      (Number(value) + Number.EPSILON) * 100
    ) / 100
  );
}


function formatCurrency_(value) {
  return '$' + Number(value || 0).toFixed(2);
}


function formatDateTime_(date) {
  return Utilities.formatDate(
    new Date(date),
    CONFIG.TIME_ZONE,
    'MMMM d, yyyy h:mm a z'
  );
}


function generateOrderId_() {
  const datePart = Utilities.formatDate(
    new Date(),
    CONFIG.TIME_ZONE,
    'yyyyMMdd'
  );

  const randomPart =
    Math.floor(1000 + Math.random() * 9000);

  return 'HX-' + datePart + '-' + randomPart;
}


function createProductId_(name, rowNumber) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) +
    '-' +
    rowNumber
  );
}


function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function getErrorMessage_(error, fallback) {
  return error && error.message
    ? error.message
    : fallback;
}


function handleContact_(payload) {
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  const message = String(payload.message || '').trim();

  if (name.length < 2) {
    throw new Error('Please enter your name.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email address.');
  }
  if (message.length < 5) {
    throw new Error('Please enter a message.');
  }

  const safeName = escapeHtml_(name);
  const safeEmail = escapeHtml_(email);
  const safeMessage = escapeHtml_(message).replace(/\n/g, '<br>');

  const html =
    '<div style="background:#F7F3EC;padding:28px 0;font-family:Georgia,serif;color:#1A1814;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFCF7;border:1px solid #E6DFD2;border-radius:16px;">' +
    '<tr><td style="padding:28px 32px 8px 32px;font-size:13px;letter-spacing:.16em;color:#B08A3E;">HARMONYX</td></tr>' +
    '<tr><td style="padding:0 32px 8px 32px;font-size:28px;">Website inquiry</td></tr>' +
    '<tr><td style="padding:0 32px 20px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#6B6458;">' +
    'From the contact form on harmonyxpeptides.com. Reply to this email to answer ' +
    safeName + '.' +
    '</td></tr>' +
    '<tr><td style="padding:0 32px 28px 32px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3EC;border-radius:12px;">' +
    '<tr><td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#1A1814;">' +
    '<div><span style="color:#B08A3E;">Name:</span> ' + safeName + '</div>' +
    '<div><span style="color:#B08A3E;">Email:</span> ' + safeEmail + '</div>' +
    '<div style="margin-top:12px;">' + safeMessage + '</div>' +
    '</td></tr></table></td></tr></table></td></tr></table></div>';

  MailApp.sendEmail({
    to: CONFIG.ORDER_NOTIFICATION_EMAILS,
    replyTo: email,
    subject: 'HarmonyX website inquiry from ' + name,
    htmlBody: html,
    name: CONFIG.BUSINESS_NAME
  });

  return {
    success: true,
    message: 'Message received.'
  };
}




