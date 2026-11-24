import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testApp } from './support/helpers.js';
import { setupCode } from '../src/server/auth.js';

function cookies(res: { cookies: { name: string; value: string }[] }) {
  return Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
}

describe('server-mode login', () => {
  it('requires setup with the code from the log, then login, sessions and CSRF', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jh-auth-'));
    const { app, ctx } = await testApp({ mode: 'server', requireLogin: true, dataDir: dir });
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    const status = (await app.inject({ method: 'GET', url: '/api/auth/status' })).json();
    expect(status).toMatchObject({ required: true, setupNeeded: true, loggedIn: false });

    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { setupCode: 'wrong', password: 'a-very-long-password' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { setupCode: setupCode(ctx)!, password: 'short' } })).statusCode).toBe(400);
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { setupCode: setupCode(ctx)!, password: 'a-very-long-password' } });
    expect(setup.statusCode).toBe(200);
    const c = cookies(setup);
    const session = setup.cookies.find((x) => x.name === 'jh_session')!;
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe('Strict');

    const cookieHeader = `jh_session=${c.jh_session}; jh_csrf=${c.jh_csrf}`;
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie: cookieHeader } })).statusCode).toBe(200);
    // state-changing request without CSRF header is refused
    expect((await app.inject({ method: 'PATCH', url: '/api/settings', headers: { cookie: cookieHeader }, payload: { language: 'de' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: '/api/settings', headers: { cookie: cookieHeader, 'x-csrf-token': c.jh_csrf! }, payload: { language: 'de' } })).statusCode).toBe(200);

    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope' } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'a-very-long-password' } });
    expect(login.statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: cookieHeader, 'x-csrf-token': c.jh_csrf! } });
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie: cookieHeader } })).statusCode).toBe(401);
  });

  it('rate-limits login attempts', async () => {
    const { resetLoginAttempts } = await import('../src/server/auth.js');
    resetLoginAttempts();
    const { app } = await testApp({ mode: 'server', requireLogin: true, dataDir: mkdtempSync(join(tmpdir(), 'jh-auth-')) });
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'x' } })).statusCode;
    expect(last).toBe(429);
  });

  it('needs the CSRF token to change the password, and can be reset on start', async () => {
    const { resetLoginAttempts } = await import('../src/server/auth.js');
    resetLoginAttempts();
    const { app, ctx } = await testApp({ mode: 'server', requireLogin: true, dataDir: mkdtempSync(join(tmpdir(), 'jh-auth-')) });
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { setupCode: setupCode(ctx)!, password: 'a-very-long-password' } });
    const c = cookies(setup);
    const cookie = `jh_session=${c.jh_session}; jh_csrf=${c.jh_csrf}`;
    const payload = { current: 'a-very-long-password', password: 'another-long-password' };
    expect((await app.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie, 'x-csrf-token': c.jh_csrf! }, payload })).statusCode).toBe(200);
    // changing the password ends every session
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'another-long-password' } });
    const c2 = cookies(login);
    const cookie2 = `jh_session=${c2.jh_session}; jh_csrf=${c2.jh_csrf}`;
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie: cookie2 } })).statusCode).toBe(200);

    const { resetPasswordIfAsked } = await import('../src/server/auth.js');
    resetPasswordIfAsked(ctx); // without the variable: nothing happens
    expect((await app.inject({ method: 'GET', url: '/api/auth/status' })).json()).toMatchObject({ setupNeeded: false });
    process.env.JOBHUNTER_RESET_PASSWORD = '1';
    try {
      resetPasswordIfAsked(ctx);
    } finally {
      delete process.env.JOBHUNTER_RESET_PASSWORD;
    }
    expect((await app.inject({ method: 'GET', url: '/api/auth/status' })).json()).toMatchObject({ setupNeeded: true });
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie: cookie2 } })).statusCode).toBe(401);
    expect(setupCode(ctx)).toMatch(/^[0-9a-f]{8}$/u);
  });

  it('does not require login on the desktop', async () => {
    const { app } = await testApp();
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(200);
  });
});
