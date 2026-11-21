import { expect, type Page, test } from '@playwright/test';

/** Notes are driven through the test-only FakeMidiInput (`?fakeMidi=1`). */
async function chord(page: Page, notes: number[]) {
  await page.evaluate((n) => window.__fakeMidi?.chord(n), notes);
}

const CORRECT = '#16a34a';
const FLAWED = '#d97706';

async function countFilled(page: Page, color: string) {
  return page.locator(`[data-testid="score"] svg [fill="${color}"]`).count();
}

test('wait mode advances on correct notes, colours them, and holds on wrong ones', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?fakeMidi=1');

  const counter = page.getByTestId('step-counter');
  await expect(counter).toHaveText(/^1 \/ \d+$/);
  await expect(page.locator('[data-testid="score"] svg').first()).toBeVisible();
  const cursor = page.locator('[data-testid="score"] img').first();
  const startX = await cursor.evaluate((el) => el.getBoundingClientRect().left);

  // Ode to Joy, both hands: step 1 is E4 + C3/E3.
  await chord(page, [64, 48, 52]);
  await expect(counter).toHaveText(/^2 \//);
  expect(await countFilled(page, CORRECT)).toBe(3);
  const movedX = await cursor.evaluate((el) => el.getBoundingClientRect().left);
  expect(movedX).toBeGreaterThan(startX);

  // A wrong note is counted but does not advance.
  await chord(page, [61]);
  await expect(page.getByTestId('stats')).toContainText('✗ 1');
  await expect(counter).toHaveText(/^2 \//);

  // Step 2 is E4 alone; it completes as "flawed" because of the wrong note.
  await chord(page, [64]);
  await expect(counter).toHaveText(/^3 \//);
  expect(await countFilled(page, FLAWED)).toBe(1);

  // Right hand only: the left hand is no longer required.
  await page.getByRole('button', { name: 'Right' }).click();
  await chord(page, [65]); // F4
  await expect(counter).toHaveText(/^4 \//);

  // Restart clears progress and colours.
  await page.getByRole('button', { name: 'Restart' }).click();
  await expect(counter).toHaveText(/^1 \//);
  expect(await countFilled(page, CORRECT)).toBe(0);

  expect(errors).toEqual([]);
});

test('a released note drops out of the chord after the window, and turns black again', async ({
  page,
}) => {
  await page.goto('/?fakeMidi=1');
  const counter = page.getByTestId('step-counter');
  await expect(counter).toHaveText(/^1 \//);
  // Step 1 needs E4 + C3 + E3. Strike E4 and let go, then wait past the 250 ms window.
  await chord(page, [64]);
  expect(await countFilled(page, CORRECT)).toBe(1);
  await page.waitForTimeout(400);
  await chord(page, [48, 52]);
  await expect(counter).toHaveText(/^1 \//);
  expect(await countFilled(page, CORRECT)).toBe(2); // C3 and E3 only; E4 is black again
  await chord(page, [64]);
  await expect(counter).toHaveText(/^2 \//);
});

test('the on-screen keyboard plays notes', async ({ page }) => {
  await page.goto('/?fakeMidi=1');
  await expect(page.getByTestId('step-counter')).toHaveText(/^1 \//);
  await page.getByRole('button', { name: 'Right' }).click();
  await page.locator('.key[data-note="64"]').click();
  await expect(page.getByTestId('step-counter')).toHaveText(/^2 \//);
});

test('the computer keyboard plays notes (D = E4)', async ({ page }) => {
  await page.goto('/?fakeMidi=1');
  await expect(page.getByTestId('step-counter')).toHaveText(/^1 \//);
  await page.getByRole('button', { name: 'Right' }).click();
  await page.keyboard.press('KeyD');
  await expect(page.getByTestId('step-counter')).toHaveText(/^2 \//);
});
