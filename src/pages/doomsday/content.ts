// DoomsDay Diaries: the official rules and terms, from the Organiser's "Terms and Conditions
// and Official Rules" (6 Nov 2026). Lines changed to match how registration works on the
// website are marked CHANGED; keep the official PDF in step with them.
// The story brief (and the comic's title and hashtag) is not here: it's kept on the server
// (server/services/briefs.ts) and shown only to approved teams.
// Text uses the small Markdown of RichText: **bold**, lists with "1." or "-".

export const INSTAGRAM = 'eldenacademicpress';

/** One line for the public page: what you make, without giving the story away. */
export const HOOK = 'Form a team, create an original hero and make a comic of at least 40 pages. The story brief is revealed once your team is approved.';

/** How it works, for the public page. */
export const STEPS: [string, string][] = [
  ['Register your team', 'Sign in with Google and register 2 to 4 members in one form, with a Writer and an Artist at least.'],
  ['Get approved', 'We check every registration, usually within 48 hours, and email you.'],
  ['Unlock the brief', 'Your team page opens the secret story brief. Make your comic and upload it by the deadline.'],
];

export const RULES_SHORT = `1. **Who can enter:** students and members of schools, colleges and other institutions in India, aged 8 to 24 on 6 November 2026. Entry is free.
2. **Teams only:** solo entries are not accepted. A team has 2 to 4 members. School and college teams are from the same school or college; teams from other institutions may mix. Every team needs a Writer and an Artist.
3. **Approval first:** after you register, the Organiser checks your details. The competition section opens only after your registration is approved.
4. **One team per person.** Duplicate or fake entries are removed.
5. **No mixed teams:** members under 18 and members aged 18 or above cannot be on the same team.
6. **Comic length:** at least 40 story pages.
7. **Follow us:** every team member aged 13 or above must follow the Elden Academic Press Instagram page, @${INSTAGRAM}.
8. **Original work only:** Doctor Doom is the only existing character allowed. Your hero, your General and your story must be 100% original. No tracing.
9. **No AI:** no AI-generated images or AI-written story or dialogue. Upload your rough sketches as proof.
10. **Keep it clean:** no gore, no hate, no real people or politicians.
11. **Language:** English, Hindi or a mix. Any medium: pencil, ink, colour or digital.
12. **Your comic stays yours.** Elden Academic Press may display it with credit.
13. **The judges’ decision is final.**`;
// CHANGED from the PDF: rule 2 (other institutions may mix), rule 7 (the handle).

export const KEY_DATES: [string, string][] = [
  ['Registrations open', '6 Nov 2026 (open now)'],
  ['Registration review by the Organiser', 'Usually within 48 hours of registering'],
  ['Competition section unlocks', 'As soon as the registration is approved'],
  ['Last date to register and confirm a team', '5 Dec 2026, 11:59 PM'],
  ['Submission deadline', '5 Dec 2026, 11:59 PM'],
  ['Screening and judging', '6 to 9 Dec 2026'],
  ['Shortlist announced, live draw calls', '10 to 11 Dec 2026'],
  ['People’s Choice voting on Instagram', '12 to 14 Dec 2026'],
  ['Results announced', '15 Dec 2026'],
];

export const WHO_CAN_ENTER = 'The competition is open only to teams from schools, colleges and other institutions in India, such as coaching centres, art academies, clubs and NGOs. Members must be aged 8 to 24 on 6 November 2026. Entry is free. Solo entries are not accepted.';

export const TEAMS_AND_ROLES = `1. The person registering (the team captain, a teacher or a parent) registers the whole team on eldenap.in in one form: the team name, the school, college or institution, and every member with their details, roles and ID document.
2. The Organiser reviews every registration, usually within 48 hours. It may ask for changes or more information, such as a student or member ID, a letter from the institution or a teacher’s contact.
3. The Competition section, including submission, unlocks only after the registration is approved. The Organiser may reject a registration.
4. A team has 2 to 4 members. Solo entries are not accepted.
5. In a school or college team, all members are students of the same school or college. A team from another institution (a coaching centre, art academy, club or NGO) may have members from different institutions. One institution may enter more than one team.
6. Every member is given one or more of these roles: Writer, Artist (pencils and inks), Colourist, Letterer.
7. Every team must have a Writer and an Artist. One person may hold more than one role.
8. A person may be a member of only one team in this competition.
9. A team cannot include both members under 18 and members aged 18 or above.
10. Team names must be clean and must not copy a brand, a film, a real person or another team. The Organiser may change or reject a team name.
11. Team members cannot be added or changed after 5 December 2026, 11:59 PM IST.`;
// CHANGED from the PDF: one registration form for the whole team (no email invites,
// no 7-day acceptance), and other institutions may mix (rule 5).

