// The story brief of each team competition. It lives on the server and is sent only to teams
// the organiser has approved: the public page, the rules page and the website's code don't
// name it. Text uses the small Markdown of RichText: **bold**, lists with "1." or "-".

export interface StoryBrief {
  /** The comic's title, e.g. "Doom Picked the Wrong Town". */
  title: string;
  lead: string;
  story: string;
  /** What every comic must include. */
  mustInclude: string;
  /** Teams use it when they share their entry. */
  hashtag: string;
}

const BRIEFS: Record<string, StoryBrief> = {
  'doomsday-diaries': {
    title: 'Doom Picked the Wrong Town',
    lead: 'Doom picked the wrong town. He has 24 hours. Your town has one hero. Draw them.',
    story: 'At midnight, the sky cracks open over your streets. Every screen in the city flashes one message: “24 HOURS. THEN YOUR TOWN IS MINE.” The world’s heroes are too far away. Your town has one chance: a hero nobody has heard of. Yet.',
    mustInclude: `1. **An original hero** from your town, with a name, a power and a reason to fight.
2. **An original General:** the monster or warrior Doctor Doom sends first to attack your town. You design it and name it.
3. **Doctor Doom** as the villain behind the attack. He may appear in the story, but your hero and your General must be the stars.
4. **A real town or city in India,** ideally your own, with places a reader could recognise.
5. **A 24-hour story:** the threat begins and ends within one day.`,
    hashtag: '#DoomPickedTheWrongTown',
  },
};

export const briefFor = (slug: string): StoryBrief | null => BRIEFS[slug] ?? null;
