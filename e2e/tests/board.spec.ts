import { expect, test } from '@playwright/test';

test.describe('pipeline board', () => {
  test('shows the six columns with seeded cards', async ({ page }) => {
    await page.goto('/');
    for (const col of ['Found', 'Shortlisted', 'Ready to apply', 'Applied', 'Interview & offer', 'Closed']) {
      await expect(page.getByRole('region', { name: col, exact: true })).toBeVisible();
    }
    const found = page.getByRole('region', { name: 'Found', exact: true });
    await expect(found.getByRole('link', { name: 'Head of Product' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Closed', exact: true }).getByText('No response')).toBeVisible();
  });

  test('search filters cards', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox', { name: 'Search roles, companies…' }).fill('lumen');
    await expect(page.getByRole('link', { name: 'Senior Product Manager, AI Platform' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Head of Product' })).toHaveCount(0);
  });

  test('moves a card with the keyboard', async ({ page }) => {
    await page.goto('/');
    const handle = page.getByRole('button', { name: 'Move Venture Builder at Cobalt Energy' });
    await handle.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.press('Space');
    const shortlisted = page.getByRole('region', { name: 'Shortlisted', exact: true });
    await expect(shortlisted.getByRole('link', { name: 'Venture Builder' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Shortlisted', exact: true }).getByRole('link', { name: 'Venture Builder' })).toBeVisible();
  });

  test('chat answers and proposes a confirmed change', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Chat' }).click();
    await page.getByRole('textbox', { name: 'Ask or tell Jobhunter something…' }).fill('stop showing me consulting roles');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Chat with Jobhunter' });
    await expect(panel.getByText('search.exclusions')).toBeVisible();
    await panel.getByRole('button', { name: 'Apply change' }).click();
    await expect(panel.getByText('Applied', { exact: true })).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByRole('textbox', { name: 'Exclude keywords' })).toHaveValue('consulting');
  });

  test('every main screen renders', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const path of ['/approvals', '/review', '/inbox', '/stats', '/profile', '/settings', '/diagnostics']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});
