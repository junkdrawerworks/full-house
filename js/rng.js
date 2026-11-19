// Seeded random numbers, for anything that has to come out the same way twice.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A number mixed from several, so that seeds next to each other (a game's seed and turn 1, 2, 3...) start streams that
// have nothing to do with each other.
export function mix(...ns) {
  let h = 0x811c9dc5;
  for (const n of ns) {
    h = Math.imul(h ^ (n >>> 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

// The dice a roll would show for you: from the game's seed, the turn and the roll, so the die in place 3 on roll 2 of
// turn 5 is the same for everyone playing from that seed, whatever they held. `side` 1 is the second player, Red, at Two
// players. (An opponent's dice come from the seed another way: see theirTurn() in js/app.js.)
export function rollFor(seed, turn, roll, side = 0) {
  const rand = mulberry32(mix(seed, turn, roll, side, 0x5eed));
  return Array.from({ length: 5 }, () => 1 + Math.floor(rand() * 6));
}
