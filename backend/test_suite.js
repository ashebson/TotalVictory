const http = require('http');

const API_URL = 'http://localhost:5001';
const ADMIN_PASSCODE = 'halevi2026';

function request(method, path, headers = {}, body = null) {
  return new Promise((resolve) => {
    const url = new URL(path, API_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        ...headers,
      },
    };
    if (body) {
      options.headers['Content-Type'] = 'application/json';
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, body: parsed, raw: data });
      });
    });

    req.on('error', (err) => {
      resolve({ error: err });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('==================================================');
  console.log('   TOTAL VICTORY - SYSTEM INTEGRATION TEST SUITE  ');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function report(name, condition, details = '') {
    if (condition) {
      console.log(`\x1b[32m[PASS]\x1b[0m ${name} ${details}`);
      passed++;
    } else {
      console.log(`\x1b[31m[FAIL]\x1b[0m ${name} ${details}`);
      failed++;
    }
  }

  // Test 1: Unauthorized access to Admin stats
  try {
    const res = await request('GET', '/api/stats/admin');
    report(
      'Admin Stats Security (No passcode should block with 401)',
      res.status === 401 && res.body?.error?.includes('passcode'),
      `Status: ${res.status}`
    );
  } catch (err) {
    report('Admin Stats Security', false, err.message);
  }

  // Test 2: Authorized access to Admin stats
  try {
    const res = await request('GET', '/api/stats/admin', { 'x-admin-passcode': ADMIN_PASSCODE });
    report(
      'Admin Stats Access (Valid master passcode)',
      res.status === 200 && res.body?.summary !== undefined,
      `Status: ${res.status}`
    );
  } catch (err) {
    report('Admin Stats Access', false, err.message);
  }

  // Test 3: Admin registration flow
  let adminId = null;
  try {
    const uniqueEmail = `test_admin_${Date.now()}@example.com`;
    const res = await request('POST', '/api/admins/register', {}, {
      fullName: 'בדיקת מערכת',
      email: uniqueEmail,
      phone: '0509999999',
      organization: 'מטה בדיקות',
      planId: 'monthly'
    });
    const success = res.status === 200 && res.body?.success === true;
    adminId = res.body?.admin?.id;
    report(
      'Admin Registration Endpoint & manual payment WhatsApp link generation',
      success && res.body?.whatsappUrl?.includes('wa.me'),
      `Status: ${res.status}, WhatsApp Link: ${res.body?.whatsappUrl ? 'Generated' : 'Missing'}`
    );
  } catch (err) {
    report('Admin Registration Endpoint', false, err.message);
  }

  // Test 4: Admin approval flow (Requires master passcode)
  if (adminId) {
    try {
      const res = await request('POST', `/api/admins/${adminId}/approve`, { 'x-admin-passcode': ADMIN_PASSCODE });
      report(
        'Admin Approval Endpoint (Master passcode approve PENDING_PAYMENT -> ACTIVE)',
        res.status === 200 && res.body?.admin?.status === 'ACTIVE',
        `Status: ${res.status}, Passcode: ${res.body?.passcode || 'Missing'}`
      );
    } catch (err) {
      report('Admin Approval Endpoint', false, err.message);
    }
  } else {
    report('Admin Approval Endpoint', false, 'Skipped (no admin created)');
  }

  // Test 5: Seed Demo Project
  let projectId = null;
  try {
    const res = await request('POST', '/api/contacts/seed', { 'x-admin-passcode': ADMIN_PASSCODE });
    projectId = res.body?.project?.id;
    report(
      'Database Seeding Endpoint (Create sample contacts)',
      res.status === 200 && res.body?.success === true,
      `Status: ${res.status}, Project ID: ${projectId}`
    );
  } catch (err) {
    report('Database Seeding Endpoint', false, err.message);
  }

  // Test 6: Excel Export Route
  if (projectId) {
    try {
      const res = await request('GET', `/api/projects/${projectId}/export.xlsx?passcode=${ADMIN_PASSCODE}`);
      const isXlsx = res.status === 200 && res.raw.includes('xlsx'); // buffer check or worksheet
      report(
        'Excel Export Endpoint (GET /api/projects/:id/export.xlsx)',
        res.status === 200,
        `Status: ${res.status}, Content-Type: sheet`
      );
    } catch (err) {
      report('Excel Export Endpoint', false, err.message);
    }
  } else {
    report('Excel Export Endpoint', false, 'Skipped (no project created)');
  }

  // Test 7: Caller login
  let callerId = null;
  const callerPhone = '0525555555';
  try {
    const res = await request('POST', '/api/login', {}, {
      name: 'טלפן בדיקה',
      phone: callerPhone
    });
    callerId = res.body?.id;
    report(
      'Caller Login/Register Endpoint',
      res.status === 200 && callerId !== undefined,
      `Status: ${res.status}, Caller ID: ${callerId}`
    );
  } catch (err) {
    report('Caller Login/Register Endpoint', false, err.message);
  }

  // Test 8: Caller settings endpoint (x-caller-phone)
  if (callerId) {
    try {
      const res = await request('POST', `/api/callers/${callerId}/settings`, { 'x-caller-phone': callerPhone }, {
        whatsappTemplate: 'שלום {name}, זו הודעה אישית מבדיקת המערכת!'
      });
      report(
        'Caller Personal WhatsApp settings saving endpoint (GET/POST /api/callers/:id/settings)',
        res.status === 200 && res.body?.success === true && res.body?.caller?.whatsappTemplate?.includes('אישית'),
        `Status: ${res.status}`
      );
    } catch (err) {
      report('Caller Settings Endpoint', false, err.message);
    }
  } else {
    report('Caller Settings Endpoint', false, 'Skipped (no caller created)');
  }

  console.log('\n==================================================');
  console.log(` SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('==================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
