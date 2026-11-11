import { test } from '@playwright/test';

/**
 * Firepeak Volcano browser acceptance (FP-13; docs/FIREPEAK_VOLCANO_ROADMAP.md section 6).
 *
 * PREPARED, NOT EXECUTED. Every scenario is `test.fixme`, so the runner lists it as pending and
 * never reports it as passed. They need what this repository cannot provide in CI:
 * - a running Django API with Firepeak seeded and published (`seed_firepeak`, `publish_firepeak`);
 * - a build with `VITE_BACKEND=django`;
 * - a real Cognito test parent with a Pathfinder child (ADR-024 gate A6).
 *
 * To run one, provide those, replace `fixme` with a sign-in fixture, and fill in the steps below.
 * The selectors to use are the accessible names in the steps (the panels are plain buttons, so
 * every step also works without WebGL input).
 */

test.describe('Firepeak Volcano: The Volcano Awakens', () => {
  test.fixme('1. a child enters Firepeak from the Place page', async () => {
    // Travel deck > Firepeak Volcano > "Explore Firepeak Volcano"; expect the canvas and the
    // "Things to do here" list, with Professor Ember in it.
  });

  test.fixme('2. the child meets Professor Ember and accepts the quest', async () => {
    // Open "Professor Ember"; expect "Hello, explorer! I am Professor Ember."; press "Yes, I will help!".
  });

  test.fixme('3. the telescope activity completes', async () => {
    // Open "Telescope"; press "Crater", "Lava flow", "Steam vent"; press "Tell Professor Ember";
    // expect three Discovery Journal pages in the reward.
  });

  test.fixme('4. the bridge is repaired', async () => {
    // Open a "Gap in the crossing"; for each gap pick up the stone of its size and "Put it here";
    // press "Check the crossing"; expect "The crossing is safe now."
  });

  test.fixme('5. the child crosses the lava safely, and lava returns them to safety', async () => {
    // Walk along the stones to the far bank. Walk off the stones: expect "Whoa, the lava is too
    // hot! Back to safety." and the child back on the bank, with progress unchanged.
  });

  test.fixme('6. the steam puzzle is solved and the passage opens', async () => {
    // Open a valve; turn Red, Blue, Green; expect "Whoosh!" and the passage walkable.
  });

  test.fixme('7. the Heart Crystal is collected', async () => {
    // Open "Glowing crystal"; press "Pick up the glowing crystal"; expect the discovery animation,
    // then "You found the first Heart Crystal fragment!".
  });

  test.fixme('8. the child returns to Base Camp', async () => {
    // Open "Rope lift"; expect the child at Base Camp.
  });

  test.fixme('9. the adventure completes and grants rewards', async () => {
    // Open "Professor Ember"; press "Show Professor Ember the crystal"; expect the Volcano Explorer
    // Badge and "Quest complete! The Volcano Awakens"; the backpack lists the journal pages.
  });

  test.fixme('10. leaving halfway and resuming keeps progress', async () => {
    // After step 4, leave the island and come back: expect the child at the far bank, the bridge
    // built, and the steam puzzle open.
  });

  test.fixme('11. it works with touch controls', async () => {
    // Use a touch device profile: move with the left half, look with the right half, and use the
    // "Things to do here" list and the panels for every interaction above.
  });
});
