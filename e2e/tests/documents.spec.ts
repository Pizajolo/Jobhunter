import { expect, test } from '@playwright/test';

test('drafts, previews, edits and approves an application package', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Senior Product Manager, AI Platform' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Senior Product Manager, AI Platform' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Why it matches' })).toBeVisible();
  await page.getByRole('button', { name: 'Draft application' }).click();
  await expect(page.getByTitle('CV')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Cover letter' }).click();
  await expect(page.getByText('Dear Lumen Robotics hiring team,')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Paragraph 1' }).fill('Your AI Platform role is exactly the kind of work I want to do next.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Version 2 · EN')).toBeVisible();
  await page.getByRole('tab', { name: /Form answers/ }).click();
  await expect(page.getByText('Not in your profile — answer this yourself').first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve package' }).click();
  await expect(page.getByRole('button', { name: 'Apply with agent' })).toBeVisible();
  await page.goto('/approvals');
  await expect(page.getByRole('heading', { name: /Packages to review/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Senior Product Manager, AI Platform' })).toHaveCount(0);
});