export const PROFILES_AND_CHECKS = `- Every member gives their real name, date of birth, school, college or institution, and an email address or phone number (for members under 18, a parent’s or guardian’s name, number and consent).
- Every member uploads an ID document when registering: a school or college ID card, a letter from the institution, a masked Aadhaar (only the last 4 digits showing) or another government photo ID. Aadhaar is never required.
- Duplicate profiles, duplicate entries and false details are checked automatically and by the Organiser. They may lead to removal of a member or disqualification of a team.
- Shortlisted entrants must show a school, college, institution or other photo ID with their date of birth when asked. Aadhaar is never required.
- Employees of the Organiser and their immediate families may enter but cannot win prizes.`;
// CHANGED from the PDF: an ID document for every member at registration (second point).

export const PAGES = `1. **Minimum 40 story pages, maximum 60.** The cover, title page and credits page do not count towards the 40.
2. A page is one portrait A4 sheet (or the same shape in digital art).
3. Every story page has at least 2 panels. A full-page splash panel is allowed on up to 4 pages.
4. Pages are numbered in order, starting from 1 on the first story page.
5. The credits page names the team and each member’s role. No surnames, addresses or phone numbers on any page.
6. Any medium is allowed: pencil, ink, crayon, paint or digital. Colour or black and white.
7. Dialogue and captions in English, Hindi or a mix.`;

export const FILES = `1. The person who registered the team, or the team captain, uploads on behalf of the team.
2. Upload one PDF of the full comic (maximum 100 MB).
3. Hand-drawn pages are scanned or photographed flat, in good light, readable at 150 dpi or more.
4. **Proof of work is required:** one PDF of your rough pencil sketches or layouts, at least 40 pages. Digital artists upload screenshots of the working files with layers.
5. The team may replace its files until the deadline. The last upload before the deadline is judged.
6. Keep your original pages and files safe until results. The Organiser may ask to see them.
7. Uploads that fail because of slow internet near the deadline are the team’s risk. Upload early.`;
// CHANGED from the PDF: rule 1 (who uploads), rule 2 (one PDF; no per-page images),
// rule 4 (a 40-page sketch PDF instead of sketches for 5 pages).

export const INSTAGRAM_RULES = `Every team member aged 13 or above must follow the official Elden Academic Press Instagram page, @${INSTAGRAM}, and keep following it until results are announced on 15 December 2026.

1. Each member aged 13 or above enters their Instagram username when the team registers.
2. Instagram does not allow accounts for children under 13. Members under 13 do not need an account. A parent or guardian may follow the page on their behalf.
3. The Organiser may check follows at the shortlist stage. A shortlisted member aged 13 or above who is not following may be asked to follow within 24 hours, and a team may be disqualified if they do not.
4. People’s Choice votes are the likes on the Organiser’s official post for each shortlisted comic. Bought likes, bot accounts or like-exchange groups lead to disqualification.
5. Teams may share their own entry on social media after submitting. Tag @${INSTAGRAM} and use the hashtag given with the story brief.
6. This competition is not sponsored, endorsed, administered by or associated with Instagram or Meta. Every entrant releases Instagram and Meta from any liability connected with it.`;

export const ORIGINAL = `1. The hero, the General, the story, the dialogue and the art must be created by the team members for this competition.
2. No other existing characters from films, comics, cartoons, anime, games or books. This includes all other Marvel and DC characters.
3. No tracing, copying or reusing art made by someone else. No logos or brand names as part of the art.
4. No comic that has been published, submitted elsewhere or won a prize before.`;
export const NO_AI = `1. No AI-generated or AI-edited images, backgrounds or characters.
2. No AI-written story, script or dialogue. Spell check is allowed.
3. The Artist of every shortlisted team joins a 10 to 15 minute video call and draws their hero live. Not attending, or not being able to draw in the style of the entry, may lead to disqualification.
4. The Organiser may use AI-detection tools and expert review. Its decision on AI use is final.`;
export const CLEAN = `1. Action and fights are fine. No blood, gore, sexual content, drugs, alcohol or smoking.
2. No hate or mockery based on religion, caste, region, language, gender, body or disability.
3. No real people, politicians, celebrities, officials or real businesses as characters.
4. No real-life weapons instructions or dangerous stunts shown as something to copy.`;

export const CRITERIA: [string, number][] = [
  ['Story and writing', 30], ['Originality of the hero and the General', 20], ['Art and drawing', 25], ['Panel flow and pacing', 15], ['Lettering and readability', 10],
];
export const JUDGING = `1. A panel of judges chosen by the Organiser scores every valid entry.
2. The top 10 teams in each age group are shortlisted and announced on 10 December 2026.
3. Shortlisted teams complete the live draw call (see No AI) and the ID check.
4. For every shortlisted member under 18, a parent or guardian fills a short online form within 48 hours. It confirms permission to display the comic and to receive the prize.
5. Ties are broken by the higher Story and writing score.
6. People’s Choice is decided separately in each age group by likes on the Organiser’s Instagram posts, 12 to 14 December 2026. It does not change the judges’ scores.
7. The judges’ and the Organiser’s decisions are final. No correspondence about scores will be entered into.`;

