import type { NpcDefinition } from '../types';

/**
 * Clockwork Harbor's cast (`docs/regions/clockwork.md` section 4).
 *
 * Two NPCs, both already standing in the 3D region
 * (`clockworkHarborRegion.ts`'s `NPC_SPOTS`) but until now with no domain
 * definition behind them - so the region could show them and open a
 * conversation panel for them, and there was nothing for either to say. These
 * are those definitions.
 *
 * Professor Ticktock is the harbor's hint-giver (section 4: "He helps the
 * child reason through problems rather than immediately providing answers").
 * He offers no quest yet, because the Socratic hint work of section 15 is not
 * built; what he does here is stay in character and point at what is
 * happening, which is honest for a character a child can already walk up to.
 */
export const CLOCKWORK_HARBOR_NPCS: NpcDefinition[] = [
  {
    id: 'harbor-master',
    displayName: 'The Harbor Master',
    role: 'Keeper of the harbor gate at Clockwork Harbor. Offers the lighthouse repair quest.',
    homeLocationSlug: 'clockwork-harbor',
    interactionId: 'meet-the-harbor-master',
    schedule: [
      { timeOfDay: 'MORNING', locationSlug: 'clockwork-harbor' },
      { timeOfDay: 'AFTERNOON', locationSlug: 'clockwork-harbor' },
      { timeOfDay: 'EVENING', locationSlug: 'clockwork-harbor' },
    ],
    dialogue: [
      {
        id: 'harbor-master-lighthouse-thanks',
        conditions: [{ type: 'MEMORY_FLAG', flag: 'lighthouseLit', equals: true }],
        text: 'You got the old lamp turning! Ships have been coming in all morning. I will not forget it.',
        choices: [{ id: 'harbor-master-thanks-bye', label: 'I am glad it works!' }],
        awardsRelationshipPoints: 3,
        narration: {
          allowedTopic: 'thanking the child for relighting the harbor lighthouse',
          fallbackText:
            'You got the old lamp turning! Ships have been coming in all morning. I will not forget it.',
        },
      },
      {
        id: 'harbor-master-lighthouse-offer',
        conditions: [{ type: 'RELATIONSHIP_AT_LEAST', level: 'ACQUAINTANCE' }],
        text: 'I cannot open the gate while the lighthouse is dark. It would not be safe. The machine inside stopped, and I am no good with machines. Would you take a look?',
        choices: [
          { id: 'harbor-master-accept', label: 'Yes, let us fix it!' },
          { id: 'harbor-master-later', label: 'Maybe later.' },
        ],
        setsMemoryFlags: ['heardAboutLighthouse'],
        awardsRelationshipPoints: 1,
        narration: {
          allowedTopic: 'asking the child for help restarting the lighthouse machine',
          fallbackText:
            'I cannot open the gate while the lighthouse is dark. Would you take a look at the machine?',
        },
      },
      {
        id: 'harbor-master-greeting',
        conditions: [],
        text: 'Welcome to Clockwork Harbor. It is quieter than it should be, I am afraid. Half the town has stopped ticking.',
        choices: [
          {
            id: 'harbor-master-greeting-ask',
            label: 'What happened here?',
            nextNodeId: 'harbor-master-lighthouse-story',
          },
          { id: 'harbor-master-greeting-bye', label: 'I will look around.' },
        ],
        setsMemoryFlags: ['metHarborMaster'],
        awardsRelationshipPoints: 1,
        narration: {
          allowedTopic: 'welcoming the child to a harbor town whose machines have stopped',
          fallbackText:
            'Welcome to Clockwork Harbor. It is quieter than it should be. Half the town has stopped ticking.',
        },
      },
      {
        /*
          The follow-up to "What happened here?". `followUpOnly` keeps it out
          of the opening-line selection, the same way Pip's bridge story works
          - and it is the un-gated route to `heardAboutLighthouse`, so a child
          who has not built a relationship yet can still start the quest.
        */
        id: 'harbor-master-lighthouse-story',
        followUpOnly: true,
        conditions: [{ type: 'ALWAYS' }],
        text: 'The lighthouse stopped, is what happened. No light, no safe way in, so the gate stays shut and the ships wait out there in the dark. The machine that turns it is inside, and it is beyond me.',
        choices: [{ id: 'harbor-master-story-bye', label: 'I could take a look.' }],
        setsMemoryFlags: ['heardAboutLighthouse'],
        narration: {
          allowedTopic: 'explaining that the harbor gate stays shut while the lighthouse is dark',
          fallbackText:
            'The lighthouse stopped. No light, no safe way in, so the gate stays shut and the ships wait.',
        },
      },
    ],
    questOffers: [
      {
        questId: 'light-the-harbor',
        summary: 'Help the Harbor Master get the lighthouse turning again.',
        conditions: [],
      },
    ],
  },
  {
    id: 'professor-ticktock',
    displayName: 'Professor Ticktock',
    role: 'Inventor at Clockwork Harbor. Explains how the harbor machinery works.',
    homeLocationSlug: 'clockwork-harbor',
    interactionId: 'meet-professor-ticktock',
    schedule: [
      { timeOfDay: 'MORNING', locationSlug: 'clockwork-harbor' },
      { timeOfDay: 'AFTERNOON', locationSlug: 'clockwork-harbor' },
      { timeOfDay: 'EVENING', locationSlug: 'clockwork-harbor' },
    ],
    dialogue: [
      {
        id: 'ticktock-after-lighthouse',
        conditions: [{ type: 'MEMORY_FLAG', flag: 'lighthouseLit', equals: true }],
        text: 'The lamp is turning! Good. But listen - that is not the real trouble. Something much older, much further down, is running badly. Can you hear it?',
        choices: [{ id: 'ticktock-listen', label: 'I can hear it.' }],
        awardsRelationshipPoints: 2,
        narration: {
          allowedTopic: 'hinting that something older beneath the harbor is still failing',
          fallbackText:
            'The lamp is turning! But that is not the real trouble. Something older, further down, is running badly.',
        },
      },
      {
        id: 'ticktock-greeting',
        conditions: [],
        text: 'Gears, gears, gears. Everything here runs on them, and lately they run backward, or not at all. I have three notebooks full of it and no answer yet.',
        choices: [
          { id: 'ticktock-greeting-ask', label: 'What do the notebooks say?' },
          { id: 'ticktock-greeting-bye', label: 'I will let you work.' },
        ],
        awardsRelationshipPoints: 1,
        narration: {
          allowedTopic: 'an inventor puzzling over harbor machinery that has started failing',
          fallbackText:
            'Gears, gears, gears. Everything here runs on them, and lately they run backward, or not at all.',
        },
      },
    ],
    questOffers: [],
  },
];
