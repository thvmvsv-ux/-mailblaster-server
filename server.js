const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;
const BREVO_KEY = process.env.BREVO_API_KEY || '';

function sendCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendEmail(to, toName, from, fromName, subject, body, isHTML) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      sender: { name: fromName || 'Mail Blaster', email: from },
      to: [{ email: to, name: toName || to }],
      subject: subject,
      ...(isHTML ? { htmlContent: body } : { textContent: body })
    });

    const options = {
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_KEY,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, email: to });
        } else {
          reject({ success: false, email: to, error: data });
        }
      });
    });

    req.on('error', err => reject({ success: false, email: to, error: err.message }));
    req.write(payload);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  sendCORS(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url);

  // Health check
  if (parsedUrl.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'Mail Blaster Server is running!', version: '1.0' }));
    return;
  }

  // Send single email
  if (parsedUrl.pathname === '/send' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { to, toName, from, fromName, subject, message, isHTML } = data;

        if (!to || !from || !subject || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing required fields: to, from, subject, message' }));
          return;
        }

        if (!BREVO_KEY) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'BREVO_API_KEY not set on server' }));
          return;
        }

        const result = await sendEmail(to, toName, from, fromName, subject, message, isHTML);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: typeof err === 'object' ? JSON.stringify(err) : err }));
      }
    });
    return;
  }

  // Send bulk emails
  if (parsedUrl.pathname === '/send-bulk' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { recipients, from, fromName, subject, message, isHTML, delay } = data;

        if (!recipients || !Array.isArray(recipients) || !from || !subject || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing required fields' }));
          return;
        }

        if (!BREVO_KEY) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'BREVO_API_KEY not set on server' }));
          return;
        }

        const results = { sent: 0, failed: 0, errors: [] };
        const delayMs = delay || 500;

        for (let i = 0; i < recipients.length; i++) {
          const rec = recipients[i];
          const personalizedSubject = subject
            .replace(/{name}/g, rec.name || rec.email)
            .replace(/{email}/g, rec.email)
            .replace(/{company}/g, rec.company || '')
            .replace(/{city}/g, rec.city || '');
          const personalizedBody = message
            .replace(/{name}/g, rec.name || rec.email)
            .replace(/{email}/g, rec.email)
            .replace(/{company}/g, rec.company || '')
            .replace(/{city}/g, rec.city || '')
            .replace(/{unsubscribe}/g, 'To unsubscribe, reply with UNSUBSCRIBE');

          try {
            await sendEmail(rec.email, rec.name, from, fromName, personalizedSubject, personalizedBody, isHTML);
            results.sent++;
          } catch (err) {
            results.failed++;
            results.errors.push({ email: rec.email, error: typeof err === 'object' ? JSON.stringify(err) : err });
          }

          // Delay between sends
          if (i < recipients.length - 1) {
            await new Promise(r => setTimeout(r, delayMs));
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...results }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Test connection
  if (parsedUrl.pathname === '/test' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      brevo_key_set: !!BREVO_KEY,
      message: BREVO_KEY ? 'Server ready to send!' : 'Warning: BREVO_API_KEY not set'
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Mail Blaster Server running on port ${PORT}`);
  console.log(`Brevo API key: ${BREVO_KEY ? 'SET ✓' : 'NOT SET ✗'}`);
});