export const PRIZES: [string, string][] = [
  ['1st, 2nd and 3rd place', 'Movie tickets or movie e-vouchers for up to 4 team members, plus a Doomsday Survival Kit for each member'],
  ['Junior Heroes winners only', 'One extra ticket for a parent or guardian of each winning member'],
  ['People’s Choice', 'A bonus hamper for the team'],
  ['Every valid entry', 'E-certificate of participation for each member'],
];
export const PRIZE_RULES = `1. Tickets or e-vouchers are for a film, city and show chosen by the Organiser. They are sent to the team’s registered email or phone.
2. Prizes cannot be exchanged for cash or transferred to another person.
3. The Organiser may replace a prize with one of similar value if it becomes unavailable.
4. The team decides how to share a team prize. The Organiser is not part of any dispute within a team.
5. Prizes are sent within 30 days of the results. A winner who does not respond within 7 days of being contacted may lose the prize.
6. Any tax on a prize is the winner’s responsibility.`;

export const TERMS: [string, string][] = [
  ['1. Organiser', 'The competition “DoomsDay Diaries” is run by Elden Academic Press, the publishing imprint of The Elden Heights School, Silwar, Hazaribagh, Jharkhand (“the Organiser”). Contact: hello@eldenap.in. Website: eldenap.in.'],
  ['2. Ownership of entries', `1. The team keeps the copyright in its own hero, General, story, dialogue and art.
2. Each team member gives the Organiser a free, non-exclusive, worldwide licence for 3 years to display, reproduce and share the entry, in full or in part, on eldenap.in, on the Organiser’s social media and in a free digital showcase. Credit is given as first name, age group and city.
3. The Organiser will not sell the comics or use them in paid products.
4. Doctor Doom is a character and trademark of Marvel. No entrant and no part of this competition claims any right in him.
5. Each team member confirms that the entry is the team’s own work and does not break anyone else’s rights. The team is responsible for any claim that it does.`],
  ['3. Team responsibility', `1. The person who registers the team does so on behalf of all members, and the team captain submits on behalf of the team. Every member is bound by these Terms.
2. If any member breaks the rules, the whole team may be disqualified.
3. Disagreements within a team are for the team to settle.`],
  ['4. Personal data', `1. The Organiser collects name, date of birth, email, phone number, city, school, college or institution, Instagram username, an ID document for each member, and a parent’s or guardian’s details for members under 18.
2. This data is used to run the competition, check eligibility, contact entrants, deliver prizes and send updates from Elden Academic Press. Anyone can unsubscribe from updates at any time.
3. The data is never sold. It is shared only with service providers who help run the competition, such as email and ticketing services.
4. Entry data is deleted within 12 months of the results, except credits shown publicly with permission.
5. To see, correct or delete your data, write to hello@eldenap.in.
6. Entrants under 18 should take part with the knowledge of a parent or guardian.`],
  ['5. Disqualification', `The Organiser may remove a member or disqualify a team, before or after results, for:

- false details, fake or duplicate profiles or entries
- copied, traced or AI-generated work
- breaking the content or originality rules
- fake likes or any attempt to cheat the vote
- abusive behaviour towards judges, staff or other entrants
- any other breach of these rules

A prize given to a team later found ineligible may be taken back.`],
  ['6. Changes and cancellation', 'The Organiser may change these rules, the dates or the prizes, or pause or cancel the competition, if needed for reasons outside its control. Changes are posted on eldenap.in and the official Instagram page.'],
  ['7. Liability', `1. The Organiser is not responsible for failed uploads, lost or corrupted files, internet or device problems, or emails that do not arrive.
2. The Organiser is not responsible for any loss or injury connected with the competition, except where the law does not allow this to be excluded.
3. The Organiser’s total liability to any entrant is limited to the value of the prize that entrant could have won.`],
  ['8. Disclaimers', `- This competition is not affiliated with, sponsored or endorsed by Marvel Studios, Marvel Entertainment or The Walt Disney Company.
- This competition is not sponsored, endorsed, administered by or associated with Instagram or Meta.`],
  ['9. Law and disputes', 'These Terms are governed by the laws of India. Any dispute is subject to the courts at Hazaribagh, Jharkhand.'],
  ['10. Contact', 'Questions about the competition: hello@eldenap.in.'],
];
// CHANGED from the PDF: 1 (named by the competition, not the story), 3.1 (who registers and
// submits) and 4.1 (ID documents and guardian details are collected).
