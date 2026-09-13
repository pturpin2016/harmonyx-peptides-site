/**
 * HarmonyX contact form — paste into Apps Script Code.gs
 *
 * 1. Replace the existing doPost function with the one below.
 * 2. Paste handleContact_ and escapeContact_ at the bottom of Code.gs.
 * 3. Save, then Deploy → Manage deployments → pencil → New version → Deploy.
 *
 * Website inquiries then email research@harmony-x.com (and Thabby)
 * the same way order notifications do. No invoice is created.
 */

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
      message: message,
      error: message
    });
  }
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

  const safeName = escapeContact_(name);
  const safeEmail = escapeContact_(email);
  const safeMessage = escapeContact_(message).replace(/\n/g, '<br>');

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
    '<div style="margin-top:12px;white-space:pre-wrap;">' + safeMessage + '</div>' +
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


function escapeContact_(value) {
  return String(value || '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}
