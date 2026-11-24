import { expect, test } from '@playwright/test';

test('prepare mode fills the mock Greenhouse form and hands over', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Senior Product Manager, AI Platform' }).click();
  // The documents test may already have drafted and approved this package (shared demo data).
  const draft = page.getByRole('button', { name: 'Draft application' });
  if (await draft.isVisible()) {
    await draft.click();
    await expect(page.getByTitle('CV')).toBeVisible({ timeout: 30_000 });
  }
  const approve = page.getByRole('button', { name: 'Approve package' });
  if (await approve.isVisible()) await approve.click();
  await page.getByRole('button', { name: 'Apply with agent' }).click();
  await expect(page.getByText('Prepared, waiting for you')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('img', { name: 'Screenshot of the application form' })).toBeVisible();
  await page.getByRole('button', { name: 'I submitted it' }).click();
  await expect(page.getByRole('list', { name: 'Application status' }).getByText('Applied')).toBeVisible();
});
