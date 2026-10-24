// Lore, legends and unsolved mysteries in Salem and Rockport.
// Each story is tied to a place. `place` points at one of our hand-picked
// places; otherwise the entry is a place of its own (shown with a skull).
// `kind` is how sure we are: a true story, a legend, a ghost story, or unsolved.

export const LORE_KINDS = {
  unsolved: 'Unsolved',
  legend: 'Legend',
  ghost: 'Ghost story',
  true: 'True story',
};

export const LORE = [
  // ---- Salem
  {
    place: 'proctors-ledge', town: 'salem', kind: 'unsolved', title: 'Where are the victims buried?',
    story: 'Nineteen people were hanged here in 1692; historians confirmed the spot only in 2016. What happened to their bodies is still unknown. Tradition says they were left in a shallow crevice in the ledge and that some families came back at night to carry their loved ones home, but no graves have ever been found, and the rocky ground makes burial here unlikely.',
  },
  {
    place: 'trials-memorial', town: 'salem', kind: 'unsolved', title: 'What really caused the "afflictions"?',
    story: 'In 1692 a group of girls suffered fits, pains and visions that set off the witch trials. Nobody knows why. Theories include ergot, a fungus on rye that causes convulsions and hallucinations (proposed in 1976), mass hysteria, fraud, and bitter land feuds between Salem Village families. Each theory explains some of what happened, and none explains all of it.',
  },
  {
    place: 'howard-st-cemetery', town: 'salem', kind: 'legend', title: 'The curse of Giles Corey',
    story: 'Eighty-one-year-old Giles Corey refused to enter a plea and was pressed to death under heavy stones near here in September 1692, the only person in America executed that way. Legend says he cursed Sheriff George Corwin and the town as he died. Corwin died of a heart attack a few years later, later sheriffs were said to suffer heart and blood ailments, and Corey’s ghost is said to walk this cemetery before disasters, including the night before the Great Salem Fire of 1914.',
  },
  {
    id: 'joshua-ward-house', name: 'Joshua Ward House', town: 'salem', kind: 'ghost', title: 'The sheriff in the cellar',
    addr: '148 Washington St, Salem, MA', lat: 42.5203217, lng: -70.8953287, mins: 10,
    story: 'This 1780s house stands on the site of the home of Sheriff George Corwin, who seized the property of the accused in 1692. When he died in 1696, his family is said to have buried him in the cellar, fearing angry townspeople, before he was moved to the Broad Street Cemetery. Often called Salem’s most haunted house, with tales of doors locking themselves, candles melting unlit, and cold hands at the throat. It’s private offices now, so view it from the street.',
  },
  {
    id: 'lyceum-hall', name: 'Lyceum Hall (Bridget Bishop’s orchard)', town: 'salem', kind: 'ghost', title: 'Bridget Bishop’s apple orchard',
    addr: '43 Church St, Salem, MA', lat: 42.5224278, lng: -70.8952659, mins: 10,
    story: 'This lot was once the apple orchard of Bridget Bishop, the first person hanged in 1692. The Lyceum Hall built here later hosted a true piece of history: Alexander Graham Bell’s first public demonstration of the telephone in 1877. Staff at the restaurant inside tell of a woman’s ghost, faint apple scents, and things moving on their own.',
  },
  {
    id: 'gardner-pingree-house', name: 'Gardner-Pingree House', town: 'salem', kind: 'true', title: 'The murder of Captain Joseph White',
    addr: '128 Essex St, Salem, MA', lat: 42.5222524, lng: -70.8915556, mins: 10,
    story: 'On April 7, 1830, wealthy 82-year-old Captain Joseph White was clubbed and stabbed in his bed here. The killer had been hired by relatives hoping for a bigger share of his fortune, and Daniel Webster prosecuted the case. The sensational trial is said to have influenced both Nathaniel Hawthorne and Edgar Allan Poe, whose "The Tell-Tale Heart" also features a murdered old man.',
  },
  {
    place: 'seven-gables', town: 'salem', kind: 'legend', title: '"God will give you blood to drink"',
    story: 'On the gallows in 1692, Sarah Good is said to have told the Reverend Nicholas Noyes: "If you take away my life, God will give you blood to drink." Legend says Noyes died 25 years later choking on his own blood. Hawthorne, whose great-great-grandfather was a trial judge, borrowed the curse for this house’s novel, where the dying Matthew Maule curses the Pyncheon family.',
  },
  {
    place: 'ropes-mansion', town: 'salem', kind: 'ghost', title: 'Abigail Ropes and the fire',
    story: 'In 1839 Abigail Ropes’s dress caught fire at a fireplace in this house, and she died of her burns weeks later. Her portrait hangs above a mantel inside. Visitors say a woman looks out of the upstairs windows, and in the movie Hocus Pocus it plays Allison’s house.',
  },
  {
    id: 'witch-jail-site', name: '1692 Witch Jail site', town: 'salem', kind: 'true', title: 'The witch jail',
    addr: 'Federal St at St. Peter St, Salem, MA', lat: 42.5235436, lng: -70.8938849, mins: 5,
    story: 'The jail that held the accused in 1692 stood at this corner. Prisoners paid for their own board and chains, and several died here before trial. When a later house on the site was torn down in 1956 for the telephone company, workers found the old jail’s oak timbers underneath. A plaque marks the spot.',
  },
  {
    place: 'burying-point', town: 'salem', kind: 'legend', title: 'Why Hawthorne added a "W"',
    story: 'Judge John Hathorne, the trials’ most relentless questioner and the only judge who never repented, is buried here. His great-great-grandson Nathaniel was so ashamed of him, the story goes, that he added a "w" to his name to become Hawthorne.',
  },
  {
    place: 'witch-house', town: 'salem', kind: 'true', title: 'The judge’s house',
    story: 'Judge Jonathan Corwin lived here in 1692, and it is the only building still standing with direct ties to the trials. Legend says accused witches were questioned in its rooms; there’s no record of that, but Corwin signed many of their arrest warrants.',
  },
  {
    place: 'hawthorne-hotel', town: 'salem', kind: 'ghost', title: 'The hotel on the sea captains’ lot',
    story: 'The hotel opened in 1925 on land once owned by the Salem Marine Society, a club of sea captains founded in 1766 that still meets in a recreated ship’s cabin on the roof. Guests and staff tell of a ghostly woman in the halls, phantom knocks, and a captain who never checked out.',
  },
  {
    place: 'bewitched-statue', town: 'salem', kind: 'true', title: 'How Samantha saved Salem’s Halloween',
    story: 'In 1970 the TV show Bewitched filmed eight episodes in Salem, and the city, long embarrassed by 1692, started to embrace its witchy image. This statue of Samantha went up in 2005. Some locals objected to a sitcom witch in a city where real people were executed, which is part of the story too.',
  },
  // ---- Rockport
  {
    id: 'thacher-island-view', name: 'Thacher Island twin lights (view)', town: 'rockport', kind: 'true', title: 'Thacher’s Woe',
    addr: 'Loblolly Cove, Rockport, MA', lat: 42.643151, lng: -70.5939318, mins: 15, daylight: true,
    story: 'In the Great Colonial Hurricane of August 1635, the boat Watch and Wait was wrecked on the island offshore. Twenty-one people drowned, including all of Anthony Thacher’s children; only he and his wife reached the island alive. The colony gave him the island, which he called "Thacher’s Woe." Its twin lighthouses, first lit in 1771, are the only working twin lights in the country.',
  },
  {
    place: 'bearskin-neck', town: 'rockport', kind: 'legend', title: 'The bear in the tide',
    story: 'Around 1700, the story goes, Ebenezer Babson saw a bear attacking his nephew on this neck of land. He lured the bear into the water and killed it with a fishing knife, then skinned it and left the hide on the rocks to dry, which gave the place its name. A painting of the fight is on the door of the Pewter Shop.',
  },
  {
    place: 'dock-square', town: 'rockport', kind: 'true', title: 'Hannah Jumper’s hatchet raid',
    story: 'On July 8, 1856, Hannah Jumper, a seamstress in her 70s, led about 200 people, mostly women, through town with hatchets. They smashed every keg and bottle they could find in 13 places that sold liquor. Rockport then stayed dry for about 150 years: restaurants could only serve drinks again after a 2005 vote.',
  },
  {
    id: 'rockport-congregational', name: 'First Congregational Church', town: 'rockport', kind: 'true', title: 'The cannonball in the steeple',
    addr: '12 School St, Rockport, MA', lat: 42.6578426, lng: -70.6188023, mins: 10,
    story: 'In the War of 1812, British barges slipped into Sandy Bay in the fog on September 8, 1814. When this church’s bell rang the alarm, a barge fired at the belfry to silence it. The ball hit a steeple timber instead, and the cannon’s recoil damaged the barge so badly that its crew were taken prisoner by the townsmen. A cannonball is still kept in the steeple.',
  },
  {
    id: 'gully-cove', name: 'Headlands & Gully Cove', town: 'rockport', kind: 'legend', title: 'Caleb Norwood’s pirate gold',
    addr: 'Gully Point Cove, Rockport, MA', lat: 42.660373, lng: -70.5989322, mins: 15, daylight: true,
    story: 'In 1752, the story goes, a 13-year-old named Caleb Norwood found buried pirate treasure at Gully Cove and grew up a rich man, building houses here on the Headlands. The Headland House, built in 1781, is said to be one of them; its later owner, the illustrator Harrison Cady, loved to boast that his home was built with pirates’ gold.',
  },
  {
    id: 'old-castle', name: 'The Old Castle', town: 'rockport', kind: 'true', title: 'Not a castle at all',
    addr: 'Castle Ln at Granite & Curtis Sts, Pigeon Cove, Rockport, MA', lat: 42.6760404, lng: -70.6248203, mins: 10,
    story: 'Built around 1712 by Jethro Wheeler, this weathered saltbox is one of the oldest houses on Cape Ann. Despite the grand nickname, it’s a plain timber saltbox. The Sandy Bay Historical Society runs it as a museum in summer, so in late October admire it from the road.',
  },
  {
    place: 'motif-1', town: 'rockport', kind: 'true', title: 'The most painted building in America',
    story: 'This red fishing shack has been painted so often that it’s called the most painted building in America, and it was nicknamed "Motif Number One" by artists. When the Blizzard of 1978 swept it into the harbor, the town rebuilt it exactly as it was within months.',
  },
  {
    place: 'paper-house', town: 'rockport', kind: 'true', title: 'A house made of newspapers',
    story: 'Starting in 1922, Elis Stenman built the walls of this summer house, and then the furniture, from layers of glued and varnished newspaper, about 100,000 papers in all. You can still read headlines in the walls, including ones about Charles Lindbergh’s flight.',
  },
  {
    place: 'halibut-point', town: 'rockport', kind: 'true', title: 'The tower watching for U-boats',
    story: 'The tall tower by the visitor center was a World War II fire-control station, built to spot German submarines and aim the big coastal guns. The deep pool below is an old granite quarry; Rockport stone went into bridges and buildings all down the coast.',
  },
];
